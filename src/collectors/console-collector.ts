import { ConsoleMessage, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConsoleLogEntry } from './types';

export interface ConsoleCollector {
  dispose: () => Promise<void>;
}

export function attachConsoleCollector(
  page: Page,
  outputFilePath: string
): ConsoleCollector {
  const logs: ConsoleLogEntry[] = [];

  const handler = (msg: ConsoleMessage) => {
    const location = msg.location();

    logs.push({
      type: msg.type(),
      text: msg.text(),
      location: {
        url: location.url ?? '',
        lineNumber: location.lineNumber ?? 0,
        columnNumber: location.columnNumber ?? 0,
      },
      timestamp: new Date().toISOString(),
    });
  };

  page.on('console', handler);

  return {
    dispose: async () => {
      page.off('console', handler);

      if (logs.length === 0) {
        return;
      }

      await mkdir(dirname(outputFilePath), { recursive: true });
      await writeFile(outputFilePath, JSON.stringify(logs, null, 2));
    },
  };
}
