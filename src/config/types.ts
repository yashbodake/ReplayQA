export interface ReplayQAConfig {
  outputDir: string;
  artifacts: {
    videos: boolean;
    screenshots: boolean;
    traces: boolean;
    consoleLogs: boolean;
    networkLogs: boolean;
  };
  playwright: {
    testDir: string;
    retries: number;
    workers: number | 'auto';
  };
}
