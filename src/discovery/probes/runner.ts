import type { BrowserController } from '../browser/controller.js';
import type { StateManager } from '../state/manager.js';
import type { Logger } from '../core/logger.js';
import type { State } from '../models/state.js';
import type { ProbeCandidate, ProbeHooks, RunProbesOptions } from './types.js';
import { classifyAction, classifyInput } from './vocabulary.js';
import type { TransitionGraphBuilder } from './graph.js';
import { computeChanges } from '../flow/snapshot-diff.js';

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

    // --- Classify + interact by candidate type ---
    let probedOK = false;

    if (candidate.type === 'input') {
      // Text input: classify by purpose; if safe, type a placeholder + Enter.
      const input = classifyInput(candidate.label);
      if (!input.safe) {
        args.graph.addSkipped(args.baseState.id, candidate.label, 'unknown', input.reason);
        args.logger?.info(`probe: skip input "${candidate.label}" — ${input.reason}`);
        continue;
      }
      try {
        await args.controller.fill(candidate.selector, input.placeholder).catch(() => undefined);
        await args.controller.pressEnter(candidate.selector);
        await args.controller.waitForStable();
        probedOK = true;
      } catch (error) {
        args.logger?.warn(`probe: type+Enter "${candidate.label}" threw — ${errMsg(error)}`);
        continue;
      }
    } else if (candidate.type === 'tab' || candidate.type === 'expander') {
      // Tabs and expanders are always safe to toggle.
      try {
        const clicked = await args.controller.click(candidate.selector);
        if (!clicked) {
          args.logger?.info(`probe: "${candidate.label}" (${candidate.type}) not found — skipping`);
          continue;
        }
        await args.controller.waitForStable();
        probedOK = true;
      } catch (error) {
        args.logger?.warn(`probe: click "${candidate.label}" (${candidate.type}) threw — ${errMsg(error)}`);
        continue;
      }
    } else {
      // Buttons, links, and cards: classify under the vocabulary safety policy.
      const verdict = classifyAction(candidate.label);
      // For LINKS and CARDS: skip only if destructive. Non-destructive items
      // (product details, contact cards, content links) are safe to probe even
      // without an action verb. For BUTTONS: require matching a PROBE_PATTERN.
      const shouldProbe = candidate.type === 'link' || candidate.type === 'card'
        ? verdict.classification !== 'destructive'
        : verdict.classification === 'probe';
      if (!shouldProbe) {
        args.graph.addSkipped(args.baseState.id, candidate.label, verdict.classification as 'destructive' | 'unknown', verdict.reason);
        args.logger?.info(`probe: skip "${candidate.label}" (${candidate.type}/${verdict.classification}) — ${verdict.reason}`);
        continue;
      }
      try {
        const clicked = await args.controller.click(candidate.selector);
        if (!clicked) {
          args.logger?.info(`probe: "${candidate.label}" not found at base — skipping`);
          continue;
        }
        await args.controller.waitForStable();
        probedOK = true;
      } catch (error) {
        args.logger?.warn(`probe: click "${candidate.label}" threw — ${errMsg(error)}`);
        continue;
      }
    }

    if (!probedOK) continue;

    // Capture the probed state. (StateManager persists it if new; hooks register it in pages.)
    const { state: probedState, isNew } = await args.hooks.captureAndAdd();

    if (probedState.id !== args.baseState.id) {
      const changes = computeChanges(args.baseState.snapshot, probedState.snapshot);
      args.graph.addEdge(args.baseState.id, candidate.label, probedState.id, changes);
      args.logger?.info(
        `probe: "${candidate.label}" → new state ${probedState.id}${isNew ? ' (registered)' : ''}${changes.length ? ` [${changes.length} changes]` : ''}`
      );
      if (isNew) newlyRegistered++;
    } else {
      args.graph.addSkipped(args.baseState.id, candidate.label, 'unknown', `no state change after ${candidate.type} interaction`);
    }
    probed++;

    // Soft-dismiss whatever the probe opened (modal/drawer) so the next probe
    // starts from base. Try Escape, then a Close/Cancel/× button. NEVER reload
    // — a reload would reset in-memory SPA auth and log the session out.
    await dismissOverlay(args.controller);

    // If the probe caused a NAVIGATION (URL drifted, e.g. to a product detail
    // page), navigate back to the base URL so subsequent probes start clean.
    if (!sameUrl(args.controller.currentUrl(), args.baseUrl)) {
      try {
        await args.controller.goto(args.baseUrl, { timeout: 20000 });
        await args.controller.waitForStable();
      } catch {
        /* best-effort */
      }
    }
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

function sameUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin + ua.pathname + ua.search === ub.origin + ub.pathname + ub.search;
  } catch {
    return a === b;
  }
}
