import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Timeline, TimelineEvent } from './types.js';

/**
 * Load a persisted timeline from `artifacts/narration/timeline.json`.
 *
 * Per Refinement #1, the timeline is a REAL runtime artifact. If it is missing
 * we refuse (rather than fabricate synthetic timestamps) — callers should run
 * a fresh ReplayQA pipeline that emits events. A defensively-parsed partial
 * file is tolerated so a crashed run's partial timeline remains usable.
 */
export function loadTimeline(artifactsDir: string): Timeline {
  const file = resolve(artifactsDir, 'narration', 'timeline.json');
  const raw = readFileSync(file, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<Timeline>;
  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error(`Timeline at ${file} is malformed (missing events array).`);
  }
  return normalize(parsed);
}

/** Find all events of a given type, in recorded order. */
export function eventsOfType(events: readonly TimelineEvent[], type: TimelineEvent['type']): TimelineEvent[] {
  return events.filter((e) => e.type === type);
}

/** The first event of `type`, or undefined. */
export function firstEventOfType(events: readonly TimelineEvent[], type: TimelineEvent['type']): TimelineEvent | undefined {
  return events.find((e) => e.type === type);
}

function normalize(parsed: Partial<Timeline>): Timeline {
  return {
    runId: typeof parsed.runId === 'string' ? parsed.runId : 'unknown',
    epoch: typeof parsed.epoch === 'string' ? parsed.epoch : new Date(0).toISOString(),
    events: parsed.events!.map((e) => ({
      id: String(e?.id ?? ''),
      timestamp: Number(e?.timestamp ?? 0),
      type: String(e?.type ?? 'run-started') as TimelineEvent['type'],
      importance: (e?.importance ?? 'medium') as TimelineEvent['importance'],
      metadata: (e?.metadata && typeof e.metadata === 'object' ? { ...e.metadata } : {}) as Record<string, unknown>,
    })),
  };
}
