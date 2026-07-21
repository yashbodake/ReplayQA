import type { PlannerInput } from './collect.js';
import { buildPrompt } from './prompt.js';
import type {
  ApplicationSummary,
  CoverageAnalysis,
  EdgeCaseGroup,
  Priority,
  RiskAssessment,
  RiskItem,
  TestPlan,
  TestScenario,
  UserJourney,
} from './types.js';

/**
 * Call an OpenAI-compatible chat-completions endpoint and return a parsed
 * TestPlan. Defaults target Cerebras / gpt-oss-120b; base URL and model are
 * configurable via options / env (Olama Cloud or any compatible provider).
 * Uses Node's built-in fetch — no new dependencies.
 */
export interface LlmOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface PlanOutcome {
  plan: TestPlan;
  raw: string;
  model: string;
}

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
const DEFAULT_MODEL = 'gpt-oss-120b';

export async function generatePlan(
  input: PlannerInput,
  options: LlmOptions
): Promise<PlanOutcome> {
  const baseUrl = (options.baseUrl ?? process.env.REASONING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = options.model ?? process.env.REASONING_MODEL ?? DEFAULT_MODEL;
  const { system, user } = buildPrompt(input);

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
      temperature: 0.3,
      max_tokens: 4000,
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
  if (!content) throw new Error('LLM returned no content');

  return { plan: normalizePlan(content), raw: content, model };
}

/** Parse the model's JSON and defensively coerce it into a well-typed TestPlan. */
export function normalizePlan(content: string): TestPlan {
  const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
  const scenarios = normalizeScenarios(parsed.functionalScenarios);
  return {
    applicationSummary: normalizeSummary(parsed.applicationSummary),
    criticalUserJourneys: normalizeJourneys(parsed.criticalUserJourneys),
    functionalScenarios: scenarios,
    edgeCases: normalizeEdgeCases(parsed.edgeCases),
    riskAssessment: normalizeRisk(parsed.riskAssessment),
    coverageAnalysis: normalizeCoverage(parsed.coverageAnalysis),
    missingInformation: stringArrayOf(parsed.missingInformation),
    confidence: numberInRange(parsed.confidence, 0, 1, 0.5),
  };
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeSummary(value: unknown): ApplicationSummary {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    applicationType: stringOf(o.applicationType) ?? 'Unknown',
    authenticationRequired: Boolean(o.authenticationRequired),
    category: stringOf(o.category) ?? 'Unknown',
    summary: stringOf(o.summary) ?? '',
  };
}

function normalizeJourneys(value: unknown): UserJourney[] {
  if (!Array.isArray(value)) return [];
  return value.map((v, i) => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return {
      name: stringOf(o.name) ?? `Journey ${i + 1}`,
      priority: priorityOf(o.priority),
      rationale: stringOf(o.rationale) ?? '',
    };
  });
}

function normalizeScenarios(value: unknown): TestScenario[] {
  if (!Array.isArray(value)) return [];
  return value.map((v, i) => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return {
      id: stringOf(o.id) || `TC-${String(i + 1).padStart(3, '0')}`,
      journey: stringOf(o.journey) ?? 'General',
      title: stringOf(o.title) ?? `Scenario ${i + 1}`,
      priority: priorityOf(o.priority),
      purpose: stringOf(o.purpose) ?? '',
      preconditions: stringArrayOf(o.preconditions),
      expectedResult: stringOf(o.expectedResult) ?? '',
    };
  });
}

function normalizeEdgeCases(value: unknown): EdgeCaseGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map((v, i) => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return {
      area: stringOf(o.area) ?? `Area ${i + 1}`,
      cases: stringArrayOf(o.cases),
    };
  });
}

function normalizeRisk(value: unknown): RiskAssessment {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    high: normalizeRiskItems(o.high),
    medium: normalizeRiskItems(o.medium),
    low: normalizeRiskItems(o.low),
  };
}

function normalizeRiskItems(value: unknown): RiskItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return {
      area: stringOf(o.area) ?? stringOf(o.name) ?? 'Unknown',
      reason: stringOf(o.reason) ?? '',
    };
  });
}

function normalizeCoverage(value: unknown): CoverageAnalysis {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    coveredAreas: stringArrayOf(o.coveredAreas ?? o.covered),
    unevaluatedAreas: stringArrayOf(o.unevaluatedAreas ?? o.unevaluated),
  };
}

const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];
function priorityOf(value: unknown): Priority {
  const s = String(value ?? '').toLowerCase().trim();
  return (PRIORITIES as string[]).includes(s) ? (s as Priority) : 'medium';
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
