import type { NarrationContext, NarrationLlmOptions } from '../types.js';
import type { WalkthroughChapter } from '../../walkthrough/walkthrough.js';
import { toSpeakableText } from '../script/plain-text.js';
import { APP_NARRATION_SYSTEM_PROMPT, buildAppUserMessage } from './prompt.js';

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
const DEFAULT_MODEL = 'gpt-oss-120b';

export interface AppScriptResult {
  /** Full markdown document (one `## Chapter` heading per chapter). */
  markdown: string;
  /** Parsed per-chapter paragraphs in order. */
  perChapter: { title: string; text: string }[];
  /** Whether the LLM was used (false ⇒ deterministic fallback). */
  source: 'llm' | 'fallback';
  model?: string;
}

/**
 * Generate an app-demo narration script (v0.9.1).
 *
 * This is the demo-mode counterpart to `script/script.ts`. Where that one
 * narrates ReplayQA's process ("discovered 8 states… passed on first try"),
 * this one narrates the APPLICATION as a product demo over the walkthrough
 * video. It receives the walkthrough chapters (what was actually exercised on
 * camera) and the app identity — nothing else — so it can only describe real
 * features. The accuracy check still applies.
 *
 * Falls back to a deterministic, fact-only template if no apiKey or on failure.
 */
export async function generateAppScript(
  ctx: NarrationContext,
  chapters: readonly WalkthroughChapter[],
  options: NarrationLlmOptions = {}
): Promise<AppScriptResult> {
  if (options.apiKey) {
    try {
      const { markdown, model } = await callLlm(ctx, chapters, options);
      return { markdown, perChapter: splitChapters(markdown, chapters), source: 'llm', model };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`App-narration LLM call failed (${msg}); falling back to deterministic script.`);
    }
  }
  const markdown = fallbackAppScript(ctx, chapters);
  return { markdown, perChapter: splitChapters(markdown, chapters), source: 'fallback' };
}

async function callLlm(
  ctx: NarrationContext,
  chapters: readonly WalkthroughChapter[],
  options: NarrationLlmOptions
): Promise<{ markdown: string; model: string }> {
  const baseUrl = (options.baseUrl ?? process.env.REASONING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = options.model ?? process.env.REASONING_MODEL ?? DEFAULT_MODEL;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: APP_NARRATION_SYSTEM_PROMPT },
        { role: 'user', content: buildAppUserMessage(ctx, chapters) },
      ],
      temperature: 0.4,
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('LLM returned no content');
  return { markdown: content, model };
}

/** Deterministic, fact-only demo narration. Templates ONLY from verified observations. */
export function fallbackAppScript(ctx: NarrationContext, chapters: readonly WalkthroughChapter[]): string {
  const appType = ctx.reasoning?.applicationType ?? 'this application';
  const parts: string[] = [`# Product Walkthrough — ${appType}`];
  const ents = ctx.reasoning?.entities?.length ? ` working with ${ctx.reasoning.entities.join(' and ')}` : '';
  parts.push('', `Welcome to a quick walkthrough of ${appType}${ents}.`);

  for (const ch of chapters) {
    if (ch.actions.length === 0) continue; // omit empty chapters
    parts.push('', `## ${ch.title}`);
    for (let i = 0; i < ch.actions.length; i++) {
      const action = ch.actions[i];
      const verified = ch.verified?.[i];
      const obs = verified && verified.observations.length > 0 ? verified.observations.join('; ') : '';
      if (obs) {
        // LITERAL only: describe the click + the verified observation. Never
        // bridge to a stronger claim (e.g. "form opened" must NOT become "saved").
        parts.push(`We click ${JSON.stringify(action)}. On screen, ${obs}.`);
      } else {
        // HONEST: only say the action was attempted, never that it succeeded.
        parts.push(`We click ${JSON.stringify(action)}; nothing visibly changes on screen.`);
      }
    }
  }
  parts.push('', `## Wrap-up`, `That covers the actions in this walkthrough of ${appType}.`);
  return parts.join('\n');
}

/** Strip markdown + split into ordered chapter paragraphs. */
function splitChapters(markdown: string, chapters: readonly WalkthroughChapter[]): { title: string; text: string }[] {
  // Reuse the speakable-text stripper indirectly by parsing headings here.
  const lines = markdown.split('\n');
  const out: { title: string; text: string }[] = [];
  let current: { title: string; text: string } | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current) out.push(current);
      current = { title: heading[1].trim(), text: '' };
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line;
    }
  }
  if (current) out.push(current);
  for (const parsed of out) {
    const match = chapters.find((c) => c.title.toLowerCase() === parsed.title.toLowerCase());
    if (match) parsed.title = match.title;
    parsed.text = toSpeakableText(parsed.text);
  }
  return out;
}
