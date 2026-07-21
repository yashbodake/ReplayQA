import type { RawSnapshot } from '../models/snapshot.js';

/**
 * Compute human-readable change descriptions between two snapshots.
 * Used at probe time to annotate each transition edge with WHAT changed
 * (e.g. "Save button appeared", "form opened", "login form removed").
 */
export function computeChanges(base: RawSnapshot, probed: RawSnapshot): string[] {
  const changes: string[] = [];

  const baseButtons = new Set(base.buttons);
  const probedButtons = new Set(probed.buttons);
  for (const b of probedButtons) if (!baseButtons.has(b)) changes.push(`"${b}" button appeared`);
  for (const b of baseButtons) if (!probedButtons.has(b)) changes.push(`"${b}" button disappeared`);

  const baseLinks = new Set(base.links);
  const probedLinks = new Set(probed.links);
  for (const l of probedLinks) if (!baseLinks.has(l)) changes.push(`"${l}" link appeared`);
  for (const l of baseLinks) if (!probedLinks.has(l)) changes.push(`"${l}" link disappeared`);

  if (base.forms.length < probed.forms.length) {
    changes.push(`form opened (${probed.forms.length - base.forms.length} new form)`);
  }
  if (base.forms.length > probed.forms.length) {
    changes.push(`form closed (${base.forms.length - probed.forms.length} removed)`);
  }

  if (base.hasPassword && !probed.hasPassword) changes.push('login form removed');
  if (!base.hasPassword && probed.hasPassword) changes.push('login form appeared');

  if (base.heading !== probed.heading && probed.heading) {
    changes.push(`heading changed to "${probed.heading}"`);
  }

  return changes;
}
