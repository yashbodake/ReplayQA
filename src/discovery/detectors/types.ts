import type { Finding } from '../models/finding.js';
import type { State } from '../models/state.js';

/**
 * A Detector — a pure observer that reads a State and emits Findings.
 *
 * Contract (docs/discovery/04-detectors.md §1):
 *   - Pure: a detector MUST NOT navigate, click, fill, or import Playwright.
 *     The BrowserController is the only module that touches the browser.
 *   - Idempotent: running twice on the same State yields the same findings.
 *   - Side-effect-free apart from returning findings: no persistence, no event
 *     emission (that is the DetectorManager's job).
 *
 * `detect` takes only the State (per the milestone spec). When future detectors
 * need tuning/config/logging, this becomes `detect(state, ctx: DetectorContext)`
 * — a backward-compatible widening.
 */
export interface Detector {
  /** Stable detector id; stamped onto every finding it produces. */
  readonly id: string;
  detect(state: State): Promise<Finding[]>;
}
