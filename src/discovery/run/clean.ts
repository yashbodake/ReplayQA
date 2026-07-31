import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Paths inside a discovery artifact directory that are produced by a single run
 * and must not leak into the next run.
 *
 * `narration/` is intentionally excluded: the timeline recorder may already have
 * written run-started events before discovery begins.
 */
const STALE_PATHS = [
  'states',
  'findings',
  'discovery.json',
  'graph.json',
  'flow-graph.json',
  'journeys.json',
  'flow-report.html',
  'reasoning.json',
  'reasoning.raw.txt',
  'test-plan.json',
  'test-plan.md',
  'test-plan.raw.txt',
  'generated-test.raw.txt',
  'reliability-outcome.json',
  'reliability-report.html',
];

/**
 * Remove every artifact produced by a previous discovery/reasoning/plan/execute
 * run so stale observations cannot be loaded by `loadObservations()`.
 */
export function cleanDiscoveryArtifacts(artifactsDir: string): void {
  for (const relative of STALE_PATHS) {
    const full = resolve(artifactsDir, relative);
    if (!existsSync(full)) continue;
    rmSync(full, { recursive: true, force: true });
  }
}
