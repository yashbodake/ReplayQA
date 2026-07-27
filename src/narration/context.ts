import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DiscoveryResult } from '../discovery/models/result.js';
import type { ReasoningResult } from '../discovery/reasoning-lab/types.js';
import type { TestPlan, TestScenario } from '../discovery/qa-planning-lab/types.js';
import type { FlowGraph, Journey } from '../discovery/flow/journey-builder.js';
import { loadTimeline } from './timeline/index.js';
import { pickTopScenario } from '../discovery/run/summary.js';
import type { NarrationContext, ReliabilityOutcomeSummary } from './types.js';

/**
 * The single aggregator (Refinement #3): load every structured ReplayQA
 * artifact from `artifactsDir` into one typed `NarrationContext`.
 *
 * - `timeline` is required (Refinement #1 — it is a real runtime artifact).
 * - Every other artifact is optional and loaded best-effort: a missing file
 *   yields `undefined`, never a thrown error, so the script generator can
 *   narrate whatever the run actually reached.
 */
export async function loadNarrationContext(artifactsDir: string): Promise<NarrationContext> {
  const dir = resolve(artifactsDir);
  const timeline = loadTimeline(dir);

  const discovery = readJsonOptional<DiscoveryResult>(dir, 'discovery.json');
  const reasoning = readJsonOptional<ReasoningResult>(dir, 'reasoning.json');
  const plan = readJsonOptional<TestPlan>(dir, 'test-plan.json');
  const flowGraph = readJsonOptional<FlowGraph>(dir, 'flow-graph.json');
  const journeys = readJsonOptional<Journey[]>(dir, 'journeys.json');
  const reliability = readJsonOptional<ReliabilityOutcomeSummary>(dir, 'reliability-outcome.json');

  const topScenario: TestScenario | undefined = plan ? pickTopScenario(plan) : undefined;

  const targetUrl =
    discovery?.application?.url ??
    (typeof timeline.events[0]?.metadata?.url === 'string' ? String(timeline.events[0].metadata.url) : '');

  return { targetUrl, timeline, discovery, reasoning, plan, flowGraph, journeys, reliability, topScenario };
}

function readJsonOptional<T>(dir: string, name: string): T | undefined {
  const file = resolve(dir, name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}
