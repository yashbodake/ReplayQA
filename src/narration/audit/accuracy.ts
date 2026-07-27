import type { NarrationContext } from '../types.js';
import type { NarrationChapter } from '../planner/types.js';
import { toSpeakableText } from '../script/plain-text.js';

/**
 * Accuracy check — text-vs-artifacts (no video, no CV/OCR).
 *
 * This is the milestone-compliant definition of "narration accuracy": every
 * quantitative or factual claim in the spoken script must be reconcilable with
 * a value in ReplayQA's structured artifacts. It does NOT analyze pixels.
 *
 * The checker pulls verified facts from the context and scans the script for
 * any number/word it asserts, flagging claims that cannot be grounded.
 */

export interface AccuracyCheck {
  totalClaims: number;
  verified: AccuracyClaim[];
  ungrounded: AccuracyClaim[];
  /** True when there are no ungrounded claims (i.e. no hallucinations detected). */
  ok: boolean;
}

export interface AccuracyClaim {
  /** The numeric or string value asserted by the script. */
  value: string | number;
  /** What the value refers to. */
  kind: 'state-count' | 'flow-count' | 'scenario-count' | 'confidence' | 'outcome' | 'app-type' | 'other';
  /** The source fact that grounds (or fails to ground) the claim. */
  source?: string;
  /** The sentence in the script where the claim appeared. */
  excerpt?: string;
}

/**
 * Check that every numeric/factual claim in the script is grounded in the
 * context's artifacts. `markdown` is the persisted script; chapters provide the
 * planner's verified facts to check against.
 */
export function checkAccuracy(
  markdown: string,
  ctx: NarrationContext,
  chapters: readonly NarrationChapter[]
): AccuracyCheck {
  const text = toSpeakableText(markdown);
  const sentences = splitSentences(text);

  const verified: AccuracyClaim[] = [];
  const ungrounded: AccuracyClaim[] = [];

  const facts = collectFacts(ctx, chapters);

  for (const sentence of sentences) {
    for (const claim of extractNumericClaims(sentence)) {
      const match = facts.find((f) => f.value === claim.value && f.kind === claim.kind);
      if (match) {
        verified.push({ ...claim, source: match.source, excerpt: sentence });
      } else {
        // A number that doesn't match any known fact — potential hallucination.
        ungrounded.push({ ...claim, excerpt: sentence });
      }
    }
  }

  // Outcome + app-type are checked as keyword presence, not numbers.
  const outcomeOk = checkOutcomeClaim(text, ctx);
  if (outcomeOk.claim) {
    if (outcomeOk.grounded) verified.push(outcomeOk.claim!);
    else ungrounded.push(outcomeOk.claim!);
  }

  return {
    totalClaims: verified.length + ungrounded.length,
    verified,
    ungrounded,
    ok: ungrounded.length === 0,
  };
}

interface Fact {
  value: number | string;
  kind: AccuracyClaim['kind'];
  source: string;
}

function collectFacts(ctx: NarrationContext, chapters: readonly NarrationChapter[]): Fact[] {
  const facts: Fact[] = [];
  for (const ch of chapters) {
    const f = ch.evidence.facts as Record<string, unknown>;
    if (typeof f.stateCount === 'number') facts.push({ value: f.stateCount, kind: 'state-count', source: `${ch.title}.facts.stateCount` });
    if (typeof f.flowCount === 'number') facts.push({ value: f.flowCount, kind: 'flow-count', source: `${ch.title}.facts.flowCount` });
    if (typeof f.scenarioCount === 'number') facts.push({ value: f.scenarioCount, kind: 'scenario-count', source: `${ch.title}.facts.scenarioCount` });
    if (typeof f.confidence === 'number') facts.push({ value: f.confidence, kind: 'confidence', source: `${ch.title}.facts.confidence` });
  }
  if (ctx.reasoning?.applicationType) {
    facts.push({ value: ctx.reasoning.applicationType.toLowerCase(), kind: 'app-type', source: 'reasoning.applicationType' });
  }
  return facts;
}

/** Extract numeric claims (counts, confidence) from a sentence. */
function extractNumericClaims(sentence: string): AccuracyClaim[] {
  const claims: AccuracyClaim[] = [];
  const lower = sentence.toLowerCase();

  // Confidence values like "0.85" or "0.78". Consume these FIRST and mask them
  // out so the bare-integer pass below doesn't also grab "0" and "85".
  const masked = lower.replace(/\b0\.\d{1,2}\b/g, (m) => {
    claims.push({ value: parseFloat(m), kind: 'confidence' });
    return ' ';
  });

  // Word numbers ("four", "twelve"). Match against the masked text so a
  // confidence value isn't double-counted.
  const wordNums: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  for (const [word, n] of Object.entries(wordNums)) {
    if (new RegExp(`\\b${word}\\b`).test(masked)) {
      claims.push({ value: n, kind: inferCountKind(sentence, word) });
    }
  }

  // Bare integers, but NOT those inside identifiers like "TC-001" or "v2".
  for (const m of masked.matchAll(/(?<![-\w])(\d{1,3})(?![-\w])/g)) {
    claims.push({ value: parseInt(m[1], 10), kind: inferCountKind(sentence, m[1]) });
  }
  return claims;
}

