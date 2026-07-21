import type { Observations } from './collect.js';
import { buildPrompt } from './prompt.js';
import type { ReasoningResult } from './types.js';

/**
 * Call an OpenAI-compatible chat-completions endpoint and return the parsed
 * ReasoningResult.
 *
 * Defaults target Cerebras Inference (`gpt-oss-120b`). The base URL and model
 * are configurable via options / env so the same code can target Olama Cloud
 * or any other OpenAI-compatible provider later — no code changes needed.
 *
 * Uses Node's built-in `fetch` (Node 18+). No new dependencies.
 */
export interface LlmOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface ReasonOutcome {
  result: ReasoningResult;
  /** The raw text the model returned, kept for audit/debug. */
  raw: string;
  model: string;
}

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
const DEFAULT_MODEL = 'gpt-oss-120b';

export async function reason(
  observations: Observations,
  options: LlmOptions
): Promise<ReasonOutcome> {
  const baseUrl = (options.baseUrl ?? process.env.REASONING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = options.model ?? process.env.REASONING_MODEL ?? DEFAULT_MODEL;
  const { system, user } = buildPrompt(observations);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      // gpt-oss on Cerebras supports JSON mode; this keeps output reliably parseable.
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `LLM request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned no content');
  }

  return { result: normalizeResult(content), raw: content, model };
}

/**
 * Parse + defensively normalize the model's JSON into a ReasoningResult. The
 * prompt asks for JSON-mode output, but we still tolerate minor shape drift
 * (extra keys, wrong types) rather than failing the experiment.
 */
export function normalizeResult(content: string): ReasoningResult {
  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
  return {
    applicationType: stringOf(parsed.applicationType) ?? 'Unknown',
    entities: stringArrayOf(parsed.entities),
    capabilities: stringArrayOf(parsed.capabilities),
    flows: stringArrayOf(parsed.flows),
    confidence: numberInRange(parsed.confidence, 0, 1, 0.5),
    missingInformation: stringArrayOf(parsed.missingInformation),
  };
}

/** JSON mode should return pure JSON, but tolerate a fenced block if present. */
function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v : String(v))).filter(Boolean);
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
