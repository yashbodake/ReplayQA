import { Page, Request, Response } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NetworkLogEntry } from './types';

export interface NetworkCollector {
  dispose: () => Promise<void>;
}

export function attachNetworkCollector(
  page: Page,
  outputFilePath: string
): NetworkCollector {
  const pending = new Map<string, NetworkLogEntry>();
  const completed: NetworkLogEntry[] = [];

  const onRequest = (request: Request) => {
    const entry: NetworkLogEntry = {
      request: {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timestamp: new Date().toISOString(),
      },
    };

    pending.set(request.url(), entry);
  };

  const onResponse = async (response: Response) => {
    const request = response.request();
    const url = request.url();
    const entry = pending.get(url);

    pending.delete(url);

    if (!entry) {
      return;
    }

    entry.response = {
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      headers: response.headers(),
      timestamp: new Date().toISOString(),
    };

    completed.push(entry);
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  return {
    dispose: async () => {
      page.off('request', onRequest);
      page.off('response', onResponse);

      const allEntries = [...completed, ...pending.values()];
      pending.clear();

      if (allEntries.length === 0) {
        return;
      }

      await mkdir(dirname(outputFilePath), { recursive: true });
      await writeFile(outputFilePath, JSON.stringify(allEntries, null, 2));
    },
  };
}
