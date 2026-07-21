#!/usr/bin/env node
import { resolve } from 'node:path';
import { rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runDiscovery } from '../core/discover.js';
import { loadObservations, reason } from '../reasoning-lab/index.js';
import { loadPlannerInput, generatePlan } from '../qa-planning-lab/index.js';

const HERE = resolve(process.cwd());
const FIXTURE_CRUD = pathToFileURL(resolve(HERE, 'src/discovery/state-lab/fixture/sample-app.html')).href;
const FIXTURE_AUTH = pathToFileURL(resolve(HERE, 'src/discovery/state-lab/fixture/auth-app.html')).href;

interface Target {
  name: string;
  category: string;
  url: string;
  creds?: { username: string; password: string };
}

const TARGETS: Target[] = [
  { name: 'TodoMVC (Vue)', category: 'SPA Todo CRUD', url: 'https://todomvc.com/examples/vue/dist/' },
  { name: 'OrangeHRM Demo', category: 'HR Admin (auth)', url: 'https://opensource-demo.orangehrmlive.com/', creds: { username: 'Admin', password: 'admin123' } },
  { name: 'SauceDemo', category: 'E-commerce (auth)', url: 'https://www.saucedemo.com/', creds: { username: 'standard_user', password: 'secret_sauce' } },
  { name: 'The Internet', category: 'Testing Playground', url: 'https://the-internet.herokuapp.com/' },
  { name: 'Auth Fixture', category: 'Control (auth CRUD)', url: FIXTURE_AUTH, creds: { username: 'admin', password: 'secret' } },
  { name: 'CRUD Fixture', category: 'Control (no-auth CRUD)', url: FIXTURE_CRUD },
];

interface Metrics {
  name: string;
  category: string;
  url: string;
  authenticated: boolean;
  status: 'success' | 'failed';
  error?: string;
  pages: number;
  states: number;
  findings: number;
  flowEdges: number;
  flowSkipped: number;
  journeys: number;
  reasoningConfidence: number;
  entities: string[];
  capabilities: string[];
  reasoningMissing: number;
  planConfidence: number;
  planScenarios: number;
  planBlindSpots: number;
  durationMs: number;
}

async function main() {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) { console.error('CEREBRAS_API_KEY required'); process.exit(2); }

  const benchDir = resolve(HERE, 'artifacts/benchmark');
  rmSync(benchDir, { recursive: true, force: true });
  mkdirSync(benchDir, { recursive: true });

  const results: Metrics[] = [];

  for (const target of TARGETS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Benchmarking: ${target.name} (${target.category})`);
    console.log(`${'═'.repeat(60)}`);

    const slug = target.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const outDir = resolve(benchDir, slug);
    mkdirSync(outDir, { recursive: true });
    const t0 = Date.now();

    const m: Metrics = {
      name: target.name, category: target.category, url: target.url,
      authenticated: Boolean(target.creds), status: 'success',
      pages: 0, states: 0, findings: 0, flowEdges: 0, flowSkipped: 0, journeys: 0,
      reasoningConfidence: 0, entities: [], capabilities: [], reasoningMissing: 0,
      planConfidence: 0, planScenarios: 0, planBlindSpots: 0, durationMs: 0,
    };

    try {
      // 1. Discovery
      console.log('  → discovery...');
      const discovery = await runDiscovery(target.url, {
        credentials: target.creds, outputDir: outDir, maxPages: 10, maxProbesPerState: 5,
      });
      // runDiscovery returns the result but doesn't write discovery.json (the CLI does).
      writeFileSync(resolve(outDir, 'discovery.json'), JSON.stringify(discovery, null, 2) + '\n', 'utf-8');
      m.pages = discovery.pages.length;

      // Count states, findings
      m.states = countJson(resolve(outDir, 'states'));
      m.findings = countFindings(resolve(outDir, 'findings'));

      // Flow graph + journeys
      const fg = readJsonSafe(resolve(outDir, 'flow-graph.json'));
      m.flowEdges = fg?.edges?.length ?? 0;
      m.flowSkipped = fg?.skipped?.length ?? 0;
      const js = readJsonSafe(resolve(outDir, 'journeys.json'));
      m.journeys = Array.isArray(js) ? js.length : 0;

      // 2. Reasoning
      console.log('  → reasoning...');
      const observations = await loadObservations(outDir);
      const reasoningOutcome = await reason(observations, { apiKey });
      writeFileSync(resolve(outDir, 'reasoning.json'), JSON.stringify(reasoningOutcome.result, null, 2) + '\n');
      m.reasoningConfidence = reasoningOutcome.result.confidence;
      m.entities = reasoningOutcome.result.entities;
      m.capabilities = reasoningOutcome.result.capabilities;
      m.reasoningMissing = reasoningOutcome.result.missingInformation.length;

      // 3. QA Planning
      console.log('  → planning...');
      const planInput = await loadPlannerInput(outDir);
      const planOutcome = await generatePlan(planInput, { apiKey });
      writeFileSync(resolve(outDir, 'test-plan.json'), JSON.stringify(planOutcome.plan, null, 2) + '\n');
      m.planConfidence = planOutcome.plan.confidence;
      m.planScenarios = planOutcome.plan.functionalScenarios.length;
      m.planBlindSpots = planOutcome.plan.missingInformation.length;

      console.log(`  ✓ pages=${m.pages} states=${m.states} flows=${m.flowEdges} journeys=${m.journeys} conf=${m.planConfidence}`);
    } catch (error) {
      m.status = 'failed';
      m.error = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ FAILED: ${m.error}`);
    }

    m.durationMs = Date.now() - t0;
    results.push(m);
  }

  // Summary table
  console.log(`\n${'═'.repeat(60)}`);
  console.log('BENCHMARK SUMMARY');
  console.log(`${'═'.repeat(60)}\n`);
  console.log(
    'App'.padEnd(20) + 'Status'.padEnd(10) +
    'Pages'.padStart(6) + 'States'.padStart(7) + 'Flows'.padStart(6) +
    'Journey'.padStart(8) + 'RConf'.padStart(7) + 'PConf'.padStart(7) +
    'Scen'.padStart(5) + 'Blind'.padStart(6) + 'Time'.padStart(7)
  );
  console.log('-'.repeat(89));
  for (const r of results) {
    console.log(
      r.name.padEnd(20) +
      (r.status === 'success' ? '✓'.padEnd(10) : '✗ FAIL'.padEnd(10)) +
      String(r.pages).padStart(6) +
      String(r.states).padStart(7) +
      String(r.flowEdges).padStart(6) +
      String(r.journeys).padStart(8) +
      r.reasoningConfidence.toFixed(2).padStart(7) +
      r.planConfidence.toFixed(2).padStart(7) +
      String(r.planScenarios).padStart(5) +
      String(r.planBlindSpots).padStart(6) +
      `${(r.durationMs / 1000).toFixed(0)}s`.padStart(7)
    );
  }

  // Persist
  writeFileSync(resolve(benchDir, 'benchmark-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf-8');
  console.log(`\nResults: ${resolve(benchDir, 'benchmark-results.json')}`);
}

function countJson(dir: string): number {
  try { return readdirSync(dir).filter(f => f.endsWith('.json')).length; } catch { return 0; }
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

main().catch(e => { console.error(e); process.exit(1); });
