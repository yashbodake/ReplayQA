import type { TestPlan, TestScenario } from '../qa-planning-lab/types.js';

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