/** Infer the count kind from the words NEAR the matched token, not the whole sentence. */
function inferCountKind(sentence: string, token: string): AccuracyClaim['kind'] {
  // Look at the few words following the token — that's where the noun lives
  // in natural narration ("five states", "nine flows", "twelve scenarios").
  const idx = sentence.toLowerCase().indexOf(String(token).toLowerCase());
  const tail = idx >= 0 ? sentence.slice(idx, idx + 40).toLowerCase() : sentence.toLowerCase();
  if (/(flow|transition|edge|path|journey)/.test(tail)) return 'flow-count';
  if (/(scenario|test|case)/.test(tail)) return 'scenario-count';
  if (/(state|page|screen|view)/.test(tail)) return 'state-count';
  return 'other';
}

function checkOutcomeClaim(text: string, ctx: NarrationContext): { claim?: AccuracyClaim; grounded: boolean } {
  const lower = text.toLowerCase();
  const passed = /\b(passed|passes|succeeded|passing)\b/.test(lower);
  const failed = /\b(failed|fails|failing)\b/.test(lower);
  if (!passed && !failed) return { grounded: true };
  const actualPassed = ctx.reliability?.passed ?? false;
  const claim: AccuracyClaim = {
    value: passed ? 'passed' : 'failed',
    kind: 'outcome',
    source: 'reliability.passed',
    excerpt: lower.slice(0, 120),
  };
  return { claim, grounded: passed === actualPassed };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// P3: Observation-grounding check (demo mode).
//
// The numeric check above is blind to the app-narrator's qualitative prose
// ("a Remove button appears"). For demo-mode scripts (narrated over a
// walkthrough), this check verifies that every EFFECT the script describes is
// supported by a verified walkthrough observation — catching the
// "says it's in the cart but observations only say a button appeared" case.
// ─────────────────────────────────────────────────────────────────────────────

export interface GroundingCheck {
  totalEffectClaims: number;
  grounded: EffectClaim[];
  ungrounded: EffectClaim[];
  ok: boolean;
}

export interface EffectClaim {
  /** The effect phrase the script asserted, e.g. "in the cart", "was saved". */
  effect: string;
  /** The sentence where it appeared. */
  excerpt: string;
  /** Why it grounded (or didn't). */
  note: string;
}

/** A walkthrough chapter's verified per-action observations (subset of the type). */
interface VerifiedChapter {
  title: string;
  actions: string[];
  verified?: { action: string; observations: string[]; fillSucceeded: boolean }[];
}

/**
 * Effects the narrator is FORBIDDEN from asserting unless an observation
 * literally supports them. Each entry is a regex matched against the script;
 * if it matches, we require a matching observation token or the claim is
 * flagged as ungrounded (an inferred bridge).
 */
const FORBIDDEN_BRIDGES: { pattern: RegExp; needsObservation: RegExp; label: string }[] = [
  { pattern: /\b(in the cart|added to (?:the )?cart|item is now|added to your cart)\b/i, needsObservation: /cart|list grew|badge|count/i, label: 'cart-addition' },
  { pattern: /\b(was saved|has been saved|saved successfully|contact was (?:added|created|saved))\b/i, needsObservation: /saved|list grew|created|success/i, label: 'save-success' },
  { pattern: /\b(was created|creation succeed|created successfully|account was created)\b/i, needsObservation: /created|list grew|success/i, label: 'create-success' },
  { pattern: /\b(submitted successfully|submission succeed|form was submitted)\b/i, needsObservation: /submit|list grew|success|closed/i, label: 'submit-success' },
  { pattern: /\b(filtered (?:the |the )?list|search returned|results (?:are )?shown|list filters)\b/i, needsObservation: /list (?:shrank|grew|changed)|filter/i, label: 'filter-result' },
  { pattern: /\b(logged in|authenticated|sign.?in succeed)\b/i, needsObservation: /never/i, label: 'login-claim' },
];

/**
 * Check that the demo-mode script does not assert forbidden bridged effects
 * (e.g. "the item is in the cart") unless a verified observation supports them.
 */
export function checkObservationGrounding(
  markdown: string,
  chapters: readonly VerifiedChapter[]
): GroundingCheck {
  const text = toSpeakableText(markdown);
  const allObservations = chapters.flatMap((c) => c.verified ?? []).flatMap((v) => v.observations);
  const observationsBlob = allObservations.join(' ').toLowerCase();

  const grounded: EffectClaim[] = [];
  const ungrounded: EffectClaim[] = [];

  for (const sentence of splitSentences(text)) {
    for (const bridge of FORBIDDEN_BRIDGES) {
      const match = sentence.match(bridge.pattern);
      if (!match) continue;
      const effect = match[0];
      // "login-claim" is always forbidden in demo mode (login is pre-demo).
      const supported = bridge.label === 'login-claim' ? false : bridge.needsObservation.test(observationsBlob);
      const claim: EffectClaim = {
        effect,
        excerpt: sentence.slice(0, 140),
        note: supported
          ? `supported by a verified observation`
          : `inferred bridge "${bridge.label}" with no supporting observation`,
      };
      if (supported) grounded.push(claim);
      else ungrounded.push(claim);
    }
  }

  return {
    totalEffectClaims: grounded.length + ungrounded.length,
    grounded,
    ungrounded,
    ok: ungrounded.length === 0,
  };
}

