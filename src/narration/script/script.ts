import type { NarrationContext, NarrationLlmOptions } from '../types.js';
import type { NarrationChapter } from '../planner/types.js';
import { NARRATION_SYSTEM_PROMPT, buildUserMessage } from './prompt.js';

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
const DEFAULT_MODEL = 'gpt-oss-120b';

export interface ScriptResult {
  /** Full markdown document (one `## Chapter` heading per chapter). */
  markdown: string;
  /** Parsed per-chapter paragraphs in order. */
  perChapter: { title: string; text: string }[];
  /** Whether the LLM was used (false ⇒ deterministic fallback was used). */
  source: 'llm' | 'fallback';
  model?: string;
}

/**
 * Generate the narration script — the ONLY place narration prose is produced
 * (Refinement #2). Input is solely the `NarrationContext` + the planner's
 * chapters (Refinement #3).
 *
 * Behaviour:
 *  - If an `apiKey` is provided, call the OpenAI-compatible endpoint used by
 *    the rest of ReplayQA and parse its markdown into per-chapter paragraphs.
 *  - Otherwise (or on any failure), fall back to a DETERMINISTIC, fact-only
 *    template — never invented. Narration therefore always works, even offline.
 */
export async function generateScript(
  ctx: NarrationContext,
  chapters: readonly NarrationChapter[],
  options: NarrationLlmOptions = {}
): Promise<ScriptResult> {
  if (options.apiKey) {
    try {
      const { markdown, model } = await callLlm(ctx, chapters, options);
      return { markdown, perChapter: splitChapters(markdown, chapters), source: 'llm', model };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`Narration LLM call failed (${msg}); falling back to deterministic script.`);
    }
  }
  const markdown = fallbackScript(ctx, chapters);
  return { markdown, perChapter: splitChapters(markdown, chapters), source: 'fallback' };
}

async function callLlm(
  ctx: NarrationContext,
  chapters: readonly NarrationChapter[],
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
        { role: 'system', content: NARRATION_SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(ctx, chapters) },
      ],
      temperature: 0.3,
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

/**
 * Deterministic, fact-only narration used when no LLM is available or the call
 * fails. Every sentence is templated from verified `NarrationContext` facts —
 * there is no path here that can invent a feature or count.
 */
export function fallbackScript(ctx: NarrationContext, chapters: readonly NarrationChapter[]): string {
  const target = ctx.targetUrl ? ` — ${ctx.targetUrl}` : '';
  const parts: string[] = [`# ReplayQA Narration${target}`];
  for (const ch of chapters) {
    parts.push('', `## ${ch.title}`, fallbackParagraph(ch));
  }
  return parts.join('\n');
}

function fallbackParagraph(ch: NarrationChapter): string {
  const f = ch.evidence.facts as Record<string, unknown>;
  switch (ch.title) {
    case 'Discovery': {
      const states = num(f.stateCount);
      const flows = num(f.flowCount);
      const app = str(f.applicationType);
      const appClause = app ? `, identified as ${app}` : '';
      return `ReplayQA explored the application${appClause}, discovering ${states} distinct state${states === 1 ? '' : 's'} and ${flows} transition${flows === 1 ? '' : 's'}.`;
    }
    case 'Authentication': {
      return f.authenticated === true
        ? 'ReplayQA authenticated successfully using the supplied credentials and continued exploration as the authenticated user.'
        : 'ReplayQA attempted authentication but it did not succeed; exploration continued with the unauthenticated view.';
    }
    case 'Application Understanding': {
      const app = str(f.applicationType) || 'the application';
      const conf = typeof f.confidence === 'number' ? ` with confidence ${f.confidence.toFixed(2)}` : '';
      const ents = arr(f.entities);
      const entClause = ents.length ? ` Its core entities are ${ents.join(', ')}.` : '';
      return `ReplayQA reasoned about what it observed and understood the application as ${app}${conf}.${entClause}`;
    }
    case 'QA Plan': {
      const sc = num(f.scenarioCount);
      return `From that understanding, ReplayQA produced a QA plan covering ${sc} test scenario${sc === 1 ? '' : 's'}.`;
    }
    case 'Test Generation & Execution': {
      const title = str(f.scenarioTitle) || 'the highest-priority scenario';
      if (f.passed === true) {
        return f.firstPassSuccess === true
          ? `ReplayQA generated a Playwright test for "${title}", and it passed on the first attempt.`
          : `ReplayQA generated a Playwright test for "${title}"; after ${num(f.repairsUsed)} repair attempt${num(f.repairsUsed) === 1 ? '' : 's'}, execution passed.`;
      }
      return `ReplayQA generated a Playwright test for "${title}", but execution did not pass after ${num(f.attempts)} attempt${num(f.attempts) === 1 ? '' : 's'}.`;
    }
    case 'Conclusion':
    default: {
      return f.passed === true
        ? 'The run completed successfully. The generated test validates the application’s primary workflow.'
        : 'The run completed. Review the artifacts for details on what was discovered and where execution stopped.';
    }
  }
}

/** Split a markdown script (## headings) back into ordered chapter paragraphs. */
function splitChapters(markdown: string, chapters: readonly NarrationChapter[]): { title: string; text: string }[] {
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
  // Normalise titles to the planner's chapter titles where they fuzzy-match.
  for (const parsed of out) {
    const match = chapters.find((c) => c.title.toLowerCase() === parsed.title.toLowerCase());
    if (match) parsed.title = match.title;
    parsed.text = parsed.text.trim();
  }
  return out;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
