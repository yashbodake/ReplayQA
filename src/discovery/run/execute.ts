import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface ExecuteResult {
  exitCode: number;
  /** Captured stdout (also streamed live to the console). */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
  /** Path to the ReplayQA HTML dashboard, if produced. */
  reportPath?: string;
  passed: boolean;
}

/**
 * Execute the generated Playwright test by shelling out to the local Playwright
 * binary with the project's existing config. This reuses ALL of ReplayQA's
 * execution infrastructure:
 *
 *   - playwright.config.ts           → video / trace / screenshot / launchOptions
 *   - src/runner/fixtures.ts         → console + network collectors (auto-attached)
 *   - src/reporter/replayqa-reporter → reports/index.html (the final HTML report)
 *
 * Stdout/stderr are streamed live AND captured so that, on failure, the error
 * can be fed back to the generator for a single self-repair pass.
 */
export function executeTest(
  testFile: string,
  options: { cwd?: string; headed?: boolean } = {}
): Promise<ExecuteResult> {
  const cwd = options.cwd ?? process.cwd();
  const bin = resolve(cwd, 'node_modules', '.bin', 'playwright');
  const args = ['test', testFile, '--project=chromium'];
  if (options.headed) args.push('--headed');

  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const reportPath = resolve(cwd, 'reports', 'index.html');
      resolvePromise({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        reportPath: existsSync(reportPath) ? reportPath : undefined,
        passed: exitCode === 0,
      });
    });

    child.on('error', () => {
      resolvePromise({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        reportPath: undefined,
        passed: false,
      });
    });
  });
}
