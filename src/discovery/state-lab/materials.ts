import type { Page } from 'playwright';
import {
  canonicalUrl,
  extractMaterials,
  ROLE_BY_TAG,
  type StateMaterials,
} from '../browser/materials.js';

// Re-export so existing lab imports (`from './materials.js'`) keep working.
export type { StateMaterials };

/**
 * Lab adapter: gather fingerprint materials directly from a Playwright `Page`.
 *
 * The actual extraction (`extractMaterials`) and role map (`ROLE_BY_TAG`) are
 * the PRODUCTION implementations, imported from `browser/materials.ts`. This
 * means the lab is always testing the same algorithm the StateManager ships —
 * there is no second copy to drift.
 *
 * Production code goes through `BrowserController.currentMaterials()` instead
 * of calling this; the lab calls this directly because it is intentionally
 * Playwright-coupled for its experiment scripts.
 */
export async function collectMaterials(page: Page): Promise<StateMaterials> {
  const extracted = await page.evaluate(extractMaterials, ROLE_BY_TAG);
  return { ...extracted, url: canonicalUrl(page.url()) };
}
