import { writeFileSync } from 'node:fs';
import type { Observations } from '../../reasoning-lab/collect.js';
import type { TestScenario } from '../../qa-planning-lab/types.js';
import { executeTest } from '../execute.js';
import { staticValidate } from './static-validate.js';
import { diagnose } from './diagnose.js';
import { repairAttempt, type RepairOptions } from './repair.js';
import type {
  GenerationOutcome,
  RepairAttempt,
  RepairDiagnostics,
} from './types.js';

export interface LoopOptions extends RepairOptions {
  /** Maximum number of LLM repair calls after the initial generation. */
  maxRepairAttempts?: number;
  headed?: boolean;
  /** Absolute path the generated test is written to before execution. */
  testFile: string;
  cwd?: string;
  /** Progress callback (fires after each attempt completes). */
  onAttempt?: (attempt: RepairAttempt) => void;
}

const DEFAULT_MAX_REPAIRS = 3;

/**
 * The reliability pipeline:
 *
 *   generate → static-validate → execute → (diagnose → repair → execute)*
 *
 * Iterates until the test passes or `maxRepairAttempts` repairs have been
 * performed. Records every attempt (with diagnostics + repair explanation)
 * on the returned {@link GenerationOutcome}.
 */
export async function generateUntilPass(args: {
  initialCode: string;
  scenario: TestScenario;
  observations: Observations;
  options: LoopOptions;
}): Promise<GenerationOutcome> {
  const maxRepairs = args.options.maxRepairAttempts ?? DEFAULT_MAX_REPAIRS;
  const cwd = args.options.cwd ?? process.cwd();
  const startedAt = Date.now();
  const attempts: RepairAttempt[] = [];
  let code = args.initialCode;

  for (let n = 1; n <= maxRepairs + 1; n++) {
    // 1. Static validation (deterministic auto-fixes + findings)
    const validation = staticValidate(code);

    // 2. Execute — unless static validation found a hard syntax error, in
    //    which case synthesize a diagnostic and skip straight to repair.
    let execution: RepairAttempt['execution'];
    if (validation.hasSyntaxError) {
      execution = {
        passed: false,
        exitCode: 1,
        durationMs: 0,
        diagnostics: syntaxDiagnostic(validation.findings.map((f) => f.message).join('; ')),
      };
    } else {
      writeFileSync(args.options.testFile, validation.code + '\n', 'utf-8');
      const t0 = Date.now();
      const res = await executeTest(args.options.testFile, { cwd, headed: args.options.headed });
      const durationMs = Date.now() - t0;
      execution = {
        passed: res.passed,
        exitCode: res.exitCode,
        durationMs,
        diagnostics: res.passed
          ? undefined
          : diagnose({ stdout: res.stdout, stderr: res.stderr, cwd }),
      };
    }

    const attempt: RepairAttempt = {
      attemptNumber: n,
      source: n === 1 ? 'generate' : 'repair',
      code: validation.code,
      validation,
      execution,
    };
    attempts.push(attempt);
    args.options.onAttempt?.(attempt);

    if (execution.passed) {
      const totalDurationMs = Date.now() - startedAt;
      return {
        passed: true,
        finalCode: validation.code,
        attempts,
        firstPassSuccess: n === 1,
        repairAttemptsUsed: n - 1,
        totalDurationMs,
        reportPath: undefined, // filled by caller from the executor's reportPath if needed
      };
    }

    // No repairs left → stop.
    if (n > maxRepairs) break;

    // 3. Repair with full structured context + history.
    if (!execution.diagnostics) break; // defensive — nothing to repair from
    const repair = await repairAttempt({
      scenario: args.scenario,
      observations: args.observations,
      diagnostics: execution.diagnostics,
      validation,
      history: attempts,
      options: {
        apiKey: args.options.apiKey,
        baseUrl: args.options.baseUrl,
        model: args.options.model,
      },
    });
    attempt.repair = repair.explanation; // explains the fix that produced the next attempt
    code = repair.code;
  }

  const last = attempts[attempts.length - 1];
  return {
    passed: false,
    finalCode: last?.code ?? code,
    attempts,
    firstPassSuccess: false,
    repairAttemptsUsed: attempts.filter((a) => a.repair).length,
    totalDurationMs: Date.now() - startedAt,
  };
}

function syntaxDiagnostic(message: string): RepairDiagnostics {
  return {
    errorType: 'syntax',
    message: message || 'Static validation detected a syntax error.',
    consoleErrors: [],
    networkFailures: [],
    artifacts: {},
  };
}
