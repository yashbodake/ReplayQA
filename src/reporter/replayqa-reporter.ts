import { Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { findConfigSync } from '../config/index.js';
import { relativePath, sanitizeFileName } from '../utils/path-utils.js';
import { generateHtmlReport } from './html-generator.js';
import { ArtifactEntry, ReportData, TestReportEntry } from './types';

function getTestTitlePath(test: TestCase): string[] {
  const path: string[] = [];
  let suite: Suite | undefined = test.parent;

  while (suite && suite.type !== 'project' && suite.type !== 'root') {
    path.unshift(suite.title);
    suite = suite.parent;
  }

  path.push(test.title);
  return path;
}

export default class ReplayQAReporter implements Reporter {
  private tests: TestReportEntry[] = [];
  private reportDir: string;
  private outputDir: string;

  constructor() {
    const config = findConfigSync();
    this.outputDir = resolve(config.outputDir);
    this.reportDir = resolve('reports');
  }

  printsToStdio(): boolean {
    return false;
  }

  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    const projectName = test.parent.project()?.name ?? 'unknown';
    const titlePath = getTestTitlePath(test);
    const testSlug = sanitizeFileName(titlePath.join(' '));

    const artifacts: ArtifactEntry[] = [
      ...this.mapAttachments(result),
      ...(await this.mapLogFiles(projectName, testSlug)),
    ];

    this.tests.push({
      title: titlePath.join(' › '),
      project: projectName,
      status: result.status,
      duration: result.duration,
      artifacts,
    });
  }

  async onEnd(): Promise<void> {
    const passed = this.tests.filter((t) => t.status === 'passed').length;
    const failed = this.tests.filter(
      (t) =>
        t.status === 'failed' ||
        t.status === 'timedOut' ||
        t.status === 'interrupted'
    ).length;
    const skipped = this.tests.filter((t) => t.status === 'skipped').length;
    const other = this.tests.length - passed - failed - skipped;

    const report: ReportData = {
      generatedAt: new Date().toISOString(),
      summary: {
        total: this.tests.length,
        passed,
        failed,
        skipped,
        other,
      },
      tests: this.tests,
    };

    const html = generateHtmlReport(report);
    const reportPath = resolve(this.reportDir, 'index.html');

    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, html, 'utf-8');
  }

  private mapAttachments(result: TestResult): ArtifactEntry[] {
    const artifacts: ArtifactEntry[] = [];
    const reportDir = this.reportDir;

    for (const attachment of result.attachments) {
      if (!attachment.path) {
        continue;
      }

      const relPath = relativePath(reportDir, attachment.path);

      if (attachment.contentType === 'video/webm') {
        artifacts.push({
          type: 'video',
          name: 'video.webm',
          path: relPath,
        });
      } else if (attachment.contentType === 'image/png') {
        artifacts.push({
          type: 'screenshot',
          name: attachment.name.endsWith('.png')
            ? attachment.name
            : `${attachment.name}.png`,
          path: relPath,
        });
      } else if (attachment.contentType === 'application/zip') {
        artifacts.push({
          type: 'trace',
          name: 'trace.zip',
          path: relPath,
        });
      }
    }

    return artifacts;
  }

  private async mapLogFiles(
    projectName: string,
    testSlug: string
  ): Promise<ArtifactEntry[]> {
    const artifacts: ArtifactEntry[] = [];
    const logDir = resolve(this.outputDir, 'logs', projectName, testSlug);
    const reportDir = this.reportDir;

    const consolePath = resolve(logDir, 'console.json');
    if (existsSync(consolePath)) {
      let content: unknown = null;
      try {
        const raw = await readFile(consolePath, 'utf-8');
        content = JSON.parse(raw);
      } catch {
        // leave content null
      }
      artifacts.push({
        type: 'console',
        name: 'console.json',
        path: relativePath(reportDir, consolePath),
        content,
      });
    }

    const networkPath = resolve(logDir, 'network.json');
    if (existsSync(networkPath)) {
      let content: unknown = null;
      try {
        const raw = await readFile(networkPath, 'utf-8');
        content = JSON.parse(raw);
      } catch {
        // leave content null
      }
      artifacts.push({
        type: 'network',
        name: 'network.json',
        path: relativePath(reportDir, networkPath),
        content,
      });
    }

    return artifacts;
  }
}
