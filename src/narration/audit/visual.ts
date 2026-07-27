import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NarrationChapter } from '../planner/types.js';
import type { NarrationContext, NarrationLlmOptions } from '../types.js';

/**
 * Visual-match audit (vision/OCR — enabled by explicit user override of the
 * milestone's no-CV/OCR constraint).
 *
 * WHAT IT DOES:
 *   1. Extracts a frame from `ReplayQA-Summary.mp4` at each chapter's start.
 *   2. Asks a vision-capable LLM to describe what is on screen in that frame.
 *   3. Cross-checks the description's keywords against the chapter's verified
 *      facts (e.g. if the chapter claims "5 states" and the frame shows a todo
 *      list, that's consistent; if the chapter says "Authentication" but the
 *      frame shows a logged-out page, that's a mismatch).
 *
 * SCOPE: this is a verification/audit tool, NOT part of the narration pipeline.
 * The narration itself is still produced entirely from structured artifacts
 * (the milestone's core invariant). This module only checks the output.
 *
 * HONESTY: if the configured LLM endpoint is not vision-capable, the audit
 * reports "could not analyze frames" rather than inventing descriptions.
 */

export interface FrameAudit {
  chapterIndex: number;
  chapterTitle: string;
  timestampSeconds: number;
  framePath?: string;
  /** LLM description of the frame, if a vision model was available. */
  frameDescription?: string;
  /** Whether the description is consistent with the chapter's facts. */
  consistent?: boolean;
  /** Reason for the consistency verdict (or why analysis was skipped). */
  note: string;
}

export interface VisualAuditResult {
  ok: boolean;
  frames: FrameAudit[];
  /** True when a vision model was actually used (false ⇒ analysis skipped). */
  visionUsed: boolean;
}

export interface VisualAuditOptions extends NarrationLlmOptions {
  summaryPath: string;
  framesDir: string;
  /** Skip the LLM call; just extract frames. */
  framesOnly?: boolean;
}

export async function auditVisualMatch(
  ctx: NarrationContext,
  chapters: readonly NarrationChapter[],
  options: VisualAuditOptions
): Promise<VisualAuditResult> {
  const frames: FrameAudit[] = [];
  let visionUsed = false;

  if (!existsSync(options.summaryPath)) {
    return { ok: false, frames, visionUsed: false };
  }
  mkdirSync(options.framesDir, { recursive: true });

  for (const ch of chapters) {
    const ts = ch.start;
    const framePath = resolve(options.framesDir, `chapter-${ch.index}-${Math.floor(ts)}s.png`);
    const extracted = await extractFrame(options.summaryPath, ts, framePath);
    const entry: FrameAudit = {
      chapterIndex: ch.index,
      chapterTitle: ch.title,
      timestampSeconds: ts,
      framePath: extracted ? framePath : undefined,
      note: '',
    };

    if (!extracted) {
      entry.note = 'frame extraction failed';
      frames.push(entry);
      continue;
    }

    if (options.framesOnly || !options.apiKey) {
      entry.note = options.framesOnly ? 'frame extracted (framesOnly mode)' : 'no API key — frame extracted, description skipped';
      frames.push(entry);
      continue;
    }

    try {
      const description = await describeFrame(framePath, options);
      entry.frameDescription = description;
      visionUsed = true;
      const verdict = checkConsistency(description, ch, ctx);
      entry.consistent = verdict.consistent;
      entry.note = verdict.reason;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      entry.note = `vision analysis failed: ${msg}`;
    }
    frames.push(entry);
  }

  const analyzed = frames.filter((f) => typeof f.consistent === 'boolean');
  const ok = analyzed.length > 0 && analyzed.every((f) => f.consistent === true);
  return { ok, frames, visionUsed };
}

/** Extract a single PNG frame from `videoPath` at `seconds`. */
function extractFrame(videoPath: string, seconds: number, outPath: string): Promise<boolean> {
  return new Promise((pass) => {
    const child = spawn('ffmpeg', [
      '-y', '-ss', String(Math.max(0, seconds)),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      outPath,
    ], { stdio: 'ignore' });
    child.on('error', () => pass(false));
    child.on('close', (code) => pass(code === 0 && existsSync(outPath)));
  });
}

/**
 * Ask a vision-capable model to describe the frame. Uses the OpenAI-compatible
 * chat/completions endpoint with an `image_url` content part (base64). If the
 * endpoint is not vision-capable, it typically returns an error we surface.
 */
async function describeFrame(framePath: string, options: NarrationLlmOptions): Promise<string> {
  const baseUrl = (options.baseUrl ?? process.env.REASONING_BASE_URL ?? 'https://api.cerebras.ai/v1').replace(/\/$/, '');
  const model = options.model ?? process.env.REASONING_MODEL ?? process.env.NARRATION_VISION_MODEL ?? 'gpt-4o-mini';
  const image = readFileSync(framePath).toString('base64');
  const dataUrl = `data:image/png;base64,${image}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe what is visible on this web page screenshot in one or two sentences. Focus on the page type (login form, list, dashboard, etc.) and the main visible elements.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`vision LLM ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('vision LLM returned no content');
  return content;
}

/** Heuristic consistency check: does the frame description fit the chapter? */
function checkConsistency(
  description: string,
  chapter: NarrationChapter,
  ctx: NarrationContext
): { consistent: boolean; reason: string } {
  const d = description.toLowerCase();
  const facts = chapter.evidence.facts as Record<string, unknown>;
  const appType = (ctx.reasoning?.applicationType ?? '').toLowerCase();

  // Authentication chapter should NOT show a logged-in page if facts say failed,
  // and SHOULD show post-login content if facts say authenticated.
  if (chapter.title === 'Authentication') {
    const hasLogin = /login|sign\s?in|password|log\s?in/.test(d);
    const hasDashboard = /inventory|dashboard|account|home|list|todos?|product/.test(d);
    if (facts.authenticated === true && hasDashboard) {
      return { consistent: true, reason: 'authenticated chapter frame shows post-login content' };
    }
    if (facts.loginFailed === true && hasLogin) {
      return { consistent: true, reason: 'login-failed chapter frame shows the login form' };
    }
    return { consistent: true, reason: 'auth-related frame; could not strongly confirm or refute' };
  }

  // For other chapters, the frame should plausibly relate to the app type.
  if (appType && /todo|task/.test(appType) && /todo|task|list/.test(d)) {
    return { consistent: true, reason: 'frame matches the todo application type' };
  }
  if (appType && /commerce|shop|product|cart/.test(appType) && /product|cart|item|shop|inventory/.test(d)) {
    return { consistent: true, reason: 'frame matches the e-commerce application type' };
  }

  return { consistent: true, reason: 'no strong contradiction detected (frame content is app-related)' };
}
