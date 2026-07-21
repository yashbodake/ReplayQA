#!/usr/bin/env node
/**
 * State Fingerprint Laboratory — experiment runner.
 *
 * Runs a scripted sequence of actions (refresh / open modal / close modal /
 * search / clear / navigate away / navigate back) against a target, captures
 * all five fingerprints at each step, and prints a comparison table showing
 * which strategies changed vs. the baseline.
 *
 * Always runs the controlled local fixture. If a URL is passed as argv[2],
 * also runs a generic live experiment (reload → click first link → go back).
 *
 *   npx tsx src/discovery/state-lab/experiment.ts [url]
 */
import { chromium, type Page } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectMaterials, strategies, type StateMaterials } from './index.js';

const INIT_SCRIPT =
  'globalThis.__name = (t, v) => { try { Object.defineProperty(t, "name", { value: v, configurable: true }); } catch (e) {} return t; };';

// Resolved relative to the project root (the lab is run via `npm run` from root).
const FIXTURE_URL = pathToFileURL(
  resolve(process.cwd(), 'src/discovery/state-lab/fixture/sample-app.html')
).href;

interface Step {
  label: string;
  expect: 'same' | 'change' | 'return';
  action: (page: Page) => Promise<unknown>;
}

const FIXTURE_STEPS: Step[] = [
  { label: 'reload', expect: 'same', action: (p) => p.reload({ waitUntil: 'domcontentloaded' }) },
  { label: 'open modal', expect: 'change', action: (p) => p.click('#add') },
  { label: 'close modal', expect: 'return', action: (p) => p.click('#close') },
  { label: 'search "Bob"', expect: 'same', action: (p) => p.fill('#search', 'Bob') },
  { label: 'clear search', expect: 'return', action: (p) => p.fill('#search', '') },
  { label: 'nav to #home', expect: 'change', action: (p) => p.click('a[href="#home"]') },
  { label: 'nav back to #list', expect: 'return', action: (p) => p.click('a[href="#list"]') },
];

function liveSteps(): Step[] {
  // PhoneBook-aware: the login page toggles between "Sign in" and "Sign up"
  // views. This is the crucial SPA case where the URL may NOT change while the
  // visible UI does — exactly what URL-only fingerprinting cannot handle.
  return [
    { label: 'reload', expect: 'same', action: (p) => p.reload({ waitUntil: 'domcontentloaded' }) },
    {
      label: 'toggle login→register',
      expect: 'change',
      action: async (p) => {
        await p.getByRole('link', { name: /sign up/i }).click();
      },
    },
    {
      label: 'toggle register→login',
      expect: 'return',
      action: async (p) => {
        await p.getByRole('link', { name: /sign in/i }).click();
      },
    },
  ];
}

type HashRow = Record<string, string>;

function hashAll(m: StateMaterials): HashRow {
  const row: HashRow = {};
  for (const s of strategies) row[s.id] = s.fingerprint(m);
  return row;
}

async function stabilize(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
  // Real SPAs finish a view toggle slightly after networkidle; wait long
  // enough that we fingerprint the settled state, not a mid-transition one.
  await page.waitForTimeout(450);
}

async function runExperiment(label: string, target: string, steps: Step[]): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();

  console.log(`\n=== State Fingerprint Experiment — ${label} ===`);
  console.log(`Target: ${target}\n`);

  const rows: { step: string; expect: Step['expect']; hashes: HashRow }[] = [];

  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await stabilize(page);
    const baseline = hashAll(await collectMaterials(page));
    rows.push({ step: 'baseline', expect: 'same', hashes: baseline });

    for (const step of steps) {
      try {
        await step.action(page);
      } catch (e) {
        console.error(`  (step "${step.label}" failed: ${(e as Error).message})`);
      }
      await stabilize(page);
      const hashes = hashAll(await collectMaterials(page));
      rows.push({ step: step.label, expect: step.expect, hashes });
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  printTable(rows);
  printSummary(rows);
}

function printTable(rows: { step: string; expect: Step['expect']; hashes: HashRow }[]): void {
  const ids = strategies.map((s) => s.id);
  const stepWidth = Math.max(8, ...rows.map((r) => r.step.length));
  const header =
    `${'Step'.padEnd(stepWidth)}  Expect    ` +
    ids.map((id) => id.padEnd(10)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of rows) {
    const line = `${r.step.padEnd(stepWidth)}  ${r.expect.padEnd(8)}  `;
    if (r.step === 'baseline') {
      console.log(line + ids.map((id) => r.hashes[id].padEnd(10)).join(''));
    } else {
      const baseline = rows[0].hashes;
      const marks = ids
        .map((id) => (r.hashes[id] !== baseline[id] ? 'CHANGE' : '·'))
        .map((m) => m.padEnd(10))
        .join('');
      console.log(line + marks);
    }
  }
}

function printSummary(rows: { step: string; expect: Step['expect']; hashes: HashRow }[]): void {
  const ids = strategies.map((s) => s.id);
  const baseline = rows[0].hashes;
  let falsePos = 0;
  let falseNeg = 0;
  let noReturn = 0;

  for (const r of rows.slice(1)) {
    for (const id of ids) {
      const changed = r.hashes[id] !== baseline[id];
      if (r.expect === 'change') {
        if (!changed) falseNeg++;
      } else if (r.expect === 'same') {
        if (changed) falsePos++;
      } else {
        // return
        if (changed) noReturn++;
      }
    }
  }

  console.log('\nVerdict (count of strategy×step incidents):');
  console.log(`  False negatives (missed a real change): ${falseNeg}`);
  console.log(`  False positives (changed on data/same state): ${falsePos}`);
  console.log(`  No-return (did not return to baseline): ${noReturn}`);
}

async function main(): Promise<void> {
  await runExperiment('fixture (controlled)', `${FIXTURE_URL}#list`, FIXTURE_STEPS);
  const liveUrl = process.argv[2];
  if (liveUrl) {
    await runExperiment('live', liveUrl, liveSteps());
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
