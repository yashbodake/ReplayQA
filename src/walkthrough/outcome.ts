import type { BrowserController } from '../discovery/browser/controller.js';
import type { RawSnapshot } from '../discovery/models/snapshot.js';

/**
 * Verified per-step outcome detection (v0.9.2).
 *
 * Previously the recorder marked a step `performed` as soon as Playwright's
 * click resolved — it never checked whether anything actually happened. That
 * let the narrator claim "the contact was saved" / "the list filters in real
 * time" even when the form rejected the fill or submission silently failed.
 *
 * This module captures a BEFORE snapshot, the action runs, then an AFTER
 * snapshot, and reports the VERIFIED outcome in plain facts the narrator is
 * allowed to speak. The narrator is fed only these facts — so it can no longer
 * invent results.
 */
export interface StepOutcome {
  /** True if anything visibly changed after the action. */
  changed: boolean;
  /** Human-readable, fact-only observations (e.g. 'form opened', 'list grew by 1'). */
  observations: string[];
  /** Structured signals for the narrator. */
  signals: {
    urlChanged: boolean;
    formOpened: boolean;
    formClosed: boolean;
    /** Net change in the dominant list/table row count (positive = items added). */
    listDelta: number;
    /** A success-ish toast/notice appeared (heuristic). */
    noticeAppeared: boolean;
  };
}

/** Capture the current page state as a comparable snapshot. */
export async function snapshot(controller: BrowserController): Promise<RawSnapshot> {
  return controller.currentSnapshot();
}

/**
 * Compute the verified outcome between two snapshots captured around an action.
 * Pure function — easy to unit-test.
 *
 * `listSizeBefore/After` is an optional proxy for list length (e.g. the count of
 * card/link action candidates), since many apps render lists as `<ul>`/cards
 * rather than `<table>` (which the snapshot only captures directly).
 */
export function diffOutcome(
  before: RawSnapshot,
  after: RawSnapshot,
  listSizeBefore?: number,
  listSizeAfter?: number
): StepOutcome {
  const observations: string[] = [];
  const signals: StepOutcome['signals'] = {
    urlChanged: false,
    formOpened: false,
    formClosed: false,
    listDelta: 0,
    noticeAppeared: false,
  };

  // Forms open/close (modals, drawers).
  if (after.forms.length > before.forms.length) {
    signals.formOpened = true;
    observations.push('a form opened');
  } else if (after.forms.length < before.forms.length) {
    signals.formClosed = true;
    observations.push('the form closed');
  }

  // Buttons that appeared/disappeared (e.g. a "Save" button appearing = form open).
  const beforeButtons = new Set(before.buttons);
  const afterButtons = new Set(after.buttons);
  const newButtons = [...afterButtons].filter((b) => !beforeButtons.has(b));
  const goneButtons = [...beforeButtons].filter((b) => !afterButtons.has(b));
  for (const b of newButtons.slice(0, 4)) observations.push(`"${b}" button appeared`);
  for (const b of goneButtons.slice(0, 4)) observations.push(`"${b}" button disappeared`);

  // Heading change (page navigation).
  if (after.heading && after.heading !== before.heading) {
    observations.push(`heading changed to "${after.heading}"`);
  }

  // List size delta — prefer the explicit proxy (card/link count) when given,
  // fall back to table row counts.
  const beforeRows = listSizeBefore ?? totalTableRows(before);
  const afterRows = listSizeAfter ?? totalTableRows(after);
  if (afterRows !== beforeRows) {
    signals.listDelta = afterRows - beforeRows;
    if (signals.listDelta > 0) observations.push(`the list grew by ${signals.listDelta} item${signals.listDelta === 1 ? '' : 's'}`);
    else observations.push(`the list shrank by ${Math.abs(signals.listDelta)} item${signals.listDelta === -1 ? '' : 's'}`);
  }

  // Success-ish notice heuristic: a short text element appeared containing
  // success/added/created/saved. (Detected via buttons/links/heading words
  // since the snapshot doesn't capture arbitrary text — conservative.)
  const noticeRe = /\b(success|added|created|saved|done|complete|thank)/i;
  const newLabels = [...newButtons, ...[...afterButtons].filter((b) => !beforeButtons.has(b))];
  if (newLabels.some((l) => noticeRe.test(l))) {
    signals.noticeAppeared = true;
    observations.push('a success notice appeared');
  }

  const changed = observations.length > 0;
  return { changed, observations, signals };
}

/** Sum of row counts across all tables (the closest snapshot-native proxy). */
function totalTableRows(snap: RawSnapshot): number {
  return snap.tables.reduce((sum, t) => sum + (t.rowCount || 0), 0);
}
