#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadObservations } from '../../reasoning-lab/index.js';
import { generateTest } from '../generate.js';
import { generateUntilPass } from './loop.js';
import {
  aggregate,
  loadMetrics,
  recordRun,
  resetMetrics,
  toRunRecord,
} from './metrics.js';
import { renderReliabilityReport } from './report.js';
import type { TestPlan, TestScenario } from '../../qa-planning-lab/types.js';

/**
 * Generation-reliability benchmark.
 *
 *   npm run reliability -- [artifactsDir] [--iterations N] [--reset]
 *
 * Isolates the generation-reliability question from discovery/reasoning/plan
 * (which already work first-try): it reuses existing artifacts, picks the QA
 * plan's scenarios, and runs the full generate→validate→execute→repair loop
 * `iterations` times, recording metrics for each. Cycles through the top
 * scenarios so the measurement covers more than one generation task.
 */
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    console.error('CEREBRAS_API_KEY is not set.');
    process.exit(2);
  }

  const argv = process.argv.slice(2);
  const valueFlags = new Set(['--iterations', '--max-repairs']);
  const positional: string[] = [];
  let reset = false;
  let iterations = 6;
  let maxRepairs = 3;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reset') {
      reset = true;
      continue;
    }
    if (valueFlags.has(a)) {
      const v = Number(argv[++i]);
      if (a === '--iterations') iterations = v || 6;
      if (a === '--max-repairs') maxRepairs = v || 3;
      continue;
    }
    if (a.startsWith('--')) continue;
    positional.push(a);
  }
  const artifactsDir = resolve(
    process.cwd(),
    positional[0] ?? 'artifacts/discovery-fixture'
  );
  const testFile = resolve(process.cwd(), 'tests/replayqa-generated.spec.ts');

  if (reset) resetMetrics();

  const observations = await loadObservations(artifactsDir);
  const reasoning = JSON.parse(readFileSync(resolve(artifactsDir, 'reasoning.json'), 'utf-8'));
  const plan = JSON.parse(readFileSync(resolve(artifactsDir, 'test-plan.json'), 'utf-8')) as TestPlan;
  const discovery = JSON.parse(readFileSync(resolve(artifactsDir, 'discovery.json'), 'utf-8')) as { application: { url: string } };
  const targetUrl = discovery.application.url;

  const scenarios = plan.functionalScenarios
    .slice()
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 5);
  if (scenarios.length === 0) {
    console.error('No scenarios in test-plan.json.');
    process.exit(2);
  }

  console.log(`Benchmark: ${iterations} iterations · max ${maxRepairs} repairs · ${scenarios.length} scenarios`);
  console.log(`Target: ${targetUrl}\n`);

  for (let i = 0; i < iterations; i++) {
    const scenario = scenarios[i % scenarios.length] as TestScenario;
    console.log(`=== Iteration ${i + 1}/${iterations} — "${scenario.title}" [${scenario.priority}] ===`);

    const initial = await generateTest(targetUrl, observations, reasoning, scenario, { apiKey });
    const outcome = await generateUntilPass({
      initialCode: initial.code,
      scenario,
      observations,
      options: {
        apiKey,
        maxRepairAttempts: maxRepairs,
        testFile,
        onAttempt: (a) =>
          console.log(
            `  attempt ${a.attemptNumber} [${a.source}]: ${a.execution.passed ? 'PASS' : 'FAIL'}${
              a.execution.diagnostics ? ` [${a.execution.diagnostics.errorType}]` : ''
            }${a.validation.findings.some((f) => f.autoFixed) ? ' (deterministic fix applied)' : ''}`
          ),
      },
    });

    recordRun(toRunRecord({ targetUrl, scenarioTitle: scenario.title, outcome }));
    console.log(
      `  → ${outcome.passed ? 'PASSED' : 'FAILED'} in ${outcome.attempts.length} attempt(s), ${outcome.repairAttemptsUsed} repair(s)\n`
    );
  }

  const metrics = loadMetrics();
  const agg = aggregate(metrics);

  // Render the reliability report from the LAST outcome for the timeline,
  // with aggregate metrics across all runs.
  // (The benchmark's primary deliverable is the metrics + the aggregate.)
  const reportPath = resolve(artifactsDir, 'reliability-report.html');
  const lastOutcome = metrics.runs[metrics.runs.length - 1];
  const lastScenario = plan.functionalScenarios.find((s) => s.title === lastOutcome?.scenarioTitle) ?? scenarios[0];
  const html = renderReliabilityReport({
    scenario: lastScenario as TestScenario,
    outcome: {
      passed: lastOutcome?.passed ?? false,
      finalCode: readFileSync(testFile, 'utf-8'),
      attempts: [],
      firstPassSuccess: lastOutcome?.firstPassSuccess ?? false,
      repairAttemptsUsed: lastOutcome?.repairsUsed ?? 0,
      totalDurationMs: lastOutcome?.durationMs ?? 0,
    },
    aggregate: agg,
    appName: targetUrl,
  });
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(reportPath, html, 'utf-8');

  console.log('────────────────────────────────────────');
  console.log('Reliability metrics');
  console.log('────────────────────────────────────────');
  console.log(`Total runs:                ${agg.totalRuns}`);
  console.log(`Passed:                    ${agg.passed}/${agg.totalRuns}`);
  console.log(`First-pass success rate:   ${pct(agg.firstPassSuccessRate)}`);
  console.log(`Repair success rate:       ${pct(agg.repairSuccessRate)}`);
  console.log(`Avg attempts:              ${agg.avgAttempts.toFixed(2)}`);
  console.log(`Avg / median repairs used: ${agg.avgRepairsUsed.toFixed(2)} / ${agg.medianRepairsUsed}`);
  console.log(`Deterministic fixes total: ${agg.totalDeterministicallyFixed}`);
  console.log('Failure categories:');
  for (const [k, v] of Object.entries(agg.failureCategoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`\nReliability report: ${reportPath}`);
  console.log(`Metrics JSON:       ${resolve(artifactsDir, 'reliability-metrics.json')}`);
}

function priorityRank(p: string): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[p] ?? 9;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
