import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  FailureCategory,
  GenerationOutcome,
  ReliabilityMetrics,
  RunRecord,
} from './types.js';

const DEFAULT_PATH = 'artifacts/discovery/reliability-metrics.json';

/** Convert a generation outcome into an appendable run record. */
export function toRunRecord(args: {
  targetUrl: string;
  scenarioTitle: string;
  outcome: GenerationOutcome;
}): RunRecord {
  const { outcome } = args;
  const failureCategories: FailureCategory[] = [];
  const repairedMistakes: string[] = [];
  let deterministicallyFixed = 0;

  for (const a of outcome.attempts) {
    deterministicallyFixed += a.validation.findings.filter((f) => f.autoFixed).length;
    if (a.execution.diagnostics?.errorType) {
      failureCategories.push(a.execution.diagnostics.errorType);
    }
    if (a.repair?.whatChanged) repairedMistakes.push(a.repair.whatChanged);
  }

  return {
    timestamp: new Date().toISOString(),
    targetUrl: args.targetUrl,
    scenarioTitle: args.scenarioTitle,
    passed: outcome.passed,
    firstPassSuccess: outcome.firstPassSuccess,
    attempts: outcome.attempts.length,
    repairsUsed: outcome.repairAttemptsUsed,
    durationMs: outcome.totalDurationMs,
    failureCategories,
    repairedMistakes,
    deterministicallyFixed,
  };
}

/** Append a run record to the persisted metrics log (creating it if absent). */
export function recordRun(record: RunRecord, metricsPath: string = DEFAULT_PATH): ReliabilityMetrics {
  const metrics = loadMetrics(metricsPath);
  metrics.runs.push(record);
  mkdirSync(dirname(resolve(metricsPath)), { recursive: true });
  writeFileSync(resolve(metricsPath), JSON.stringify(metrics, null, 2) + '\n', 'utf-8');
  return metrics;
}

export function loadMetrics(metricsPath: string = DEFAULT_PATH): ReliabilityMetrics {
  const abs = resolve(metricsPath);
  if (!existsSync(abs)) return { runs: [] };
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf-8')) as ReliabilityMetrics;
    return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
  } catch {
    return { runs: [] };
  }
}

/** Reset the metrics log (used by the benchmark to take a clean measurement). */
export function resetMetrics(metricsPath: string = DEFAULT_PATH): void {
  mkdirSync(dirname(resolve(metricsPath)), { recursive: true });
  writeFileSync(resolve(metricsPath), JSON.stringify({ runs: [] }, null, 2) + '\n', 'utf-8');
}

export interface Aggregate {
  totalRuns: number;
  passed: number;
  firstPassSuccessRate: number; // 0..1
  repairSuccessRate: number; // among runs needing repair, fraction that eventually passed
  avgAttempts: number;
  avgRepairsUsed: number;
  medianRepairsUsed: number;
  totalDeterministicallyFixed: number;
  failureCategoryCounts: Record<string, number>;
  repairedMistakeCounts: Record<string, number>;
}

export function aggregate(metrics: ReliabilityMetrics): Aggregate {
  const runs = metrics.runs;
  const total = runs.length;
  const passed = runs.filter((r) => r.passed).length;
  const firstPass = runs.filter((r) => r.firstPassSuccess).length;
  const neededRepair = runs.filter((r) => !r.firstPassSuccess);
  const repairPassed = neededRepair.filter((r) => r.passed).length;

  return {
    totalRuns: total,
    passed,
    firstPassSuccessRate: total ? firstPass / total : 0,
    repairSuccessRate: neededRepair.length ? repairPassed / neededRepair.length : 0,
    avgAttempts: avg(runs.map((r) => r.attempts)),
    avgRepairsUsed: avg(runs.map((r) => r.repairsUsed)),
    medianRepairsUsed: median(runs.map((r) => r.repairsUsed)),
    totalDeterministicallyFixed: runs.reduce((s, r) => s + r.deterministicallyFixed, 0),
    failureCategoryCounts: count(runs.flatMap((r) => r.failureCategories)),
    repairedMistakeCounts: count(runs.flatMap((r) => r.repairedMistakes)),
  };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function count<T extends string>(xs: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
