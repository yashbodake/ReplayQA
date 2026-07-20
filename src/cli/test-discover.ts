import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export interface DiscoveredTest {
  id: string;
  file: string;
  line: number;
  title: string;
  fullTitle: string;
  project: string;
}

export function discoverTests(cwd: string = process.cwd()): DiscoveredTest[] {
  const playwrightBin = resolve(cwd, 'node_modules', '.bin', 'playwright');

  let output: string;
  try {
    output = execFileSync(playwrightBin, ['test', '--list'], {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return [];
  }

  const tests: DiscoveredTest[] = [];
  const pattern = /^\s*\[(.+?)\]\s*[›>]\s*(.+?):(\d+):\d+\s*[›>]\s*(.+)$/;

  for (const line of output.split('\n')) {
    const match = line.match(pattern);
    if (!match) continue;

    const [, project, file, lineNum, titlePart] = match;
    const titleSegments = titlePart.split(/\s*[›>]\s*/).filter(Boolean);
    const title = titleSegments[titleSegments.length - 1] || titlePart.trim();
    const fullTitle = titleSegments.join(' › ');

    tests.push({
      id: `${file}:${lineNum}`,
      file,
      line: parseInt(lineNum, 10),
      title,
      fullTitle,
      project,
    });
  }

  return tests;
}
