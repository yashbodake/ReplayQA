import type { Selector } from '../browser/selector.js';
import type { State } from '../models/state.js';

/**
 * Action Probe system — types.
 *
 * A "probe" is a safe, temporary interaction (clicking an action button) that
 * changes UI state purely so ReplayQA can OBSERVE it (open a modal/form/drawer/
 * tab), then return to the previous state. Probes never perform destructive
 * actions (see vocabulary.ts).
 */

export interface ProbeCandidate {
  label: string;
  selector: Selector;
}

export type SafetyClassification = 'probe' | 'destructive' | 'unknown';

export interface ActionClassification {
  classification: SafetyClassification;
  /** Why this classification — surfaced in the persisted graph + logs. */
  reason: string;
}

export interface TransitionEdge {
  from: string;
  to: string;
  action: string;
  via: 'probe';
  /** Human-readable descriptions of what changed (buttons appeared, form opened, etc.). */
  changes: string[];
}

export interface SkippedAction {
  from: string; // stateId
  action: string;
  classification: Exclude<SafetyClassification, 'probe'>;
  reason: string;
}

export interface GraphNode {
  stateId: string;
  url: string;
  label: string;
}

export interface TransitionGraph {
  nodes: GraphNode[];
  edges: TransitionEdge[];
  skipped: SkippedAction[];
}

/** What the runner needs to capture + register a probed state. */
export interface ProbeHooks {
  /**
   * Capture the current page as a State and, if it is new, register it in the
   * output pages + run detectors. Returns the captured state + whether it was
   * newly registered. (Same flow the orchestrator uses for nav-reached pages.)
   */
  captureAndAdd: () => Promise<{ state: State; isNew: boolean }>;
}

export interface RunProbesOptions {
  /** Maximum probes executed per base state. */
  maxProbesPerState?: number;
}
