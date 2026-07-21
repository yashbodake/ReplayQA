import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserController } from '../browser/controller.js';
import type { StateMaterials } from '../browser/materials.js';
import { computeStateId } from './fingerprint.js';
import type { State } from '../models/state.js';
import type { RawSnapshot } from '../models/snapshot.js';
import type { Logger } from '../core/logger.js';

export interface StateManagerOptions {
  /** Directory where one JSON file per unique state is persisted. */
  statesDir: string;
  logger?: Logger;
}

/**
 * The production State Manager (docs/discovery/03-modules.md §3.3).
 *
 * Responsibilities (Milestone scope):
 *   - Convert the current page into a {@link State} via the BrowserController.
 *   - Stamp each State with its `stateId` — the accepted Strategy E fingerprint
 *     (docs/discovery/state-fingerprint-report.md), replacing the old URL
 *     placeholder id.
 *   - Persist each NEW state to `states/<stateId>.json` (one file per unique
 *     state; duplicates are detected and skipped).
 *
 * Deliberately NOT implemented here (later milestones): state-graph edges,
 * a11y fingerprints beyond what Strategy E needs, re-capture scheduling.
 */
export class StateManager {
  private readonly seen = new Set<string>();

  constructor(
    private readonly controller: BrowserController,
    private readonly options: StateManagerOptions
  ) {}

  /**
   * Capture the current page as a State: gather fingerprint materials + the
   * raw snapshot, compute the stateId, and persist the state if it has not
   * been captured before in this run. Returns the State regardless.
   *
   * This is the spec'd surface: `capture(): Promise<State>`. Whether a capture
   * was novel is answerable via {@link has} using `state.id`.
   */
  async capture(): Promise<State> {
    const materials = await this.controller.currentMaterials();
    const snapshot = await this.controller.currentSnapshot();
    return this.record(materials, snapshot);
  }

  /**
   * Compute the stateId for a set of materials without capturing. Pure &
   * side-effect-free — the spec'd `computeStateId(materials): string`.
   */
  computeStateId(materials: StateMaterials): string {
    return computeStateId(materials);
  }

  /** Has a state with this id already been recorded in this run? */
  has(stateId: string): boolean {
    return this.seen.has(stateId);
  }

  /** Number of unique states recorded so far in this run. */
  get uniqueCount(): number {
    return this.seen.size;
  }

  /**
   * Build a State from already-gathered materials + snapshot, compute its id,
   * and persist it if new. Exposed so callers that already hold materials
   * (e.g. the lab, or a future re-capture path) can record without a second
   * page round-trip.
   */
  async record(materials: StateMaterials, snapshot: RawSnapshot): Promise<State> {
    const id = this.computeStateId(materials);
    const url = relativePath(materials.url);
    const state: State = {
      id,
      url,
      metadata: {
        url,
        capturedAt: new Date().toISOString(),
      },
      snapshot,
      materials,
    };

    if (!this.seen.has(id)) {
      this.seen.add(id);
      await this.persist(state);
    }
    return state;
  }

  private async persist(state: State): Promise<void> {
    try {
      mkdirSync(this.options.statesDir, { recursive: true });
      const file = resolve(this.options.statesDir, `${state.id}.json`);
      if (existsSync(file)) {
        // Defensive: another run wrote a file with the same id (extremely
        // unlikely given 32-bit hash + per-run dir). Don't overwrite — the
        // in-memory `seen` set is the authoritative dedup for this run.
        return;
      }
      writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    } catch (error) {
      // Persistence is best-effort: a write failure must not abort discovery.
      const logger = this.options.logger;
      logger?.warn(
        `StateManager: failed to persist state ${state.id} — ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

/** Absolute → relative path for the State.url field (pathname + search + hash). */
function relativePath(absoluteOrRelative: string): string {
  try {
    const u = new URL(absoluteOrRelative);
    return u.pathname + u.search + u.hash;
  } catch {
    return absoluteOrRelative;
  }
}
