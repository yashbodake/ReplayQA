import type { Observations } from '../reasoning-lab/collect.js';
import type { TestScenario } from '../qa-planning-lab/types.js';

/**
 * Ask the LLM to write a SINGLE Playwright test for the chosen scenario,
 * grounded only in ReplayQA's structured observations (no raw HTML).
 *
 * The generated test imports the ReplayQA runner so it inherits the existing
 * console/network collectors; the surrounding Playwright config provides
 * video/trace/screenshot capture and the HTML reporter.
 */
export interface GenerateOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface GenerateOutcome {
  code: string;
  raw: string;
  model: string;
}

const IMPORT_LINE = "import { test, expect } from '../src/runner/index.js';";

export async function generateTest(
  targetUrl: string,
  observations: Observations,
  reasoning: unknown,
  scenario: TestScenario,
  options: GenerateOptions
): Promise<GenerateOutcome> {
  const baseUrl = (options.baseUrl ?? process.env.REASONING_BASE_URL ?? 'https://api.cerebras.ai/v1').replace(/\/$/, '');
  const model = options.model ?? process.env.REASONING_MODEL ?? 'gpt-oss-120b';

  const system = [
    'You write Playwright tests in TypeScript. You will be given a JSON object',
    'with: targetUrl, scenario (the one test to implement), observations (pages',
    'ReplayQA discovered — buttons/links/forms/inputs as text), and reasoning',
    '(ReplayQA\'s understanding of the app).',
    '',
    'Produce EXACTLY ONE test() that:',
    '  1. Navigates to the targetUrl.',
    '  2. Performs the steps implied by the scenario, using ROBUST locators',
    '     derived from the observations (prefer getByRole / getByLabel over',
    '     brittle CSS). If a control is only known by its visible label, use',
    '     that label.',
    '  3. Ends with at least one `expect(...)` that asserts the scenario\'s',
    '     expected result.',
    '  4. Uses safe, deterministic test data (e.g. a clearly fake name/email).',
    '',
    'PLAYWRIGHT STRICT MODE (critical):',
    '  - Locators in actions/assertions must resolve to EXACTLY ONE element.',
    '  - CRUD pages often have MANY buttons with the same label (e.g. one',
    '    "Edit" per row). Never do `expect(getByRole("button",{name:"Edit"}))`',
    '    directly — use `.first()` or assert the count, e.g.',
    '    `await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(N)`',
    '    or `….first().toBeVisible()`.',
    '  - Prefer presence/count assertions that do not depend on a single match.',
    '',
    'CORRECT ASSERTION STYLE (copy these patterns exactly):',
    '  // "at least one exists" — use .first(), NEVER hardcode a count you',
    '  // did not observe in the data:',
    '  await expect(page.getByRole("button", { name: "Edit" }).first()).toBeVisible();',
    '  // text appeared on the page:',
    '  await expect(page.getByText("Alice")).toBeVisible();',
    'NEVER call `.toBeVisible()` / `.toBe(...)` directly on a locator — these',
    'are methods of `expect()`, e.g. `await expect(locator).toBeVisible()`, not',
    '`await locator.toBeVisible()`.',
    'NEVER use `toHaveCount(N)` with a hardcoded N unless the observations',
    'explicitly state that exact count — prefer `.first().toBeVisible()` for',
    '"at least one is present".',
    '',
    `The file MUST start with exactly this import line:\n  ${IMPORT_LINE}`,
    'Do NOT include any other import. Do NOT use test.describe unless needed.',
    'Return ONLY the TypeScript source code — no markdown fences, no prose.',
  ].join('\n');

  const user = JSON.stringify({ targetUrl, scenario, observations, reasoning }, null, 2);

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
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('LLM returned no content');

  return { code: cleanCode(raw), raw, model };
}

/**
 * Single self-repair pass: given the failing test source and the captured
 * Playwright error output, ask the LLM to return a corrected full test file.
 *
 * This is deliberately ONE retry (not a loop) — enough to recover from the
 * small locator/API mistakes a generator makes on the first try (strict-mode
 * ambiguity, a wrong assertion method) without hiding a fundamentally broken
 * scenario.
 */
export async function repairTest(
  failingCode: string,
  errorOutput: string,
  options: GenerateOptions
): Promise<GenerateOutcome> {
  const baseUrl = (options.baseUrl ?? process.env.REASONING_BASE_URL ?? 'https://api.cerebras.ai/v1').replace(/\/$/, '');
  const model = options.model ?? process.env.REASONING_MODEL ?? 'gpt-oss-120b';

  const system = [
    'A Playwright test you wrote failed when executed. Below is the FULL test',
    'source followed by the execution error output. Return a CORRECTED full',
    'test file that fixes the failure.',
    '',
    'The most common causes are:',
    '  - strict-mode violations (a locator matched several elements) — fix by',
    '    scoping the locator (e.g. within a specific region) or using .first()',
    '    for "at least one" checks. Do NOT use getByText on a string that may',
    '    appear in multiple elements.',
    '  - calling an assertion method directly on a locator instead of via',
    '    expect() — use `await expect(locator).toBeVisible()`.',
    '  - a hardcoded count that does not match reality — use .first() instead.',
    '',
    'Keep the same import line and the same scenario intent. Return ONLY the',
    'TypeScript source code, no markdown fences, no explanation.',
  ].join('\n');

  const user = [
    '--- FAILING TEST SOURCE ---',
    failingCode,
    '',
    '--- EXECUTION ERROR OUTPUT (tail) ---',
    errorOutput.split('\n').slice(-50).join('\n'),
  ].join('\n');

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
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM repair request failed: ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const repaired = data.choices?.[0]?.message?.content;
  if (!repaired) throw new Error('LLM repair returned no content');

  return { code: cleanCode(repaired), raw: repaired, model };
}

/** Strip markdown fences and ensure the required import is present. */
function cleanCode(raw: string): string {
  let code = raw.trim();
  const fenced = code.match(/```(?:typescript|ts|js|javascript)?\s*([\s\S]*?)```/i);
  if (fenced) code = fenced[1].trim();
  if (!code.includes("from '../src/runner/index.js'")) {
    code = `${IMPORT_LINE}\n\n${code}`;
  }
  return code;
}
