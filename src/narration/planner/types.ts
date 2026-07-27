import type { EventType } from '../timeline/types.js';

/**
 * Verified, machine-derived facts attached to a chapter. The planner fills
 * these from `NarrationContext` (counts, titles, outcomes) — never prose.
 */
export interface ChapterEvidence {
  /** Which timeline event type(s) fed this chapter. */
  eventType: EventType | EventType[];
  /** Verified facts only (numbers, titles, booleans). No natural language. */
  facts: Readonly<Record<string, unknown>>;
  /**
   * Terse factual note for the script generator, e.g. "4 states, 3 flows".
   * This is NOT narration text — it is a compact fact string the NLG step
   * may rephrase. (Refinement #2: the planner does not generate narration.)
   */
  summary: string;
}

/**
 * A narration chapter.
 *
 * The planner decides WHAT to narrate and WHEN (ordering + offsets). It does
 * NOT decide the words — there is deliberately no `text` field. Natural
 * language generation is the exclusive responsibility of `script/`.
 * (Refinement #2.)
 */
export interface NarrationChapter {
  index: number;
  /** Human chapter title, e.g. "Discovery", "Authentication". */
  title: string;
  /** Offset (seconds) within the target 60–90s summary where this chapter begins. */
  start: number;
  /** Estimated spoken duration (seconds) for this chapter. */
  duration: number;
  evidence: ChapterEvidence;
}
