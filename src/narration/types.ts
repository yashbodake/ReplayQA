import type { Timeline } from './timeline/types.js';
import type { DiscoveryResult } from '../discovery/models/result.js';
import type { ReasoningResult } from '../discovery/reasoning-lab/types.js';
import type { TestPlan, TestScenario } from '../discovery/qa-planning-lab/types.js';
import type { FlowGraph, Journey } from '../discovery/flow/journey-builder.js';

/**
 * The slim outcome shape the orchestrator persists to
 * `artifacts/discovery/reliability-outcome.json`. (The full GenerationOutcome
 * lives in reliability/types.ts; the persisted summary is a subset.)
 */
export interface ReliabilityOutcomeSummary {
  passed: boolean;
  firstPassSuccess: boolean;
  attempts: number;
  repairsUsed: number;
  durationMs: number;
}

/**
 * NarrationContext — the SINGLE input to the Script Generator (Refinement #3).
 *
 * It aggregates every structured artifact ReplayQA produces. The script
 * generator receives nothing else: no file paths, no raw DOM, no video bytes.
 * This makes the "no invention" contract enforceable — everything the model
 * could possibly reference is right here, typed and bounded.
 *
 * Optional fields are `undefined` when the corresponding artifact is absent
 * (e.g. a run that stopped before planning). The loader never throws on a
 * missing optional artifact; the script generator simply omits it.
 */
export interface NarrationContext {
  targetUrl: string;
  timeline: Timeline;
  discovery?: DiscoveryResult;
  reasoning?: ReasoningResult;
  plan?: TestPlan;
  flowGraph?: FlowGraph;
  journeys?: Journey[];
  reliability?: ReliabilityOutcomeSummary;
  /** Highest-priority scenario resolved from the plan, if any. */
  topScenario?: TestScenario;
}

/**
 * Options shared by anything that calls an OpenAI-compatible LLM
 * (mirrors the reasoning/qa-planning LlmOptions so narration uses the same
 * provider configuration out of the box).
 */
export interface NarrationLlmOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
