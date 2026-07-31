import type { TestPlan, TestScenario } from '../qa-planning-lab/types.js';
import * as readline from 'node:readline/promises';

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Pick the single highest-priority scenario (the one the MVP will generate). */
export function pickTopScenario(plan: TestPlan): TestScenario | undefined {
  if (plan.functionalScenarios.length === 0) return undefined;
  return [...plan.functionalScenarios].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
  )[0];
}

/**
 * Interactive scenario selection — show ALL test scenarios from the plan and let
 * the user pick up to `maxSelections` by typing comma/space-separated numbers.
 *
 * The ⭐ marks the recommended scenario (first login/auth-related one, since
 * it uses the provided credentials). Default (just Enter) = recommended only.
 *
 * Each generated test is self-contained — if you pick "Create contact" without
 * "Login", the LLM includes login as a setup step in the test itself.
 */
export async function selectScenarios(
  plan: TestPlan,
  maxSelections = 5
): Promise<TestScenario[]> {
  const scenarios = plan.functionalScenarios;
  if (scenarios.length === 0) return [];
  if (scenarios.length === 1) return [scenarios[0]];

  // Find the recommended scenario (first login/auth-related one).
  const recommendedIdx = scenarios.findIndex(s =>
    /login|sign.?in|authentic/i.test(s.title) || /login|sign.?in|authentic/i.test(s.journey)
  );
  const defaultIdx = recommendedIdx >= 0 ? recommendedIdx : 0;

  // Print the list.
  console.log('');
  console.log(`Select up to ${maxSelections} tests to generate:\n`);
  scenarios.forEach((s, i) => {
    const star = i === defaultIdx ? '⭐ ' : '  ';
    const badge = s.priority.toUpperCase();
    console.log(`  ${star}${i + 1}. ${s.id}  ${s.title}  [${badge}]`);
  });
  console.log('');

  // Prompt.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Select [${defaultIdx + 1}]: `)).trim();
    rl.close();

    // Parse: comma or space separated numbers.
    let indices: number[];
    if (!answer) {
      indices = [defaultIdx];
    } else {
      indices = answer.split(/[,\s]+/)
        .map(n => parseInt(n, 10))
        .filter(n => Number.isFinite(n) && n >= 1 && n <= scenarios.length)
        .map(n => n - 1); // convert to 0-based
    }

    // Deduplicate + cap at maxSelections.
    const unique = [...new Set(indices)].slice(0, maxSelections);
    return unique.map(i => scenarios[i]);
  } finally {
    rl.close();
  }
}

/** Render the review summary block shown before the [Y/n] prompt. */
export function renderSummary(plan: TestPlan, scenario: TestScenario | undefined): string {
  const lines: string[] = [];
  const rule = '────────────────────────';
  lines.push(rule);
  lines.push('');
  lines.push(`Application:`);
  lines.push(plan.applicationSummary.applicationType);
  lines.push('');
  lines.push(`Critical Flow:`);
  const flow =
    plan.criticalUserJourneys.slice(0, 3).map((j) => j.name).join(' → ') ||
    scenario?.journey ||
    '(none identified)';
  lines.push(flow);
  lines.push('');
  lines.push(`Selected Test:`);
  lines.push(scenario ? `${scenario.title}  [${scenario.priority}]` : '(no scenario available)');
  lines.push('');
  lines.push(`Confidence:`);
  lines.push(plan.confidence.toFixed(2));
  lines.push('');
  lines.push(`Blind Spots:`);
  if (plan.missingInformation.length === 0) {
    lines.push('(none)');
  } else {
    for (const m of plan.missingInformation.slice(0, 3)) lines.push(`• ${m}`);
  }
  lines.push('');
  lines.push(rule);
  return lines.join('\n');
}
