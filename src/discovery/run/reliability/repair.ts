import type { Observations } from '../../reasoning-lab/collect.js';
import type { TestScenario } from '../../qa-planning-lab/types.js';
import type {
  RepairAttempt,
  RepairDiagnostics,
  RepairExplanation,
  StaticValidationResult,
} from './types.js';

/**
 * LLM repair pass. Unlike the MVP's one-shot retry, this receives a STRUCTURED
 * repair context — the scenario, the generation constraints, the failing code,
 * the normalized diagnostics, the static-validation findings, and the full
 * repair history — and MUST return a structured explanation alongside the
 * repaired code.
 *
 * The explanation is what makes each repair auditable and what populates the
 * repair timeline.
 */
export interface RepairOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface RepairResult {
  code: string;
  explanation: RepairExplanation;
  raw: string;
}

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';
const DEFAULT_MODEL = 'gpt-oss-120b';

export async function repairAttempt(args: {
  scenario: TestScenario;
  observations: Observations;
  diagnostics: RepairDiagnostics;
  validation: StaticValidationResult;
  history: RepairAttempt[];
  options: RepairOptions;
}): Promise<RepairResult> {
  const baseUrl = (args.options.baseUrl ?? process.env.REASONING_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = args.options.model ?? process.env.REASONING_MODEL ?? DEFAULT_MODEL;

  const system = [
    'You repair a failing Playwright test. You will receive JSON with:',
    '  - scenario: the QA scenario the test must verify',
    '  - diagnostics: the structured failure (errorType, message, locator,',
    '    expected/received, failing code line, console/network errors)',
    '  - validation: static-analysis findings already detected in the code',
    '  - failingCode: the test that failed',
    '  - history: previous repair attempts and why they failed',
    '',
    'Return ONLY a JSON object with EXACTLY these keys:',
    '  {',
    '    "whyFailed": string,        // why the previous version failed',
    '    "whatChanged": string,      // what you changed and why',
    '    "whyShouldSucceed": string, // why the new version should now pass',
    '    "code": string              // the COMPLETE corrected test source',
    '  }',
    '',
    'PLAYWRIGHT RULES (the most common failure causes — learn from history):',
    '  - Locators in actions/assertions must resolve to ONE element. For labels',
    '    that repeat per row (Edit, Delete), use .first() for "at least one"',
    '    or scope the locator to a specific row.',
    '  - Assertion methods (toBeVisible, toHaveCount, …) live on expect(), not',
    '    on locators: `await expect(locator).toBeVisible()`, never',
    '    `await locator.toBeVisible()`.',
    '  - Never hardcode toHaveCount(N) unless N is observed; use .first().',
    '  - Keep the import line exactly: import { test, expect } from',
    "    '../src/runner/index.js';",
    '  - Do not add code blocks or prose outside the JSON object.',
  ].join('\n');

  const user = JSON.stringify(
    {
      scenario: {
        title: args.scenario.title,
        purpose: args.scenario.purpose,
        expectedResult: args.scenario.expectedResult,
        preconditions: args.scenario.preconditions,
      },
      observations: args.observations,
      diagnostics: args.diagnostics,
      validation: args.validation.findings.map((f) => ({
        category: f.category,
        message: f.message,
        autoFixed: f.autoFixed,
      })),
      failingCode: args.validation.code,
      history: args.history.map((h) => ({
        attempt: h.attemptNumber,
        failedBecause: h.execution.diagnostics?.message ?? '(execution error)',
        errorType: h.execution.diagnostics?.errorType,
        previousFix: h.repair?.whatChanged,
      })),
    },
    null,
    2
  );

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.15,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Repair request failed: ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Repair returned no content');

  const parsed = JSON.parse(extractJson(raw)) as {
    whyFailed?: string;
    whatChanged?: string;
    whyShouldSucceed?: string;
    code?: string;
  };

  const code = parsed.code?.trim() ?? '';
  if (!code) throw new Error('Repair returned no code');

  return {
    code: cleanCode(code),
    explanation: {
      whyFailed: parsed.whyFailed ?? '(not stated)',
      whatChanged: parsed.whatChanged ?? '(not stated)',
      whyShouldSucceed: parsed.whyShouldSucceed ?? '(not stated)',
    },
    raw,
  };
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : content.trim();
}

function cleanCode(raw: string): string {
  let code = raw.trim();
  const fenced = code.match(/```(?:typescript|ts|js|javascript)?\s*([\s\S]*?)```/i);
  if (fenced) code = fenced[1].trim();
  return code;
}
