import { resolve } from 'node:path';
import { BrowserController } from '../browser/controller.js';
import { StateManager } from '../state/manager.js';
import { DetectorManager } from '../detectors/manager.js';
import { DummyDetector } from '../detectors/dummy.js';
import type { ReplayQAConfig } from '../../config/types.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';

/**
 * Shared context object passed through a discovery run. Replaces parameter
 * chains (`page`, `config`, `origin`, …) with a single carrier so module
 * boundaries stay narrow as the engine grows toward the documented architecture.
 */
export interface DiscoveryContext {
  /** Per-run id (UTC timestamp + short suffix). */
  runId: string;
  /** Absolute target URL. */
  targetUrl: string;
  /** App origin, used by the controller for same-origin filtering. */
  origin: string;
  /** Resolved output directory for this run (…/artifacts/discovery). */
  outputDir: string;
  /** Directory where unique captured states are persisted. */
  statesDir: string;
  /** Directory where per-state findings aggregates are persisted. */
  findingsDir: string;
  /** Loaded ReplayQAConfig. */
  config: ReplayQAConfig;
  /** Diagnostic logger. */
  logger: Logger;
  /** The single browser interface for the run. */
  controller: BrowserController;
  /** The State Manager: captures pages, fingerprints them, persists unique states. */
  stateManager: StateManager;
  /** The Detector Manager: runs detectors over captured states, persists findings. */
  detectorManager: DetectorManager;
}

export interface BuildContextOptions {
  targetUrl: string;
  outputDir: string;
  config: ReplayQAConfig;
  logger?: Logger;
  headed?: boolean;
}

export function buildContext(options: BuildContextOptions): DiscoveryContext {
  const origin = deriveOrigin(options.targetUrl);
  const statesDir = resolve(options.outputDir, 'states');
  const findingsDir = resolve(options.outputDir, 'findings');
  const logger = options.logger ?? consoleLogger;
  const controller = new BrowserController({ headed: options.headed, origin });
  const detectorManager = new DetectorManager({ findingsDir, logger });
  // The DummyDetector is registered so the findings pipeline is exercised
  // end-to-end. Real detectors (04-detectors.md) replace/add to it later.
  detectorManager.register(new DummyDetector());
  return {
    runId: generateRunId(),
    targetUrl: options.targetUrl,
    origin,
    outputDir: options.outputDir,
    statesDir,
    findingsDir,
    config: options.config,
    logger,
    controller,
    stateManager: new StateManager(controller, { statesDir, logger }),
    detectorManager,
  };
}

function deriveOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${ts}-${suffix}`;
}
