import { defineConfig, devices } from '@playwright/test';
import { findConfigSync } from './src/config/index.js';

const replayQAConfig = findConfigSync();
const { artifacts } = replayQAConfig;

export default defineConfig({
  testDir: replayQAConfig.playwright.testDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : replayQAConfig.playwright.retries,
  workers: replayQAConfig.playwright.workers === 'auto'
    ? undefined
    : replayQAConfig.playwright.workers,
  reporter: [
    ['list'],
    ['./src/reporter/replayqa-reporter.ts'],
  ],
  outputDir: `${replayQAConfig.outputDir}/test-output`,
  use: {
    baseURL: process.env.BASE_URL || 'https://phone-book-yrap.vercel.app/',
    trace: artifacts.traces ? 'on' : 'off',
    screenshot: artifacts.screenshots ? 'on' : 'off',
    video: artifacts.videos ? 'on' : 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
