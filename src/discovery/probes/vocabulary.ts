import type { ActionClassification, SafetyClassification } from './types.js';

/**
 * Action Probe safety policy.
 *
 * ReplayQA probes ONLY actions that OPEN an interactive state (a modal, drawer,
 * tab, form, expandable section) for observation. It NEVER probes actions that
 * could mutate or destroy data, end a session, or commit a transaction.
 *
 * The policy is vocabulary-based and intentionally conservative: any action
 * whose label is not clearly an "open / expand" verb is classified `unknown`
 * and skipped. Every skip is recorded with its reason (see graph.ts), so the
 * safety policy is fully auditable on disk.
 */

/**
 * Destructive verbs — NEVER probed. Matches whole words, case-insensitive.
 * Source: the milestone's explicit list + common variants.
 */
export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\barchive\b/i,
  /\breset\b/i,
  /\bpurge\b/i,
  /\blogout\b/i,
  /\bsign\s*out\b/i,
  /\bsignout\b/i,
  /\bpay\b/i,
  /\bpayment\b/i,
  /\bpurchase\b/i,
  /\bbuy\b/i,
  /\bconfirm\s+purchase\b/i,
  /\bsubmit\s+payment\b/i,
  /\bdestroy\b/i,
  /\bdrop\b/i,
  /\bclear\b/i,
  /\bempty\b/i,
  /\brevoke\b/i,
  /\bdeactivate\b/i,
  /\bdisable\b/i,
  /\bterminate\b/i,
  /\bunsubscribe\b/i,
  /\bopt\s*out\b/i,
  /\bdecline\b/i,
  /\breject\b/i,
  /\bcancel\b/i, // dismiss, not an open action
  /\bsubmit\b/i, // form submission, not an open action
  /\bsave\b/i, // commits a change, not an open action
];

/**
 * Open / expand verbs — candidates for probing. Matches whole words.
 * Sourced from the milestone: Add, Create, New, Edit, Details, View, Expand,
 * Show More, Configure — plus clearly-related open-a-panel verbs.
 */
export const PROBE_PATTERNS: RegExp[] = [
  /\badd\b/i,
  /\bcreate\b/i,
  /\bnew\b/i,
  /\bedit\b/i,
  /\bmodify\b/i,
  /\bdetail/i, // detail | details
  /\bview\b/i,
  /\bshow\b/i,
  /\bexpand\b/i,
  /\bconfigure\b/i,
  /\bopen\b/i,
  /\bmanage\b/i,
  /\bmore\b/i,
  /\bsettings\b/i,
  /\bpreferences\b/i,
  /\bprofile\b/i,
  /\bregister\b/i,
  /\bsign\s*up\b/i,
  /\binspect\b/i,
];

/** Classify a button label under the safety policy. */
export function classifyAction(label: string): ActionClassification {
  const reason = (cls: SafetyClassification, verb: string) =>
    cls === 'destructive'
      ? `label matches destructive verb "${verb}" — never probed`
      : `label matches open/expand verb "${verb}"`;

  for (const re of DESTRUCTIVE_PATTERNS) {
    const m = label.match(re);
    if (m) return { classification: 'destructive', reason: reason('destructive', m[0]) };
  }
  for (const re of PROBE_PATTERNS) {
    const m = label.match(re);
    if (m) return { classification: 'probe', reason: reason('probe', m[0]) };
  }
  return {
    classification: 'unknown',
    reason: 'label is not a recognized open/expand action — skipped (conservative)',
  };
}

export interface InputClassification {
  safe: boolean;
  placeholder: string;
  reason: string;
}

/** Sensitive input keywords — NEVER probed. */
const SENSITIVE_INPUT_RE = /\b(password|secret|token|api\s?key|pin|cvv|card|credit|ssn|social\ssecurity)\b/i;

/**
 * Classify a text input by its label/placeholder and return a safe placeholder
 * value if the input is safe to probe (type + Enter). Sensitive inputs
 * (passwords, tokens, payment fields) are NEVER probed.
 */
export function classifyInput(label: string): InputClassification {
  const l = label.toLowerCase();

  if (SENSITIVE_INPUT_RE.test(l)) {
    return { safe: false, placeholder: '', reason: 'sensitive input — never probed' };
  }
  if (/\b(search|filter|find|query)\b/.test(l)) {
    return { safe: true, placeholder: 'test', reason: 'search/filter input — probing with "test"' };
  }
  if (/\b(add|new|create|todo|task|item|note|name|what|enter|type|your|message|comment|description|title)\b/.test(l)) {
    return { safe: true, placeholder: 'ReplayQA Probe Item', reason: 'create/add input — probing with disposable value' };
  }
  if (/\bemail|e-mail\b/.test(l)) {
    return { safe: true, placeholder: 'probe@test.example', reason: 'email input — probing with disposable address' };
  }
  // Default: non-sensitive text inputs are probed with a generic disposable value.
  // Worst case: no state change → recorded as no-effect.
  return { safe: true, placeholder: 'ReplayQA Probe', reason: 'non-sensitive text input — probing with disposable value' };
}
