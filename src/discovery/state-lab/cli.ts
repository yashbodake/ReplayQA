#!/usr/bin/env node
import { chromium } from 'playwright';
import { collectMaterials, strategies } from './index.js';

const INIT_SCRIPT =
  'globalThis.__name = (t, v) => { try { Object.defineProperty(t, "name", { value: v, configurable: true }); } catch (e) {} return t; };';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npm run fingerprint -- <url>');
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

    const materials = await collectMaterials(page);

    console.log('Current State\n');
    for (const s of strategies) {
      console.log(`Strategy ${s.id} — ${s.name}`);
      console.log(s.fingerprint(materials));
      console.log('');
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
