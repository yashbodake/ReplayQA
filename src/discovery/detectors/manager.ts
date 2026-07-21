import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Detector } from './types.js';
import type { Finding } from '../models/finding.js';
import type { State } from '../models/state.js';
import type { Logger } from '../core/logger.js';

export interface DetectorManagerOptions {
  /** Directory where per-state findings aggregates are persisted. */
  findingsDir: string;
  logger?: Logger;
}

/**
 * Runs registered detectors against a State and aggregates their findings.
 *
 * Responsibilities (docs/discovery/03-modules.md §3.5):
 *   - Hold the registry of detectors.
 *   - Run each detector against a State, in registration order.
 *   - Isolate failures: a throwing detector is logged and skipped; it does
 *     NOT abort the run or the other detectors.
 *   - Persist the aggregated findings for the state (one file per state).
 *
 * Deliberately NOT implemented here (future milestones):
 *   - Parallel scheduling / `runCost` hints.
 *   - Correlation of overlapping findings (a Form inside a Modal, a Login
 *     Form vs a generic Form). That is the RAM Builder's job.
 *   - Confidence thresholding / promotion policy. Also the RAM Builder.
 */
export class DetectorManager {
  private readonly detectors: Detector[] = [];

  constructor(private readonly options: DetectorManagerOptions) {}

  register(detector: Detector): void {
    this.detectors.push(detector);
  }

  /** Number of registered detectors. */
  get count(): number {
    return this.detectors.length;
  }

  /**
   * Run every registered detector against `state`, aggregate the findings,
   * persist them to `findings/<stateId>.json`, and return them. Detector
   * errors are isolated.
   */
  async runAll(state: State): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const detector of this.detectors) {
      try {
        const found = await detector.detect(state);
        findings.push(...found);
      } catch (error) {
        this.options.logger?.warn(
          `Detector "${detector.id}" threw on state ${state.id} — ${errorMessage(error)}`
        );
      }
    }
    await this.persist(state.id, findings);
    return findings;
  }

  private async persist(stateId: string, findings: Finding[]): Promise<void> {
    try {
      mkdirSync(this.options.findingsDir, { recursive: true });
      const file = resolve(this.options.findingsDir, `${stateId}.json`);
      const document = {
        stateId,
        count: findings.length,
        findings,
      };
      writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    } catch (error) {
      // Persistence is best-effort, mirroring the StateManager: a write failure
      // must not abort discovery.
      this.options.logger?.warn(
        `Failed to persist findings for state ${stateId} — ${errorMessage(error)}`
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
