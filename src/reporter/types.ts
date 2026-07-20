export interface ArtifactEntry {
  type: 'video' | 'screenshot' | 'trace' | 'console' | 'network';
  name: string;
  path: string;
}

export interface TestReportEntry {
  title: string;
  project: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  artifacts: ArtifactEntry[];
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  other: number;
}

export interface ReportData {
  generatedAt: string;
  summary: ReportSummary;
  tests: TestReportEntry[];
}
