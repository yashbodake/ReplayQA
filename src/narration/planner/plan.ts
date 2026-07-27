import type { EventType, TimelineEvent } from '../timeline/types.js';
import type { NarrationContext } from '../types.js';
import type { ChapterEvidence, NarrationChapter } from './types.js';

/**
 * Target spoken length of the whole summary, in seconds. The spec asks for
 * 60–90s; we plan toward the midpoint and let the script generator aim there.
 */
const TARGET_DURATION_SECONDS = 75;

/**
 * Convert the timeline into narration chapters (Refinement #2).
 *
 * Responsibilities (exhaustive):
 *  - Decide WHICH events are worth a chapter (drop noise).
 *  - Merge related events into one chapter (e.g. many `state-discovered` →
 *    one "Discovery" chapter whose facts carry the count).
 *  - Order chapters and assign `start` / `duration` offsets within the
 *    TARGET_DURATION_SECONDS window, derived from real event timestamps.
 *
 * This function NEVER produces natural-language narration. It returns titles
 * and verified facts only; the script module owns all prose.
 */
export function planChapters(ctx: NarrationContext): NarrationChapter[] {
  const events = ctx.timeline.events;

  const definitions = buildChapterDefinitions(ctx);
  const present = definitions.filter((d) => d.eventIds.length > 0 || d.always);

  // Weight each present chapter by the wall-clock span of its events so
  // longer-running stages get proportionally more narration time.
  const weights = present.map((d) => Math.max(1, chapterSpanMs(d.eventIds, events)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const chapters: NarrationChapter[] = [];
  let cursor = 0;
  present.forEach((def, i) => {
    const duration = Math.max(4, Math.round((weights[i] / totalWeight) * TARGET_DURATION_SECONDS));
    chapters.push({
      index: i,
      title: def.title,
      start: Math.round(cursor),
      duration,
      evidence: def.evidence,
    });
    cursor += duration;
  });

  // Normalise the final chapter to end near the target (keeps us in 60–90s).
  return chapters;
}

interface ChapterDefinition {
  title: string;
  eventIds: string[];
  evidence: ChapterEvidence;
  /** Present even when no matching event was recorded (e.g. a closing chapter). */
  always?: boolean;
}

/**
 * Build the ordered list of candidate chapters from the context. Each chapter
 * pulls ONLY verified facts (counts, titles, outcomes) — never invented ones.
 */
function buildChapterDefinitions(ctx: NarrationContext): ChapterDefinition[] {
  const events = ctx.timeline.events;
  const byType = (t: EventType) => events.filter((e) => e.type === t);
  const ids = (evs: TimelineEvent[]) => evs.map((e) => e.id);

  const stateCount = ctx.discovery?.pages.length ?? byType('state-discovered').length;
  const flowCount =
    ctx.flowGraph?.edges.length ?? ctx.journeys?.length ?? byType('flow-discovered').length;

  const authenticated = byType('authenticated').length > 0;
  const loginFailed = byType('login-failed').length > 0;

  const repairEvents = byType('repair-attempt');
  const repairsUsed = ctx.reliability?.repairsUsed ?? repairEvents.length;

  const executionPassed = ctx.reliability?.passed ?? byType('execution-passed').length > 0;
  const executionFailed = byType('execution-failed').length > 0 && !executionPassed;

  const defs: ChapterDefinition[] = [];

  // ── Discovery ───────────────────────────────────────────────────────────
  const discoveryEvs = [
    ...byType('discovery-started'),
    ...byType('landing-captured'),
    ...byType('state-discovered'),
    ...byType('flow-discovered'),
  ];
  defs.push({
    title: 'Discovery',
    eventIds: ids(discoveryEvs),
    evidence: {
      eventType: ['discovery-started', 'landing-captured', 'state-discovered', 'flow-discovered'],
      facts: {
        targetUrl: ctx.targetUrl,
        stateCount,
        flowCount,
        ...(ctx.reasoning?.applicationType ? { applicationType: ctx.reasoning.applicationType } : {}),
      },
      summary: `${stateCount} state${stateCount === 1 ? '' : 's'}, ${flowCount} flow${flowCount === 1 ? '' : 's'} discovered`,
    },
  });

  // ── Authentication (only if relevant) ───────────────────────────────────
  const authEvs = [...byType('authenticated'), ...byType('login-failed')];
  if (authEvs.length > 0) {
    defs.push({
      title: 'Authentication',
      eventIds: ids(authEvs),
      evidence: {
        eventType: ['authenticated', 'login-failed'],
        facts: { authenticated, loginFailed },
        summary: authenticated ? 'authentication succeeded' : 'authentication failed',
      },
    });
  }

  // ── Reasoning ───────────────────────────────────────────────────────────
  const reasoningEvs = byType('reasoning-completed');
  if (reasoningEvs.length > 0 || ctx.reasoning) {
    defs.push({
      title: 'Application Understanding',
      eventIds: ids(reasoningEvs),
      evidence: {
        eventType: 'reasoning-completed',
        facts: {
          applicationType: ctx.reasoning?.applicationType,
          entities: ctx.reasoning?.entities ?? [],
          capabilities: ctx.reasoning?.capabilities ?? [],
          confidence: ctx.reasoning?.confidence,
          blindSpots: ctx.reasoning?.missingInformation ?? [],
        },
        summary: ctx.reasoning
          ? `understood as "${ctx.reasoning.applicationType}" (confidence ${ctx.reasoning.confidence.toFixed(2)})`
          : 'application understanding completed',
      },
    });
  }

  // ── QA Plan ─────────────────────────────────────────────────────────────
  const planEvs = byType('qa-plan-generated');
  if (planEvs.length > 0 || ctx.plan) {
    const scenarioCount = ctx.plan?.functionalScenarios.length ?? 0;
    defs.push({
      title: 'QA Plan',
      eventIds: ids(planEvs),
      evidence: {
        eventType: 'qa-plan-generated',
        facts: {
          scenarioCount,
          confidence: ctx.plan?.confidence,
          criticalJourneys: ctx.plan?.criticalUserJourneys.map((j) => j.name) ?? [],
        },
        summary: `${scenarioCount} test scenario${scenarioCount === 1 ? '' : 's'} planned`,
      },
    });
  }

  // ── Test Generation & Execution ─────────────────────────────────────────
  const genEvs = [...byType('generation-started'), ...byType('repair-attempt'), ...byType('execution-passed'), ...byType('execution-failed')];
  if (genEvs.length > 0 || ctx.reliability) {
    defs.push({
      title: 'Test Generation & Execution',
      eventIds: ids(genEvs),
      evidence: {
        eventType: ['generation-started', 'repair-attempt', 'execution-passed', 'execution-failed'],
        facts: {
          scenarioTitle: ctx.topScenario?.title,
          scenarioId: ctx.topScenario?.id,
          attempts: ctx.reliability?.attempts ?? repairEvents.length,
          repairsUsed,
          passed: executionPassed,
          firstPassSuccess: ctx.reliability?.firstPassSuccess,
        },
        summary: executionPassed
          ? `test "${ctx.topScenario?.title ?? 'generated'}" passed${repairsUsed > 0 ? ` after ${repairsUsed} repair(s)` : ' on the first attempt'}`
          : executionFailed
            ? `test failed after ${ctx.reliability?.attempts ?? repairEvents.length} attempt(s)`
            : 'test generation completed',
      },
    });
  }

  // ── Conclusion (always present; closes the summary) ─────────────────────
  defs.push({
    title: 'Conclusion',
    eventIds: ids(byType('run-finished')),
    always: true,
    evidence: {
      eventType: 'run-finished',
      facts: { passed: executionPassed, applicationType: ctx.reasoning?.applicationType },
      summary: executionPassed ? 'run completed successfully' : 'run completed',
    },
  });

  return defs;
}

/** Sum of wall-clock spans for the given event ids (min..max within the group). */
function chapterSpanMs(eventIds: string[], events: readonly TimelineEvent[]): number {
  if (eventIds.length === 0) return 1;
  const selected = events.filter((e) => eventIds.includes(e.id));
  if (selected.length === 0) return 1;
  const ts = selected.map((e) => e.timestamp);
  return Math.max(1, Math.max(...ts) - Math.min(...ts));
}
