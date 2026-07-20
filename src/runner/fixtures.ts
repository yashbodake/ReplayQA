import { test as baseTest, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { attachConsoleCollector, attachNetworkCollector } from '../collectors/index.js';
import { findConfig, ReplayQAConfig } from '../config/index.js';
import { sanitizeFileName } from '../utils/path-utils.js';

let cachedConfig: ReplayQAConfig | undefined;

async function getConfig(): Promise<ReplayQAConfig> {
  if (!cachedConfig) {
    cachedConfig = await findConfig();
  }
  return cachedConfig;
}

export const test = baseTest.extend<{
  _artifactCollector: void;
}>({
  _artifactCollector: [
    async ({ page }, use, testInfo) => {
      const config = await getConfig();
      const collectors = [];

      const testSlug = sanitizeFileName(testInfo.titlePath.join(' '));
      const logDir = resolve(
        config.outputDir,
        'logs',
        testInfo.project.name,
        testSlug
      );

      if (config.artifacts.consoleLogs) {
        collectors.push(
          attachConsoleCollector(page, resolve(logDir, 'console.json'))
        );
      }

      if (config.artifacts.networkLogs) {
        collectors.push(
          attachNetworkCollector(page, resolve(logDir, 'network.json'))
        );
      }

      await use();

      await Promise.all(collectors.map((collector) => collector.dispose()));
    },
    { auto: true },
  ],
});

export { expect };
