import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadObservations, type Observations } from '../reasoning-lab/index.js';

/**
 * The QA planner consumes TWO ReplayQA artifacts:
 *   - the raw structured observations (pages / states / findings), and
 *   - `reasoning.json` — the prior AI-reasoning pass's understanding of the app
 *     (applicationType, entities, capabilities, flows, missingInformation).
 *
 * Building on the reasoning (rather than re-deriving the app understanding)
 * lets the planner focus on the QA task. Both inputs are JSON only — never raw
 * HTML, screenshots, or Playwright objects.
 */
export interface PlannerInput {
  observations: Observations;
  /** May be null if `reason` has not been run yet. */
  reasoning: unknown;
}

export async function loadPlannerInput(artifactsDir: string): Promise<PlannerInput> {
  const observations = await loadObservations(artifactsDir);
  let reasoning: unknown = null;
  try {
    reasoning = JSON.parse(await readFile(join(artifactsDir, 'reasoning.json'), 'utf-8'));
  } catch {
    // No reasoning yet — the planner can still run on observations alone.
  }
  return { observations, reasoning };
}
