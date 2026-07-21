export type {
  FailureCategory,
  Severity,
  ValidationFinding,
  StaticValidationResult,
  RepairDiagnostics,
  RepairExplanation,
  AttemptExecution,
  RepairAttempt,
  GenerationOutcome,
  RunRecord,
  ReliabilityMetrics,
} from './types.js';
export { staticValidate, countAutoFixed } from './static-validate.js';
export { diagnose } from './diagnose.js';
export { repairAttempt } from './repair.js';
export type { RepairOptions, RepairResult } from './repair.js';
export { generateUntilPass } from './loop.js';
export type { LoopOptions } from './loop.js';
export {
  aggregate,
  loadMetrics,
  recordRun,
  resetMetrics,
  toRunRecord,
} from './metrics.js';
export type { Aggregate } from './metrics.js';
export { renderReliabilityReport } from './report.js';
