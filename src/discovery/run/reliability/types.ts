/**
 * Generation Reliability Pipeline — data shapes.
 *
 * The reliability pipeline turns a QA scenario into a passing Playwright test
 * through a loop of: static validation → execution → diagnosis → repair.
 * These types describe the evidence collected at each step so that every
 * attempt is auditable and the overall process is measurable.
 */

export type FailureCategory =
  | 'strict-mode' // a locator resolved to multiple elements
  | 'timeout' // element/action timeout
  | 'expect-failed' // assertion expected/received mismatch
  | 'api-misuse' // wrong Playwright API (e.g. calling an assertion on a locator)
  | 'hardcoded-count' // toHaveCount(N) where N is a literal the model guessed
  | 'brittle-selector' // CSS/XPath selector instead of role/label
  | 'syntax' // code did not compile/parse
  | 'validation' // static validation flagged an unfixable issue
  | 'other';

export type Severity = 'fixable' | 'warning' | 'blocker';

export interface ValidationFinding {
  category: FailureCategory;
  message: string;
  severity: Severity;
  /** Human-readable description of the deterministic fix applied, if any. */
  autoFixed?: string;
}

export interface StaticValidationResult {
  /** Source after deterministic auto-fixes. */
  code: string;
  findings: ValidationFinding[];
  hasSyntaxError: boolean;
  changed: boolean;
}

export interface RepairDiagnostics {
  errorType: FailureCategory;
  message: string;
  locator?: string;
  expected?: string;
  received?: string;
  codeLine?: string;
  consoleErrors: string[];
  networkFailures: string[];
  artifacts: { screenshot?: string; trace?: string; video?: string };
}

export interface RepairExplanation {
  whyFailed: string;
  whatChanged: string;
  whyShouldSucceed: string;
}

export interface AttemptExecution {
  passed: boolean;
  exitCode: number;
  durationMs: number;
  diagnostics?: RepairDiagnostics;
}

export interface RepairAttempt {
  /** 1-based: attempt 1 is the initial generation before any repair. */
  attemptNumber: number;
  source: 'generate' | 'repair';
  /** Code that was actually executed this attempt (after static auto-fixes). */
  code: string;
  validation: StaticValidationResult;
  execution: AttemptExecution;
  /**
   * Explanation of the repair applied AFTER this attempt failed (the repair
   * that produced the next attempt's code). Absent on the final attempt.
   */
  repair?: RepairExplanation;
}

export interface GenerationOutcome {
  passed: boolean;
  finalCode: string;
  attempts: RepairAttempt[];
  firstPassSuccess: boolean;
  /** Number of LLM repair calls performed. */
  repairAttemptsUsed: number;
  totalDurationMs: number;
  /** Execution HTML dashboard path (from the passing run, if any). */
  reportPath?: string;
}

/** A single benchmark/pipeline run, appended to the persisted metrics log. */
export interface RunRecord {
  timestamp: string;
  targetUrl: string;
  scenarioTitle: string;
  passed: boolean;
  firstPassSuccess: boolean;
  attempts: number;
  repairsUsed: number;
  durationMs: number;
  failureCategories: FailureCategory[];
  repairedMistakes: string[];
  deterministicallyFixed: number;
}

export interface ReliabilityMetrics {
  runs: RunRecord[];
}
