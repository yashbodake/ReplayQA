import type { DiscoveryCredentials } from '../../config/types.js';
import type { Logger } from './logger.js';
import type { EventType } from '../../narration/timeline/types.js';

/** Coarse phases the engine emits for console/progress UI. */
export type DiscoveryPhase = 'opening' | 'login-start' | 'login-failed' | 'discovering';

/**
 * A discovery event hook. The engine calls it at meaningful boundaries with
 * the event type and verified-facts-only metadata. The narration subsystem
 * adapts this into a `TimelineRecorder.record()` call; nothing in discovery
 * depends on narration, keeping the dependency direction intact.
 */
export type DiscoveryEventFn = (type: EventType, metadata?: Record<string, unknown>) => void;

export interface DiscoveryHooks {
  /** Called by the engine at phase boundaries (for console output). */
  onPhase?: (phase: DiscoveryPhase) => void;
  /** Called by the engine when a narration-worthy event occurs. */
  onEvent?: DiscoveryEventFn;
}

/**
 * Options for a discovery run. Mirrors the Milestone-1 surface so the CLI
 * contract is unchanged; `logger` and `outputDir` are added so the engine can
 * populate the DiscoveryContext without the CLI reaching into engine internals.
 */
export interface DiscoveryOptions extends DiscoveryHooks {
  headed?: boolean;
  credentials?: DiscoveryCredentials;
  maxPages?: number;
  /** Maximum safe action probes executed per base state. */
  maxProbesPerState?: number;
  /** Resolved discovery output directory (carried on the context). */
  outputDir?: string;
  /** Diagnostic logger. Defaults to consoleLogger. */
  logger?: Logger;
}
