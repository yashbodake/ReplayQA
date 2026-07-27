import { defineConfig, devices } from '@playwright/test';
import { findConfigSync } from './src/config/index.js';

const replayQAConfig = findConfigSync();
const { artifacts } = replayQAConfig;

/**
 * ReplayQA run mode (v0.9).
 *
 *   demo — deliberate, cinematic pacing for narrated summary videos
 *           (slowMo: 150ms between actions so the recording reads well).
 *   test — fast, no artificial delay (preserves the pre-v0.9 behaviour for
 *           `npm test` / CI).
 *
 * slowMo is retained and configurable, never deleted. Default is `demo` so the
 * full pipeline (`npm run replayqa`) produces presentation-quality recordings;
 * set REPLAYQA_MODE=test for plain test runs.
 */
const mode = process.env.REPLAYQA_MODE ?? 'demo';
const slowMo = mode === 'test' ? 0 : Number(process.env.REPLAYQA_SLOWMO ?? '150');

export default defineConfig({
  testDir: replayQAConfig.playwright.testDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : replayQAConfig.playwright.retries,
  timeout: 60000,
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
    // Real FHD source for presentation-quality recordings (v0.9). Previously
    // unset, which left Playwright at its 1280×720 default.
    viewport: { width: 1920, height: 1080 },
    trace: artifacts.traces ? 'on' : 'off',
    screenshot: artifacts.screenshots ? 'on' : 'off',
    video: artifacts.videos ? 'on' : 'off',
    recordVideo: { size: { width: 1920, height: 1080 } },
    launchOptions: { slowMo },
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      // Spread the Desktop Chrome device preset but OVERRIDE its viewport +
      // recordVideo size so recordings are true 1920×1080 (v0.9). The device
      // preset's viewport (1280×720) would otherwise win at the project level.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        recordVideo: { size: { width: 1920, height: 1080 } },
      },
    },
  ],
});
