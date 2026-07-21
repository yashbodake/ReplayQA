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
  /**
   * Optional Discovery Engine configuration (PoC).
   * Additive: its absence changes nothing about existing ReplayQA behavior.
   * Credentials support `${ENV_VAR}` interpolation so secrets stay out of config files.
   */
  discovery?: DiscoveryAppConfig;
}

export interface DiscoveryCredentials {
  username: string;
  password: string;
}

export interface DiscoveryAppConfig {
  targetUrl?: string;
  credentials?: DiscoveryCredentials;
}
