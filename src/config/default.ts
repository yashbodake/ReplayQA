import { ReplayQAConfig } from './types';

export const defaultConfig: ReplayQAConfig = {
  outputDir: './artifacts',
  artifacts: {
    videos: false,
    screenshots: false,
    traces: false,
    consoleLogs: false,
    networkLogs: false,
  },
  playwright: {
    testDir: './tests',
    retries: 0,
    workers: 'auto',
  },
};
