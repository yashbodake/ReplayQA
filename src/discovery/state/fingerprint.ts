import { createHash } from 'node:crypto';
import type { StateMaterials } from '../browser/materials.js';

/**
 * State fingerprinting — the accepted Strategy E from
 * docs/discovery/state-fingerprint-report.md, now the project standard.
 *
 * This module is PURE (no Playwright, no side-effects). It depends only on the
 * shape of {@link StateMaterials}. The browser layer extracts the materials;
 * this layer hashes them. Keeping them separate means the hash can be unit-
 * tested against fixture materials with no browser.
 */

/**
 * Deterministic short fingerprint: SHA-256 of the canonical string, truncated
 * to 8 uppercase hex chars (32 bits — collision-safe for the scale of a single
 * app's state space, which is in the tens to low hundreds).
 */
export function fingerprintHash(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 8).toUpperCase();
}

/**
 * The canonical string the accepted strategy (E) hashes. Exposed so callers
 * can inspect exactly what produced an id (debugging, regression fixtures).
 *
 * Strategy E = URL + a11y role tree + DOM tag tree + interactive surface +
 * component flags + navigation signature. Every component is already
 * collapse/dedup-normalized by the materials extractor.
 */
export function buildStateCanonical(m: StateMaterials): string {
  return (
    `${m.url}\n` +
    `${m.a11yRoleTree}\n` +
    `${m.domTagTree}\n` +
    `${m.interactive.join('\n')}\n` +
    `${m.components}\n` +
    `${m.navSignature}`
  );
}

/**
 * Compute the stateId (the accepted Strategy E fingerprint) for a set of
 * collected materials. This is the function the StateManager uses to decide
 * whether two captures are the same application state.
 */
export function computeStateId(m: StateMaterials): string {
  return fingerprintHash(buildStateCanonical(m));
}
