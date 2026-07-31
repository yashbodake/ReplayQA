import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, readdirSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import type { DiscoveryCredentials } from '../../config/types.js';
import { buildCredentialEnv } from './credentials.js';

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
  options: { cwd?: string; headed?: boolean; credentials?: DiscoveryCredentials; scenarioId?: string } = {}
): Promise<ExecuteResult> {
  const cwd = options.cwd ?? process.cwd();
  const bin = resolve(cwd, 'node_modules', '.bin', 'playwright');
  const args = ['test', testFile, '--project=chromium'];
  if (options.headed) args.push('--headed');

  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env, ...buildCredentialEnv(options.credentials) },
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

      // IMMEDIATELY preserve the video before the next Playwright invocation
      // can clean the outputDir. This is the critical fix: Playwright cleans
      // outputDir at the START of each test run, so by the time the next
      // scenario (or repair attempt) runs, this video would be gone.
      if (options.scenarioId) {
        preserveVideoImmediately(cwd, options.scenarioId);
      }

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

/**
 * Copy the latest test execution video to a per-scenario path IMMEDIATELY after
 * the test finishes, before the next Playwright invocation can clean outputDir.
 *
 * Playwright writes the video file asynchronously during browser context
 * teardown — it may not be on disk the instant the process exits. This function
 * polls for up to 3 seconds waiting for the file to appear and stabilize
 * (size stops changing), then copies it.
 */
function preserveVideoImmediately(cwd: string, scenarioId: string): void {
  try {
    const testOutputDir = resolve(cwd, 'artifacts', 'test-output');
    // CRITICAL: videos/ must be OUTSIDE test-output/ because Playwright cleans
    // the entire outputDir at the start of each test invocation. If videos/
    // were inside test-output/, each scenario's repair attempt would delete
    // all previously preserved videos.
    const videosDir = resolve(cwd, 'artifacts', 'videos');
    mkdirSync(videosDir, { recursive: true });

    // Wait for the video file to appear and stabilize (up to 3 seconds).
    // Playwright writes video.webm asynchronously during context teardown.
    const deadline = Date.now() + 3000;
    let lastSize = -1;
    let stableFor = 0;

    while (Date.now() < deadline) {
      // Find the most recently modified video.webm
      let latestVideo: string | undefined;
      let latestMtime = 0;
      function searchDir(dir: string): void {
        for (const entry of readdirSync(dir)) {
          if (entry === 'videos') continue;
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            searchDir(full);
          } else if (entry === 'video.webm' && stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestVideo = full;
          }
        }
      }
      searchDir(testOutputDir);

    if (latestVideo) {
        const size = statSync(latestVideo).size;
        if (size > 0 && size === lastSize) {
          // Size hasn't changed since last check — file is stable.
          stableFor++;
          if (stableFor >= 2) {
            const dest = resolve(videosDir, `${scenarioId}.webm`);
            copyFileSync(latestVideo, dest);
            return;
          }
        } else {
          stableFor = 0;
          lastSize = size;
        }
      } else {
        // No video found yet — keep waiting.
      }

      // Sleep 200ms before checking again.
      const start = Date.now();
      while (Date.now() - start < 200) { /* busy wait — synchronous context */ }
    }

    // Fallback: if we timed out waiting, try one last copy of whatever exists.
    let latestVideo: string | undefined;
    let latestMtime = 0;
    function searchDirFinal(dir: string): void {
      for (const entry of readdirSync(dir)) {
        if (entry === 'videos') continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          searchDirFinal(full);
        } else if (entry === 'video.webm' && stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestVideo = full;
        }
      }
    }
    searchDirFinal(testOutputDir);
    if (latestVideo) {
      const dest = resolve(videosDir, `${scenarioId}.webm`);
      copyFileSync(latestVideo, dest);
    }
  } catch { /* best-effort — don't fail the test over video preservation */ }
}
