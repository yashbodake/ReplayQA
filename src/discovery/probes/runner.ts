import type { BrowserController } from '../browser/controller.js';
import type { StateManager } from '../state/manager.js';
import type { Logger } from '../core/logger.js';
import type { State } from '../models/state.js';
import type { ProbeCandidate, ProbeHooks, RunProbesOptions } from './types.js';
import { classifyAction } from './vocabulary.js';
import type { TransitionGraphBuilder } from './graph.js';

export interface RunProbesArgs {
  controller: BrowserController;
  stateManager: StateManager;
  /** State we are probing from (the "base"). */
  baseState: State;
  /** Absolute URL of the base — used to reset between probes. */
  baseUrl: string;
  graph: TransitionGraphBuilder;
  hooks: ProbeHooks;
  logger?: Logger;
  options?: RunProbesOptions;
}

/**
 * Run action probes from a base state.
 *
 * For each visible action button:
 *   1. Classify it under the safety policy.
 *   2. If destructive or unknown → record the skip (with reason) and continue.
 *   3. If safe (open/expand) → click, wait for the UI to stabilize, capture the
 *      new state, record the transition edge, register the state if new, then
 *      RETURN TO BASE so the next probe starts from a clean slate.
 *
 * Probes are ONE level deep: a state reached by a probe is observed and
 * recorded, but not itself probed (matches "open form → observe → close").
 *
 * Returns the count of probes executed and states newly registered.
 */
export async function runProbes(args: RunProbesArgs): Promise<{
  probed: number;
  newlyRegistered: number;
}> {
  const max = args.options?.maxProbesPerState ?? 5;
  let probed = 0;
  let newlyRegistered = 0;

  let candidates: ProbeCandidate[] = [];
  try {
    candidates = await args.controller.currentActions();
  } catch (error) {
    args.logger?.warn(`probe: could not enumerate actions — ${errMsg(error)}`);
    return { probed, newlyRegistered };
  }

  for (const candidate of candidates) {
    if (probed >= max) break;

    const verdict = classifyAction(candidate.label);
    if (verdict.classification !== 'probe') {
      args.graph.addSkipped(
        args.baseState.id,
        candidate.label,
        verdict.classification,
        verdict.reason
      );
      args.logger?.info(
        `probe: skip "${candidate.label}" (${verdict.classification}) — ${verdict.reason}`
      );
      continue;
    }

    try {
      const clicked = await args.controller.click(candidate.selector);
      if (!clicked) {
        args.logger?.info(`probe: "${candidate.label}" not found at base — skipping`);
        continue;
      }
      await args.controller.waitForStable();
    } catch (error) {
      args.logger?.warn(`probe: click "${candidate.label}" threw — ${errMsg(error)}`);
      continue;
    }

    // Capture the probed state. (StateManager persists it if new; hooks register it in pages.)
    const { state: probedState, isNew } = await args.hooks.captureAndAdd();

    if (probedState.id !== args.baseState.id) {
      args.graph.addEdge(args.baseState.id, candidate.label, probedState.id);
      args.logger?.info(
        `probe: "${candidate.label}" → new state ${probedState.id}${isNew ? ' (registered)' : ''}`
      );
      if (isNew) newlyRegistered++;
    } else {
      args.graph.addSkipped(args.baseState.id, candidate.label, 'unknown', 'no state change after click');
    }
    probed++;

    // Soft-dismiss whatever the probe opened (modal/drawer) so the next probe
    // starts from base. Try Escape, then a Close/Cancel/× button. NEVER reload
    // — a reload would reset in-memory SPA auth and log the session out.
    await dismissOverlay(args.controller);
  }

  return { probed, newlyRegistered };
}

/** Close an opened overlay (modal/drawer/dialog) without resetting the page. */
async function dismissOverlay(controller: BrowserController): Promise<void> {
  await controller.pressEscape().catch(() => undefined);
  for (const sel of [
    { role: 'button', name: /^close$/i },
    { role: 'button', name: /^cancel$/i },
    { role: 'button', name: /^(✕|×|x)$/ },
    { role: 'button', name: /^done$/i },
    { role: 'button', name: /^back$/i },
  ]) {
    const clicked = await controller.click(sel).catch(() => false);
    if (clicked) break;
  }
  await controller.waitForStable();
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
