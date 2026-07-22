#!/usr/bin/env node
/**
 * ReplayQA Interactive CLI — one unified, menu-driven experience.
 *
 *   npm run replayqa                    → interactive mode (this module)
 *   npm run replayqa -- <url> [--yes]   → non-interactive pipeline (run/cli.ts)
 *
 * Walks the user through: discover → reason → plan → generate → execute,
 * with prompts for URL, credentials, and next-step choices at each stage.
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { runDiscovery } from '../core/discover.js';
import { loadObservations, reason } from '../reasoning-lab/index.js';
import { loadPlannerInput, generatePlan, renderMarkdown } from '../qa-planning-lab/index.js';
import { pickTopScenario, renderSummary } from '../run/summary.js';
import { generateTest } from '../run/generate.js';
import {
  generateUntilPass,
  recordRun,
  toRunRecord,
  loadMetrics,
  aggregate,
  renderReliabilityReport,
} from '../run/reliability/index.js';
import type { RepairAttempt } from '../run/reliability/types.js';
import { LoginFailedError, reportLoginFailure } from '../login/index.js';
import { normalizeUrl } from './args.js';
import { findConfigSync } from '../../config/index.js';

// ── ANSI helpers ───────────────────────────────────────────────────────────

const B = '\x1b[1m';   // bold
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function line(s = ''): void { console.log(s); }
function ok(s: string): void { console.log(`${GREEN}✓${RESET} ${s}`); }
function info(s: string): void { console.log(`${CYAN}ℹ${RESET} ${s}`); }
function warn(s: string): void { console.log(`${YELLOW}⚠${RESET} ${s}`); }
function err(s: string): void { console.log(`${RED}✗${RESET} ${s}`); }
function header(s: string): void { console.log(`\n${B}${CYAN}═══ ${s} ═══${RESET}\n`); }
function rule(): void { console.log(`${DIM}────────────────────────────────────────────${RESET}`); }

// ── Prompt helpers ─────────────────────────────────────────────────────────

async function ask(question: string, fallback?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = fallback !== undefined ? ` ${DIM}[${fallback}]${RESET}` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback || '';
  } finally { rl.close(); }
}

async function confirm(question: string, fallback = false): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = fallback ? '[Y/n]' : '[y/N]';
    const answer = (await rl.question(`${question} ${DIM}${suffix}${RESET} `)).trim().toLowerCase();
    return answer === '' ? fallback : (answer === 'y' || answer === 'yes');
  } finally { rl.close(); }
}

async function choose(title: string, options: string[]): Promise<number> {
  console.log(`\n${B}${title}${RESET}\n`);
  options.forEach((opt, i) => console.log(`  ${B}${i + 1}${RESET}. ${opt}`));
  console.log('');
  while (true) {
    const raw = await ask('Select');
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= options.length) return n - 1;
    warn(`Please enter a number 1–${options.length}`);
  }
}

async function askPassword(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(`${question}: `)).trim();
  } finally { rl.close(); }
}

// ── Main interactive loop ──────────────────────────────────────────────────

export async function runInteractive(): Promise<void> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  const config = findConfigSync();
  const artifactsDir = resolve(config.outputDir, 'discovery');

  // Session state
  let targetUrl = '';
  let creds: { username: string; password: string } | undefined;

  // Banner
  console.log(`
${B}${CYAN}
  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║   ReplayQA — Autonomous QA Discovery          ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝
${RESET}`);

  if (apiKey) info(`API key: configured (Cerebras / gpt-oss-120b)\n`);
  else warn(`CEREBRAS_API_KEY not set — AI stages will be unavailable.\n`);

  while (true) {
    const hasArtifacts = existsSync(resolve(artifactsDir, 'discovery.json'));
    const choice = await choose('What would you like to do?', [
      '🔍  Discover an application',
      hasArtifacts ? '🧠  AI Reasoning (understand the app)' : `${DIM}🧠  AI Reasoning (run discovery first)${RESET}`,
      hasArtifacts ? '📋  QA Planning (generate test plan)' : `${DIM}📋  QA Planning (run discovery first)${RESET}`,
      '🚀  Full Pipeline (discover → AI → plan → test → execute)',
      '🔬  Fingerprint Analysis',
      '📂  View Artifacts',
      '🚪  Exit',
    ]);

    switch (choice) {
      // ── DISCOVER ─────────────────────────────────────────────────────────
      case 0: {
        header('Discovery');
        const urlInput = await ask('Application URL');
        const url = normalizeUrl(urlInput || config.discovery?.targetUrl);
        if (!url) { err('No URL provided'); break; }
        targetUrl = url;

        if (await confirm('Does this app require login?', false)) {
          const username = await ask('Username');
          const password = await askPassword('Password');
          if (username && password) creds = { username, password };
        }

        const headed = await confirm('Watch the browser (headed mode)?', false);

        line('');
        ok('Starting discovery...');
        try {
          const result = await runDiscovery(url, { credentials: creds, headed, outputDir: artifactsDir });
          writeFileSync(resolve(artifactsDir, 'discovery.json'), JSON.stringify(result, null, 2) + '\n');

          line('');
          ok(`Discovery complete!`);
          line(`  Pages: ${result.pages.length}`);
          const states = countJson(resolve(artifactsDir, 'states'));
          const findings = countFindings(resolve(artifactsDir, 'findings'));
          const fg = readJsonSafe(resolve(artifactsDir, 'flow-graph.json'));
          const js = readJsonSafe(resolve(artifactsDir, 'journeys.json'));
          line(`  States: ${states}`);
          line(`  Findings: ${findings}`);
          line(`  Flows: ${fg?.edges?.length ?? 0}`);
          line(`  Journeys: ${Array.isArray(js) ? js.length : 0}`);
          line('');
          console.log('  Pages found:');
          for (const p of result.pages) console.log(`    ${GREEN}✓${RESET} ${p.title}`);
          line('');
          info(`Artifacts saved to: ${artifactsDir}`);
        } catch (e) {
          if (e instanceof LoginFailedError) { reportLoginFailure(e); }
          else { err(`Discovery failed: ${e instanceof Error ? e.message : String(e)}`); }
        }
        break;
      }

      // ── REASONING ────────────────────────────────────────────────────────
      case 1: {
        if (!apiKey) { err('CEREBRAS_API_KEY required for AI'); break; }
        if (!existsSync(resolve(artifactsDir, 'discovery.json'))) { warn('Run discovery first'); break; }
        header('AI Reasoning');
        ok('Loading observations...');
        try {
          const observations = await loadObservations(artifactsDir);
          line(`  Pages: ${observations.discoveredPages.length}, States: ${observations.exploredStates.length}, Flows: ${(observations as any).flowGraph?.edges?.length ?? 0}`);
          ok('Reasoning with LLM...');
          const outcome = await reason(observations, { apiKey });
          writeFileSync(resolve(artifactsDir, 'reasoning.json'), JSON.stringify(outcome.result, null, 2) + '\n');
          line('');
          rule();
          line(`${B}Application:${RESET} ${outcome.result.applicationType}`);
          line(`${B}Entities:${RESET}   ${outcome.result.entities.join(', ') || '(none)'}`);
          line(`${B}Caps:${RESET}       ${outcome.result.capabilities.join(', ') || '(none)'}`);
          line(`${B}Confidence:${RESET} ${(outcome.result.confidence * 100).toFixed(0)}%`);
          line('');
          if (outcome.result.flows.length) {
            line(`${B}Flows:${RESET}`);
            for (const f of outcome.result.flows) line(`  → ${f}`);
          }
          if (outcome.result.missingInformation.length) {
            line('');
            line(`${B}Blind spots:${RESET}`);
            for (const m of outcome.result.missingInformation) line(`  • ${m}`);
          }
          rule();
          line('');
          info(`Saved: ${resolve(artifactsDir, 'reasoning.json')}`);
        } catch (e) { err(`Reasoning failed: ${e instanceof Error ? e.message : String(e)}`); }
        break;
      }

      // ── QA PLANNING ──────────────────────────────────────────────────────
      case 2: {
        if (!apiKey) { err('CEREBRAS_API_KEY required for AI'); break; }
        if (!existsSync(resolve(artifactsDir, 'discovery.json'))) { warn('Run discovery first'); break; }
        header('QA Planning');
        ok('Generating QA test plan...');
        try {
          const planInput = await loadPlannerInput(artifactsDir);
          const outcome = await generatePlan(planInput, { apiKey });
          writeFileSync(resolve(artifactsDir, 'test-plan.json'), JSON.stringify(outcome.plan, null, 2) + '\n');
          writeFileSync(resolve(artifactsDir, 'test-plan.md'), renderMarkdown(outcome.plan), 'utf-8');

          line('');
          rule();
          const top = pickTopScenario(outcome.plan);
          console.log(renderSummary(outcome.plan, top));
          rule();
          line('');
          info(`Saved: ${resolve(artifactsDir, 'test-plan.md')}`);
        } catch (e) { err(`Planning failed: ${e instanceof Error ? e.message : String(e)}`); }
        break;
      }

      // ── FULL PIPELINE ────────────────────────────────────────────────────
      case 3: {
        if (!apiKey) { err('CEREBRAS_API_KEY required for AI'); break; }
        header('Full Pipeline');

        if (!targetUrl) {
          const urlInput = await ask('Application URL');
          const url = normalizeUrl(urlInput || config.discovery?.targetUrl);
          if (!url) { err('No URL provided'); break; }
          targetUrl = url;
        } else {
          info(`Using URL: ${targetUrl}`);
          if (!await confirm('Continue with this URL?', true)) {
            const urlInput = await ask('Application URL');
            targetUrl = normalizeUrl(urlInput) || targetUrl;
          }
        }

        if (!creds && await confirm('Does this app require login?', false)) {
          const username = await ask('Username');
          const password = await askPassword('Password');
          if (username && password) creds = { username, password };
        }
        const headed = await confirm('Watch the browser?', false);

        // 1. Discovery
        line('');
        ok('Step 1/5: Discovering application...');
        try {
          const result = await runDiscovery(targetUrl, { credentials: creds, headed, outputDir: artifactsDir });
          writeFileSync(resolve(artifactsDir, 'discovery.json'), JSON.stringify(result, null, 2) + '\n');
          ok(`  ${result.pages.length} pages discovered`);
        } catch (e) {
          if (e instanceof LoginFailedError) { reportLoginFailure(e); break; }
          err(`Discovery failed: ${e instanceof Error ? e.message : String(e)}`); break;
        }

        // 2. Reasoning
        ok('Step 2/5: Understanding application...');
        let reasoningResult: any;
        try {
          const observations = await loadObservations(artifactsDir);
          const r = await reason(observations, { apiKey });
          writeFileSync(resolve(artifactsDir, 'reasoning.json'), JSON.stringify(r.result, null, 2) + '\n');
          reasoningResult = r.result;
          ok(`  ${r.result.applicationType} (${(r.result.confidence * 100).toFixed(0)}% confidence)`);
        } catch (e) { err(`Reasoning failed: ${e instanceof Error ? e.message : String(e)}`); break; }

        // 3. Planning
        ok('Step 3/5: Generating QA plan...');
        let plan: any;
        try {
          const pi = await loadPlannerInput(artifactsDir);
          const p = await generatePlan(pi, { apiKey });
          writeFileSync(resolve(artifactsDir, 'test-plan.json'), JSON.stringify(p.plan, null, 2) + '\n');
          writeFileSync(resolve(artifactsDir, 'test-plan.md'), renderMarkdown(p.plan), 'utf-8');
          plan = p.plan;
          ok(`  ${p.plan.functionalScenarios.length} scenarios generated (${(p.plan.confidence * 100).toFixed(0)}% confidence)`);
        } catch (e) { err(`Planning failed: ${e instanceof Error ? e.message : String(e)}`); break; }

        // 4. Review + approve
        const scenario = pickTopScenario(plan);
        line('');
        rule();
        console.log(renderSummary(plan, scenario));
        rule();

        if (!scenario) { warn('No testable scenario found'); break; }
        const approved = await confirm('\nGenerate this test?', true);
        if (!approved) { info('Aborted. Artifacts preserved.'); break; }

        // 5. Generate + execute
        ok('Step 4/5: Generating Playwright test...');
        try {
          const observations = await loadObservations(artifactsDir);
          const generated = await generateTest(targetUrl, observations, reasoningResult, scenario, { apiKey });
          const testFile = resolve(process.cwd(), 'tests/replayqa-generated.spec.ts');

          ok('Step 5/5: Executing (with reliability loop)...');
          const outcome = await generateUntilPass({
            initialCode: generated.code,
            scenario,
            observations,
            options: { apiKey, maxRepairAttempts: 3, testFile, headed,
              onAttempt: (a: RepairAttempt) => console.log(`    attempt ${a.attemptNumber}: ${a.execution.passed ? `${GREEN}✓ passed${RESET}` : `${RED}✗ ${a.execution.diagnostics?.errorType ?? 'failed'}${RESET}`}`),
            },
          });

          line('');
          if (outcome.passed) {
            ok(`Test PASSED ${outcome.firstPassSuccess ? '(first try!)' : `(after ${outcome.repairAttemptsUsed} repair${outcome.repairAttemptsUsed === 1 ? '' : 's'})`}`);
          } else {
            err(`Test FAILED after ${outcome.attempts.length} attempts`);
          }

          // Reliability report
          recordRun(toRunRecord({ targetUrl, scenarioTitle: scenario.title, outcome }));
          const html = renderReliabilityReport({ scenario, outcome, aggregate: aggregate(loadMetrics()), appName: reasoningResult.applicationType });
          writeFileSync(resolve(artifactsDir, 'reliability-report.html'), html, 'utf-8');

          line('');
          info(`Reliability report: ${resolve(artifactsDir, 'reliability-report.html')}`);
          if (existsSync(resolve(process.cwd(), 'reports', 'index.html')))
            info(`Execution dashboard: ${resolve(process.cwd(), 'reports', 'index.html')}`);
        } catch (e) {
          if (e instanceof LoginFailedError) reportLoginFailure(e);
          else err(`Pipeline failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }

      // ── FINGERPRINT ──────────────────────────────────────────────────────
      case 4: {
        header('Fingerprint Analysis');
        const url = normalizeUrl(await ask('URL to analyze'));
        if (!url) { err('No URL'); break; }
        ok('Analyzing state fingerprints...');
        try {
          const { strategies } = await import('../state-lab/index.js');
          const { BrowserController } = await import('../browser/index.js');
          const controller = new BrowserController({ origin: new URL(url).origin, headed: false });
          await controller.open();
          await controller.goto(url);
          await controller.waitForStable();
          const materials = await controller.currentMaterials();
          await controller.close();
          line('');
          for (const s of strategies) {
            line(`  ${B}Strategy ${s.id}${RESET} — ${s.name}`);
            line(`    ${s.fingerprint(materials)}`);
            line('');
          }
        } catch (e) { err(`Fingerprint failed: ${e instanceof Error ? e.message : String(e)}`); }
        break;
      }

      // ── VIEW ARTIFACTS ───────────────────────────────────────────────────
      case 5: {
        header('Artifacts');
        if (!existsSync(artifactsDir)) { warn('No artifacts found'); break; }
        showArtifacts(artifactsDir);
        break;
      }

      // ── EXIT ─────────────────────────────────────────────────────────────
      case 6:
        line('');
        ok('Goodbye!');
        return;
    }

    line('');
    await ask(`${DIM}Press Enter to continue...${RESET}`, '');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countJson(dir: string): number {
  try { return readdirSync(dir).filter((f) => f.endsWith('.json')).length; } catch { return 0; }
}

function countFindings(dir: string): number {
  try {
    let n = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const doc = JSON.parse(readFileSync(resolve(dir, f), 'utf-8'));
      if (Array.isArray(doc.findings)) n += doc.findings.length;
    }
    return n;
  } catch { return 0; }
}

function readJsonSafe(path: string): any {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function showArtifacts(dir: string): void {
  const show = (name: string, path: string): void => {
    if (existsSync(path)) {
      const stat = statSync(path);
      const size = stat.isDirectory() ? `${countJson(path)} files` : `${(stat.size / 1024).toFixed(1)} KB`;
      line(`  ${GREEN}✓${RESET} ${name.padEnd(25)} ${DIM}${size}${RESET}`);
    }
  };

  show('discovery.json', resolve(dir, 'discovery.json'));
  show('reasoning.json', resolve(dir, 'reasoning.json'));
  show('test-plan.json', resolve(dir, 'test-plan.json'));
  show('test-plan.md', resolve(dir, 'test-plan.md'));
  show('flow-graph.json', resolve(dir, 'flow-graph.json'));
  show('journeys.json', resolve(dir, 'journeys.json'));
  show('flow-report.html', resolve(dir, 'flow-report.html'));
  show('reliability-report.html', resolve(dir, 'reliability-report.html'));
  show('states/', resolve(dir, 'states'));
  show('findings/', resolve(dir, 'findings'));
  line('');
  info(`Location: ${dir}`);
}
