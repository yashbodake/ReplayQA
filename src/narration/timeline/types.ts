/**
 * Execution timeline — the first-class runtime artifact that drives narration.
 *
 * Every important ReplayQA stage transition is recorded as a `TimelineEvent`
 * with a REAL wall-clock timestamp (ms since the recorder's epoch), captured at
 * the call site — never reconstructed after the fact. The persisted
 * `artifacts/narration/timeline.json` is therefore an honest record of what
 * ReplayQA actually did and when, and it is the single source of truth the
 * narration planner/script draw on for ordering and rough duration.
 *
 * (Refinement #1: the timeline is a real runtime artifact, not synthesized.)
 */

/**
 * The catalogue of events ReplayQA can emit. Adding a new event type only
 * requires extending this union and emitting it at the relevant boundary —
 * consumers (planner, script) key off `type` and ignore unknowns gracefully.
 */
export type EventType =
  | 'run-started'
  | 'discovery-started'
  | 'landing-captured'
  | 'authenticated'
  | 'login-failed'
  | 'state-discovered'
  | 'flow-discovered'
  | 'reasoning-completed'
  | 'qa-plan-generated'
  | 'generation-started'
  | 'walkthrough-started'
  | 'walkthrough-finished'
  | 'repair-attempt'
  | 'execution-passed'
  | 'execution-failed'
  | 'report-generated'
  | 'run-finished';

export type EventImportance = 'high' | 'medium' | 'low';

/**
 * A single recorded event.
 *
 * `metadata` MUST contain only verified facts (counts, titles, URLs, outcomes)
 * pulled from ReplayQA's own artifacts — never inferred or invented values.
 * The narration script generator is bound to the same constraint.
 */
export interface TimelineEvent {
  /** Stable, monotonic id: `${sequence}-${type}` (e.g. `003-state-discovered`). */
  id: string;
  /** Milliseconds since the recorder's epoch (real wall-clock delta). */
  timestamp: number;
  type: EventType;
  importance: EventImportance;
  /** Verified facts accompanying the event. Shape is event-type dependent. */
  metadata: Readonly<Record<string, unknown>>;
}

/**
 * The full timeline persisted to `artifacts/narration/timeline.json`.
 */
export interface Timeline {
  /** Per-run id (matches the DiscoveryContext runId when emitted from a run). */
  runId: string;
  /** ISO timestamp of the recorder's epoch (when timing began). */
  epoch: string;
  events: TimelineEvent[];
}
