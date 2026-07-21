import type { RawSnapshot } from './snapshot.js';
import type { StateMaterials } from '../browser/materials.js';

/**
 * Metadata for a captured State.
 */
export interface StateMetadata {
  /** Canonical relative URL (pathname + search + hash). */
  url: string;
  /** ISO-8601 capture timestamp. */
  capturedAt: string;
}

/**
 * A page captured at a point in time.
 *
 * `id` is the production state fingerprint — the accepted Strategy E from
 * docs/discovery/state-fingerprint-report.md (SHA-256 of URL + a11y role tree
 * + DOM tag tree + interactive surface + component flags + nav signature).
 * It is the dedup key used by the StateManager and the orchestrator.
 *
 * `materials` is what the id was computed from, carried on the State so the
 * persisted `states/<id>.json` file is self-explanatory and so the id can be
 * re-derived / audited without a second browser round-trip.
 */
export interface State {
  /** Strategy-E fingerprint — the dedup key. */
  id: string;
  /** Relative URL of the captured page. */
  url: string;
  metadata: StateMetadata;
  snapshot: RawSnapshot;
  /** Inputs that produced `id`. Persisted for auditability. */
  materials: StateMaterials;
}
