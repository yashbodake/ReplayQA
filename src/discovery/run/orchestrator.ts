import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runDiscovery } from '../core/discover.js';
import { loadObservations, reason } from '../reasoning-lab/index.js';
import { loadPlannerInput, generatePlan, renderMarkdown } from '../qa-planning-lab/index.js';
import { generateTest } from './generate.js';
import { generateUntilPass, recordRun, toRunRecord, loadMetrics, aggregate, renderReliabilityReport } from './reliability/index.js';
import { LoginFailedError } from '../login/index.js';
import { pickTopScenario, renderSummary } from './summary.js';
import { promptApproval } from './approval.js';
import type { DiscoveryCredentials } from '../../config/types.js';

export interface RunOptions {
  apiKey: string;
  headed?: boolean;
  credentials?: DiscoveryCredentials;
  /** Skip the interactive [Y/n] gate (e.g. CI / scripted demos). */
  yes?: boolean;
  /** Discovery/reasoning/plan artifacts root. */
  outputDir?: string;
  /** Maximum LLM repair attempts in the reliability loop. */
  maxRepairAttempts?: number;
}

export interface RunResult {
  ok: boolean;
  stage?: string;
  error?: string;
  testPassed?: boolean;
  reportPath?: string;
}

const GENERATED_TEST = 'tests/replayqa-generated.spec.ts';

/**
 * The end-to-end ReplayQA MVP pipeline:
 *
 *   discover → reason → plan → [review + approve] → generate ONE test → execute → report
 *
 * Every stage writes its artifacts as it completes, so a failure at any later
 * stage preserves all earlier work (the milestone's error-handling requirement).
 * On the first failure the run stops, reports which stage failed and why, and
 * exits non-zero without discarding anything already on disk.
 */
export async function runReplayQA(
  targetUrl: string,
  options: RunOptions
): Promise<RunResult> {
  const artifactsDir = resolve(process.cwd(), options.outputDir ?? 'artifacts/discovery');
  mkdirSync(artifactsDir, { recursive: true });
  const stage = (name: string) => console.log(`\n✓ ${name}`);

  try {
    // 1 ── Discovery (BrowserController + StateManager + DetectorManager)
    stage('Discovering application');
    const discovery = await runDiscovery(targetUrl, {
      headed: options.headed,
      credentials: options.credentials,
      outputDir: artifactsDir,
    });
    // runDiscovery returns the result; the orchestrator persists discovery.json
    // (the discover CLI does this, but the MVP calls the engine directly).
    writeJSON(artifactsDir, 'discovery.json', discovery);

    // 2 ── AI Understanding (reasoning)
    stage('Understanding application');
    const observations = await loadObservations(artifactsDir);
    const reasoningOutcome = await reason(observations, { apiKey: options.apiKey });
    writeJSON(artifactsDir, 'reasoning.json', reasoningOutcome.result);
    writeRaw(artifactsDir, 'reasoning.raw.txt', reasoningOutcome.raw);

    // 3 ── QA Planning
    stage('Generating QA plan');
    const planInput = await loadPlannerInput(artifactsDir);
    const planOutcome = await generatePlan(planInput, { apiKey: options.apiKey });
    writeJSON(artifactsDir, 'test-plan.json', planOutcome.plan);
    writeRaw(artifactsDir, 'test-plan.md', renderMarkdown(planOutcome.plan));
    writeRaw(artifactsDir, 'test-plan.raw.txt', planOutcome.raw);

    // 4 ── Review + approval gate
    const scenario = pickTopScenario(planOutcome.plan);
    console.log('\n' + renderSummary(planOutcome.plan, scenario) + '\n');

    if (!scenario) {
      console.log('No testable scenario was identified — aborting before generation.');
      console.log('Artifacts preserved under artifacts/discovery/.');
      return { ok: true, stage: 'plan' };
    }

    const approved = options.yes
      ? true
      : await promptApproval('Generate this test? [Y/n] ');
    if (!approved) {
      console.log('\nAborted. Artifacts preserved under artifacts/discovery/.');
      return { ok: true, stage: 'plan' };
    }

    // 5 ── Generate ONE Playwright test for the top scenario (initial pass)
    stage('Generating Playwright test');
    const generated = await generateTest(
      targetUrl,
      observations,
      reasoningOutcome.result,
      scenario,
      { apiKey: options.apiKey }
    );
    writeRaw(artifactsDir, 'generated-test.raw.txt', generated.raw);
    const testFile = resolve(process.cwd(), GENERATED_TEST);

    // 6 ── Reliability loop: static-validate → execute → diagnose → repair,
    //     repeating until the test passes or maxRepairAttempts is reached.
    stage('Validating');
    stage('Executing');
    stage('Recording video');
    const reliability = await generateUntilPass({
      initialCode: generated.code,
      scenario,
      observations,
      options: {
        apiKey: options.apiKey,
        maxRepairAttempts: options.maxRepairAttempts ?? 3,
        testFile,
        headed: options.headed,
        onAttempt: (a) =>
          console.log(
            `  attempt ${a.attemptNumber} [${a.source}]: ${a.execution.passed ? '✓ passed' : '✗ ' + (a.execution.diagnostics?.errorType ?? 'failed')}` +
            (a.validation.findings.some((f) => f.autoFixed) ? ' (deterministic fix applied)' : '')
          ),
      },
    });

    // Record this run into the persisted reliability metrics.
    const runRecord = toRunRecord({ targetUrl, scenarioTitle: scenario.title, outcome: reliability });
    recordRun(runRecord);

    // Reliability HTML report (timeline + metrics + final code).
    const reliabilityReport = renderReliabilityReport({
      scenario,
      outcome: reliability,
      aggregate: aggregate(loadMetrics()),
      appName: reasoningOutcome.result.applicationType,
    });
    writeRaw(artifactsDir, 'reliability-report.html', reliabilityReport);
    writeJSON(artifactsDir, 'reliability-outcome.json', {
      passed: reliability.passed,
      firstPassSuccess: reliability.firstPassSuccess,
      attempts: reliability.attempts.length,
      repairsUsed: reliability.repairAttemptsUsed,
      durationMs: reliability.totalDurationMs,
    });

    // 7 ── Report
    stage('Creating report');
    if (reliability.passed) {
      console.log(`\n✓ Test passed (${reliability.firstPassSuccess ? 'first try' : `${reliability.repairAttemptsUsed} repair(s)`})`);
    } else {
      console.log(
        `\n✗ Test failed after ${reliability.attempts.length} attempt(s) — artifacts preserved for review.`
      );
    }
    console.log(`\nDone. Reliability report: ${resolve(artifactsDir, 'reliability-report.html')}`);
    if (existsSync(resolve(process.cwd(), 'reports', 'index.html'))) {
      console.log(`      Execution dashboard: ${resolve(process.cwd(), 'reports', 'index.html')}`);
    }
    return {
      ok: true,
      stage: 'execute',
      testPassed: reliability.passed,
      reportPath: resolve(artifactsDir, 'reliability-report.html'),
    };
  } catch (error) {
    // Propagate LoginFailedError so the CLI can present it with evidence + suggestions.
    if (error instanceof LoginFailedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ Pipeline failed: ${message}`);
    console.error('  All completed artifacts have been preserved.');
    return { ok: false, error: message };
  }
}

function writeJSON(dir: string, name: string, value: unknown): void {
  writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function writeRaw(dir: string, name: string, value: string): void {
  writeFileSync(resolve(dir, name), value, 'utf-8');
}
