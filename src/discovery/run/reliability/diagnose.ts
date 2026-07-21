import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FailureCategory, RepairDiagnostics } from './types.js';

/**
 * Normalize a failed Playwright run into a structured {@link RepairDiagnostics}
 * for the repair engine. Raw logs are NOT passed to the model — only the
 * distilled signals below.
 *
 * Sources:
 *   - the captured Playwright stdout/stderr (error type, locator, expected/
 *     received, failing source line)
 *   - the collector artifacts (console errors, network failures)
 *   - the execution artifact directory (screenshot / trace / video paths)
 */
export function diagnose(options: {
  stdout: string;
  stderr: string;
  cwd: string;
}): RepairDiagnostics {
  const blob = `${options.stdout}\n${options.stderr}`;

  const errorType = classifyError(blob);
  const message = extractMessage(blob);
  const locator = extract(/Locator:\s*(.+)/, blob);
  const expected = extract(/Expected:\s*(.+)/, blob);
  const received = extract(/Received:\s*(.+)/, blob);
  const codeLine = extract(/>\s*\d+\s*\|\s*(.+)/, blob);

  const artifacts = findArtifacts(options.cwd);
  const { consoleErrors, networkFailures } = readCollectors(options.cwd);

  return {
    errorType,
    message,
    locator: clean(locator),
    expected: clean(expected),
    received: clean(received),
    codeLine: clean(codeLine),
    consoleErrors,
    networkFailures,
    artifacts,
  };
}

function classifyError(blob: string): FailureCategory {
  if (/strict mode violation/i.test(blob)) return 'strict-mode';
  if (/TimeoutError|Timeout \d+ms exceeded/i.test(blob)) return 'timeout';
  if (/SyntaxError|Unexpected (token|identifier)/i.test(blob)) return 'syntax';
  if (/TypeError: .+ is not a function/i.test(blob)) return 'api-misuse';
  if (/expect\(.*\).*failed|expect\(locator\)/i.test(blob)) return 'expect-failed';
  return 'other';
}

function extractMessage(blob: string): string {
  // First meaningful error line.
  const candidates = [
    /Error: expect\(.*?\) (.+?)\n/,
    /Error: (.+?)(?:\n|$)/,
    /(TimeoutError: .+?)(?:\n|$)/,
    /(TypeError: .+?)(?:\n|$)/,
    /(SyntaxError: .+?)(?:\n|$)/,
  ];
  for (const re of candidates) {
    const m = blob.match(re);
    if (m) return m[1].trim().slice(0, 240);
  }
  return 'Unknown failure';
}

function extract(re: RegExp, blob: string): string | undefined {
  const m = blob.match(re);
  return m ? m[1] : undefined;
}

function clean(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.trim().replace(/\s+/g, ' ').slice(0, 240);
}

/** Find the most-recent generated-test artifact dir (screenshot/trace/video). */
function findArtifacts(cwd: string): RepairDiagnostics['artifacts'] {
  const root = resolve(cwd, 'artifacts', 'test-output');
  let dirs: string[] = [];
  try {
    dirs = readdirSync(root).filter((d) => d.startsWith('replayqa-generated-'));
  } catch {
    return {};
  }
  if (dirs.length === 0) return {};
  // newest by mtime
  let newest = dirs[0];
  let newestMtime = 0;
  for (const d of dirs) {
    const st = statSync(resolve(root, d));
    if (st.mtimeMs > newestMtime) {
      newestMtime = st.mtimeMs;
      newest = d;
    }
  }
  const dir = resolve(root, newest);
  const pick = (name: string): string | undefined => {
    const p = resolve(dir, name);
    return existsSync(p) ? p : undefined;
  };
  return {
    screenshot: pick('test-failed-1.png') ?? pick('test-finished-1.png'),
    trace: pick('trace.zip'),
    video: pick('video.webm'),
  };
}

/** Read the most-recent generated-test console + network collector logs. */
function readCollectors(
  cwd: string
): { consoleErrors: string[]; networkFailures: string[] } {
  const root = resolve(cwd, 'artifacts', 'logs', 'chromium');
  let dirs: string[] = [];
  try {
    dirs = readdirSync(root).filter((d) => d.startsWith('replayqa-generated_'));
  } catch {
    return { consoleErrors: [], networkFailures: [] };
  }
  if (dirs.length === 0) return { consoleErrors: [], networkFailures: [] };
  let newest = dirs[0];
  let newestMtime = 0;
  for (const d of dirs) {
    const st = statSync(resolve(root, d));
    if (st.mtimeMs > newestMtime) {
      newestMtime = st.mtimeMs;
      newest = d;
    }
  }
  const dir = resolve(root, newest);
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];

  const consolePath = resolve(dir, 'console.json');
  if (existsSync(consolePath)) {
    try {
      const entries = JSON.parse(readFileSync(consolePath, 'utf-8')) as Array<{
        type?: string;
        text?: string;
      }>;
      for (const e of entries) {
        if ((e.type ?? '').toLowerCase() === 'error' && e.text) {
          consoleErrors.push(e.text.slice(0, 200));
        }
      }
    } catch {
      /* ignore malformed collector output */
    }
  }
  const networkPath = resolve(dir, 'network.json');
  if (existsSync(networkPath)) {
    try {
      const entries = JSON.parse(readFileSync(networkPath, 'utf-8')) as Array<{
        request?: { method?: string; url?: string };
        response?: { status?: number };
      }>;
      for (const e of entries) {
        const status = e.response?.status ?? 0;
        if (status >= 400 || status === 0) {
          networkFailures.push(
            `${e.request?.method ?? ''} ${e.request?.url ?? ''} → ${status || 'no response'}`
          );
        }
      }
    } catch {
      /* ignore */
    }
  }
  return {
    consoleErrors: consoleErrors.slice(0, 6),
    networkFailures: networkFailures.slice(0, 6),
  };
}
