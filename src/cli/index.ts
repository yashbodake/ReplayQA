import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { discoverTests, DiscoveredTest } from './test-discover.js';
import { interactiveCheckboxSelect, SelectableItem } from './interactive-selector.js';

export async function runInteractive(cwd: string = process.cwd()): Promise<void> {
  console.log('Discovering tests...');
  const tests = discoverTests(cwd);

  if (tests.length === 0) {
    console.log('No tests found.');
    return;
  }

  const items = tests.map((test) => ({
    label: test.fullTitle || test.title,
    value: test.id,
    hint: `[${test.project}]`,
  }));

  const selected = await interactiveCheckboxSelect(items, {
    title: `${tests.length} tests available`,
  });

  if (selected.length === 0) {
    console.log('No tests selected. Exiting.');
    return;
  }

  console.log(`\nRunning ${selected.length} test(s)...\n`);

  const testPatterns = selected.map((id) => {
    const test = tests.find((t) => t.id === id);
    return `${test!.file}:${test!.line}`;
  });

  await runPlaywrightTests(testPatterns, cwd);
}

function runPlaywrightTests(
  patterns: string[],
  cwd: string
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const playwrightBin = resolve(cwd, 'node_modules', '.bin', 'playwright');
    const args = ['test', ...patterns];

    const child = spawn(playwrightBin, args, {
      cwd,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`Playwright exited with code ${code}`));
      }
    });

    child.on('error', rejectPromise);
  });
}

export { discoverTests, interactiveCheckboxSelect };
export type { DiscoveredTest };
export type { SelectableItem };
