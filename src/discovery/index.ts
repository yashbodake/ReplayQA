/**
 * ReplayQA Discovery — public surface.
 *
 * The engine is organised so dependencies flow strictly downward
 * (cli → core → {state, collector, login, browser} → models → config), and
 * BrowserController is the only module that imports Playwright. See
 * docs/discovery/ for the full architecture this foundation prepares for.
 */
export { runDiscovery } from './core/discover.js';
export { buildContext, consoleLogger } from './core/index.js';
export type {
  DiscoveryContext,
  DiscoveryPhase,
  DiscoveryHooks,
  DiscoveryOptions,
  Logger,
} from './core/index.js';
export { BrowserController } from './browser/index.js';
export type { BrowserControllerOptions, Selector, StateMaterials } from './browser/index.js';
export { StateManager, computeStateId } from './state/index.js';
export type { StateManagerOptions } from './state/index.js';
export { DetectorManager, DummyDetector, findingId } from './detectors/index.js';
export type { Detector, DetectorManagerOptions } from './detectors/index.js';
export type {
  RawSnapshot,
  NavLink,
  State,
  StateMetadata,
  DiscoveredPage,
  DiscoveryResult,
  FormInfo,
  TableInfo,
  InputInfo,
  Finding,
  FindingType,
  FindingBase,
  FindingMetadata,
  Evidence,
  EvidenceKind,
  AuthenticationFinding,
  TableFinding,
  FormFinding,
  SearchFinding,
  NavigationFinding,
  AuthenticationPayload,
  TablePayload,
  FormPayload,
  SearchPayload,
  NavigationPayload,
} from './models/index.js';
