import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EventImportance, EventType, Timeline, TimelineEvent } from './types.js';

/**
 * `Date.now()` is captured at the call site so timestamps reflect REAL
 * execution time, satisfying Refinement #1. Indirection makes the recorder
 * deterministic in tests.
 */
const nowMs = () => Date.now();

export type TimelineSubscriber = (event: TimelineEvent) => void;
export type Unsubscribe = () => void;

/**
 * A live recorder that turns ReplayQA stage transitions into a persisted,
 * timestamped timeline.
 *
 * Design points (Refinement #1):
 *  - Timestamps come from the wall clock at the moment `record()` is called.
 *    Nothing is reconstructed after the run.
 *  - The timeline is **streamed to disk on every event** (and flushed on
 *    process exit), so a crash mid-run still leaves a partial, honest record.
 *  - Subscribers (e.g. a future live progress UI) are notified synchronously.
 *
 * The recorder is intentionally framework-free: it has no knowledge of
 * discovery, reasoning, or narration. Callers decide what to emit.
 */
export class TimelineRecorder {
  private readonly events: TimelineEvent[] = [];
  private readonly subscribers = new Set<TimelineSubscriber>();
  private readonly epoch: number;
  private readonly epochIso: string;
  private readonly runId: string;
  private readonly file?: string;
  private sequence = 0;
  private exitHandler?: () => void;

  constructor(options: { runId: string; file?: string; epoch?: number }) {
    this.runId = options.runId;
    this.file = options.file;
    this.epoch = options.epoch ?? nowMs();
    this.epochIso = new Date(this.epoch).toISOString();
    if (this.file) {
      mkdirSync(resolve(this.file, '..'), { recursive: true });
      this.persist();
      this.exitHandler = () => this.persist();
      try {
        process.on('exit', this.exitHandler);
      } catch {
        /* non-Node-like runtime — streaming persistence still works inline */
      }
    }
  }

  /**
   * Record an event. Returns the created event for caller convenience.
   * `metadata` must contain only verified facts.
   */
  record(
    type: EventType,
    metadata: Record<string, unknown> = {},
    importance: EventImportance = 'medium'
  ): TimelineEvent {
    const event: TimelineEvent = {
      id: this.nextId(type),
      timestamp: nowMs() - this.epoch,
      type,
      importance,
      metadata: Object.freeze({ ...metadata }),
    };
    this.events.push(event);
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        /* a subscriber must never break the run */
      }
    }
    if (this.file) this.persist();
    return event;
  }

  /** Register a live subscriber. Returns an unsubscribe function. */
  subscribe(fn: TimelineSubscriber): Unsubscribe {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Snapshot of the timeline so far. */
  getTimeline(): Timeline {
    return {
      runId: this.runId,
      epoch: this.epochIso,
      events: this.events.map((e) => ({ ...e, metadata: { ...e.metadata } })),
    };
  }

  /** Number of events recorded. */
  get count(): number {
    return this.events.length;
  }

  /** Flush the current timeline to disk (no-op if no file was configured). */
  persist(): void {
    if (!this.file) return;
    try {
      writeFileSync(this.file, JSON.stringify(this.getTimeline(), null, 2) + '\n', 'utf-8');
    } catch {
      /* best-effort: a persistence failure must not abort the run */
    }
  }

  private nextId(type: EventType): string {
    this.sequence += 1;
    return `${String(this.sequence).padStart(3, '0')}-${type}`;
  }
}
