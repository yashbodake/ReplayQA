/**
 * ReplayQA Narration Engine (v0.8).
 *
 * Transforms ReplayQA's structured execution artifacts into a narrated
 * summary video (browser execution + AI script + TTS voice-over, muxed with
 * ffmpeg). Narration is derived ENTIRELY from ReplayQA's own knowledge — no
 * video analysis, computer vision, or OCR.
 *
 * Module layout (one responsibility each):
 *   timeline/  real runtime events → timeline.json   (Refinement #1)
 *   planner/   chapters only, NO natural language     (Refinement #2)
 *   script/    the ONLY natural-language generation    (Refinement #2)
 *   tts/       provider-agnostic; Edge-TTS first       (Refinement #4)
 *   render/    pluggable render policies                (Refinement #5)
 *
 * The sole input to the Script Generator is `NarrationContext` (Refinement #3).
 */
export type { NarrationContext, NarrationLlmOptions, ReliabilityOutcomeSummary } from './types.js';
export { loadNarrationContext } from './context.js';

export * from './timeline/index.js';
export * from './planner/index.js';
export * from './script/index.js';
export * from './tts/index.js';
export * from './render/index.js';

export { narrate } from './narrate.js';
export type { NarrateOptions, NarrateResult } from './narrate.js';
