import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runDiscovery } from '../core/discover.js';
import { loadObservations, reason } from '../reasoning-lab/index.js';
import { loadPlannerInput, generatePlan, renderMarkdown } from '../qa-planning-lab/index.js';
import { generateTest } from './generate.js';
import { generateUntilPass, recordRun, toRunRecord, loadMetrics, aggregate, renderReliabilityReport } from './reliability/index.js';
import { LoginFailedError } from '../login/index.js';
import { pickTopScenario } from './summary.js';
import type { TestScenario } from '../qa-planning-lab/types.js';
import { promptApproval } from './approval.js';
import type { DiscoveryCredentials } from '../../config/types.js';
import { TimelineRecorder, narrate } from '../../narration/index.js';

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
  /** Produce the narrated summary video after the run (default: on). */
  narrate?: boolean;
  /** Inject a pre-built timeline recorder (e.g. from a parent process). */
  recorder?: TimelineRecorder;
  /** Specific scenario IDs to generate (e.g. ['TC-005','TC-007']). When set,
   *  the orchestrator filters the plan to these IDs and loops over them.
   *  When not set, auto-picks the top-priority scenario. */
  scenarioIds?: string[];
}

export interface RunResult {
  ok: boolean;
  stage?: string;
  error?: string;
  testPassed?: boolean;
  reportPath?: string;
}

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

  // Timeline recorder (Refinement #1): real, streamed runtime events. One
  // recorder owns the whole run; discovery emits via the onEvent hook and the
  // orchestrator emits at stage boundaries.
  const narrationEnabled = options.narrate !== false && process.env.NARRATION_ENABLED !== 'false';
  const recorder =
    options.recorder ??
    new TimelineRecorder({
      runId: `run-${Date.now()}`,
      file: resolve(artifactsDir, 'narration', 'timeline.json'),
    });
  recorder.record('run-started', { url: targetUrl }, 'high');

  try {
    // 1 ── Discovery (BrowserController + StateManager + DetectorManager)
    stage('Discovering application');
    recorder.record('discovery-started', { url: targetUrl }, 'high');
    const discovery = await runDiscovery(targetUrl, {
      headed: options.headed,
      credentials: options.credentials,
      outputDir: artifactsDir,
      onEvent: (type, metadata) => recorder.record(type, metadata ?? {}, type === 'authenticated' || type === 'login-failed' ? 'high' : 'medium'),
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
    recorder.record('reasoning-completed', {
      applicationType: reasoningOutcome.result.applicationType,
      confidence: reasoningOutcome.result.confidence,
    }, 'high');

    // 3 ── QA Planning
    stage('Generating QA plan');
    const planInput = await loadPlannerInput(artifactsDir);
    const planOutcome = await generatePlan(planInput, { apiKey: options.apiKey });
    writeJSON(artifactsDir, 'test-plan.json', planOutcome.plan);
    writeRaw(artifactsDir, 'test-plan.md', renderMarkdown(planOutcome.plan));
    writeRaw(artifactsDir, 'test-plan.raw.txt', planOutcome.raw);
    recorder.record('qa-plan-generated', {
      scenarioCount: planOutcome.plan.functionalScenarios.length,
      confidence: planOutcome.plan.confidence,
    }, 'high');

    // 4 ── Review + approval gate
    // If scenarioIds provided, filter the plan to those; otherwise auto-pick top.
    let scenarios: TestScenario[];
    if (options.scenarioIds && options.scenarioIds.length > 0) {
      scenarios = planOutcome.plan.functionalScenarios.filter(s =>
        options.scenarioIds!.includes(s.id)
      );
      // If none matched, fall back to top scenario.
      if (scenarios.length === 0) scenarios = [pickTopScenario(planOutcome.plan)!].filter(Boolean);
    } else {
      const top = pickTopScenario(planOutcome.plan);
      scenarios = top ? [top] : [];
    }

    if (scenarios.length === 0 || !scenarios[0]) {
      console.log('No testable scenario was identified — aborting before generation.');
      console.log('Artifacts preserved under artifacts/discovery/.');
      recorder.record('run-finished', { reason: 'no-scenario' }, 'medium');
      return { ok: true, stage: 'plan' };
    }

    const approved = options.yes
      ? true
      : await promptApproval(`Generate ${scenarios.length} test(s)? [Y/n] `);
    if (!approved) {
      console.log('\nAborted. Artifacts preserved under artifacts/discovery/.');
      recorder.record('run-finished', { reason: 'aborted' }, 'medium');
      return { ok: true, stage: 'plan' };
    }

    // 5+6 ── Generate + execute each selected scenario
    let lastScenario = scenarios[0];
    let lastReliability: { passed: boolean; firstPassSuccess: boolean; repairAttemptsUsed: number; attempts: unknown[]; totalDurationMs: number } | undefined;
    const scenarioResults: { id: string; title: string; passed: boolean; attempts: number; repairsUsed: number; durationMs: number }[] = [];

    for (const scenario of scenarios) {
      stage(`Generating ${scenario.id}: ${scenario.title}`);
      recorder.record('generation-started', { scenarioId: scenario.id, scenarioTitle: scenario.title }, 'high');
      const generated = await generateTest(
        targetUrl,
        observations,
        reasoningOutcome.result,
        scenario,
        { apiKey: options.apiKey, credentials: options.credentials }
      );
      writeRaw(artifactsDir, `generated-test-${scenario.id}.raw.txt`, generated.raw);
      // Per-scenario test file
      const safeId = scenario.id.replace(/[^a-zA-Z0-9-]/g, '-');
      const testFile = resolve(process.cwd(), `tests/replayqa-generated-${safeId}.spec.ts`);

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
          credentials: options.credentials,
          scenarioId: scenario.id,
          onAttempt: (a) => {
            recorder.record('repair-attempt', {
              attempt: a.attemptNumber,
              source: a.source,
              passed: a.execution.passed,
            }, a.execution.passed ? 'high' : 'medium');
            console.log(
              `  attempt ${a.attemptNumber} [${a.source}]: ${a.execution.passed ? '✓ passed' : '✗ ' + (a.execution.diagnostics?.errorType ?? 'failed')}` +
              (a.validation.findings.some((f) => f.autoFixed) ? ' (deterministic fix applied)' : '')
            );
          },
        },
      });
      recorder.record(
        reliability.passed ? 'execution-passed' : 'execution-failed',
        { attempts: reliability.attempts.length, repairsUsed: reliability.repairAttemptsUsed, firstPassSuccess: reliability.firstPassSuccess },
        'high'
      );

      recordRun(toRunRecord({ targetUrl, scenarioTitle: scenario.title, outcome: reliability }));
      lastScenario = scenario;
      lastReliability = reliability;

      console.log(`\n  ${scenario.id}: ${reliability.passed ? '✓ PASSED' : '✗ FAILED'}${reliability.firstPassSuccess ? ' (first try)' : reliability.repairAttemptsUsed > 0 ? ` (${reliability.repairAttemptsUsed} repair(s))` : ''}`);

      // Track per-scenario results for the HTML report.
      scenarioResults.push({
        id: scenario.id,
        title: scenario.title,
        passed: reliability.passed,
        attempts: reliability.attempts.length,
        repairsUsed: reliability.repairAttemptsUsed,
        durationMs: reliability.totalDurationMs,
      });

      // Preserve this scenario's video before the next test overwrites it.
      preserveScenarioVideo(scenario.id, resolve(process.cwd(), 'artifacts', 'test-output'));
    }

    const reliability = lastReliability!;
    const scenario = lastScenario;

    // Reliability HTML report (for the last scenario)
    const reliabilityReport = renderReliabilityReport({
      scenario,
      outcome: reliability as never,
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
    recorder.record('report-generated', { reliabilityReport: resolve(artifactsDir, 'reliability-report.html') }, 'medium');
    if (reliability.passed) {
      console.log(`\n✓ Test passed (${reliability.firstPassSuccess ? 'first try' : `${reliability.repairAttemptsUsed} repair(s)`})`);
    } else {
      console.log(
        `\n✗ Test failed after ${reliability.attempts.length} attempt(s) — artifacts preserved for review.`
      );
    }

    // 8 ── Walkthrough (always run — produces the cinematic video).
    //    Records a paced, interactive walkthrough of the app's features on
    //    camera. This replaces the raw test-execution clip (which is fast,
    //    repetitive, and shows the reliability loop) with a polished demo
    //    that has natural pacing — login shown slowly, each feature explored
    //    once with pauses.
    let walkthroughChapters: import('../../walkthrough/walkthrough.js').WalkthroughChapter[] | undefined;
    let walkthroughVideoPath: string | undefined;
    if (narrationEnabled) {
      stage('Recording interactive walkthrough');
      recorder.record('walkthrough-started', {}, 'high');
      try {
        const { recordWalkthrough } = await import('../../walkthrough/walkthrough.js');
        const walkthrough = await recordWalkthrough({
          targetUrl,
          credentials: options.credentials,
          outputDir: resolve(process.cwd(), 'artifacts', 'walkthrough'),
          artifactsDir,
          headed: options.headed,
        });
        recorder.record('walkthrough-finished', { ok: walkthrough.ok, steps: walkthrough.performedSteps }, 'high');
        if (walkthrough.ok && walkthrough.videoPath) {
          walkthroughChapters = walkthrough.chapters;
          walkthroughVideoPath = walkthrough.videoPath;
          console.log(`\n  walkthrough: ${walkthrough.performedSteps}/${walkthrough.totalSteps} steps, ${walkthrough.chapters.length} chapters`);
        } else {
          console.log(`\n· Walkthrough skipped: ${walkthrough.error ?? 'no video'}`);
        }
      } catch (e) {
        console.log(`\n· Walkthrough failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 9 ── Narration (non-fatal: a failure here never invalidates earlier work).
    //    Uses the walkthrough video (cinematic) if available, otherwise falls
    //    back to the test-execution clip.
    let summaryPath: string | undefined;
    if (narrationEnabled) {
      stage('Generating narration');
      const narration = await narrate({
        apiKey: options.apiKey,
        artifactsDir,
        reportDir: resolve(process.cwd(), 'reports'),
        ...(walkthroughVideoPath && walkthroughChapters
          ? { walkthrough: { videoPath: walkthroughVideoPath, chapters: walkthroughChapters } }
          : {}),
      });
      if (narration.ok) {
        summaryPath = narration.summaryPath;
        console.log(`\n✓ Narrated summary: ${narration.summaryPath}` +
          (narration.durationMs ? ` (${(narration.durationMs / 1000).toFixed(1)}s)` : ''));
      } else {
        console.log(`\n· Narration skipped: ${narration.error}`);
      }
    }

    // 10 ── Inject multi-scenario summary into the HTML report.
    //    The Playwright reporter only shows the LAST test's results. We inject
    //    a section showing ALL scenarios (pass/fail + preserved videos) + the
    //    narration script, so the report is the single place to see everything.
    try {
      const { injectScenarioSummary } = await import('../../reporter/scenario-summary.js');
      const reportHtml = resolve(process.cwd(), 'reports', 'index.html');

      // Load overview data from artifacts.
      const discoveryData = JSON.parse(readFileSync(resolve(artifactsDir, 'discovery.json'), 'utf-8'));
      const reasoningData = JSON.parse(readFileSync(resolve(artifactsDir, 'reasoning.json'), 'utf-8'));
      const planData = JSON.parse(readFileSync(resolve(artifactsDir, 'test-plan.json'), 'utf-8'));
      const flowData = existsSync(resolve(artifactsDir, 'flow-graph.json'))
        ? JSON.parse(readFileSync(resolve(artifactsDir, 'flow-graph.json'), 'utf-8'))
        : { edges: [] };
      let narrationMeta: Record<string, unknown> = {};
      try { narrationMeta = JSON.parse(readFileSync(resolve(artifactsDir, 'narration', 'narration-meta.json'), 'utf-8')); } catch { /* ok */ }

      const passedCount = scenarioResults.filter(s => s.passed).length;
      const failedCount = scenarioResults.length - passedCount;

      injectScenarioSummary({
        reportPath: reportHtml,
        scenarios: scenarioResults,
        videosDir: resolve(process.cwd(), 'artifacts', 'videos'),
        scriptPath: resolve(artifactsDir, 'narration', 'script.md'),
        narrationVideoPath: summaryPath,
        overview: {
          targetUrl,
          timestamp: new Date().toISOString(),
          pagesDiscovered: discoveryData.pages?.length ?? 0,
          flowsDiscovered: flowData.edges?.length ?? 0,
          appType: reasoningData.applicationType,
          entities: reasoningData.entities,
          capabilities: reasoningData.capabilities,
          reasoningConfidence: reasoningData.confidence,
          totalScenarios: planData.functionalScenarios?.length ?? 0,
          selectedCount: scenarioResults.length,
          passedCount,
          failedCount,
          planConfidence: planData.confidence,
          ttsProvider: narrationMeta.provider as string | undefined,
          ttsVoice: narrationMeta.voice as string | undefined,
          narrationStyle: narrationMeta.narrationStyle as string | undefined,
          musicTrack: (narrationMeta.music as string | undefined),
          summaryDurationMs: narrationMeta.totalDurationMs as number | undefined,
        },
      });
    } catch { /* best-effort — report injection is non-critical */ }

    recorder.record('run-finished', { passed: reliability.passed, summaryProduced: Boolean(summaryPath) }, 'high');

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
    if (error instanceof LoginFailedError) {
      recorder.record('run-finished', { reason: 'login-failed' }, 'high');
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    recorder.record('run-finished', { reason: 'error', error: message }, 'high');
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

/**
 * Copy the latest test execution video to a per-scenario path so it isn't
 * overwritten when the next test runs. Playwright writes to
 * artifacts/test-output/<test-slug>/video.webm — each run replaces the
 * previous. This copies it to artifacts/test-output/videos/{scenarioId}.webm.
 */
function preserveScenarioVideo(scenarioId: string, testOutputDir: string): void {
  try {
    const { readdirSync, copyFileSync, mkdirSync, statSync } = require('node:fs');
    const videosDir = resolve(testOutputDir, 'videos');
    mkdirSync(videosDir, { recursive: true });
    // Find the most recently modified video.webm
    let latestVideo: string | undefined;
    let latestMtime = 0;
    function searchDir(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory() && !entry.startsWith('videos')) {
          searchDir(full);
        } else if (entry === 'video.webm' && stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestVideo = full;
        }
      }
    }
    searchDir(testOutputDir);
    if (latestVideo) {
      const dest = resolve(videosDir, `${scenarioId}.webm`);
      copyFileSync(latestVideo, dest);
    }
  } catch { /* best-effort — don't fail the pipeline over video preservation */ }
}
