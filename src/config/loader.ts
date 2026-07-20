import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultConfig } from './default';
import { ReplayQAConfig } from './types';

export const CONFIG_FILE_NAMES = [
  'replayqa.config.json',
  'replayqa.config.js',
  'replayqa.config.ts',
  'replayqa.config.mjs',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: unknown
): T {
  if (!isObject(source)) {
    return target;
  }

  const result = { ...target } as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (isObject(sourceValue) && isObject(targetValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }

  return result as T;
}

export async function loadConfigFile(
  filePath: string
): Promise<ReplayQAConfig> {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  let loaded: unknown;

  if (absolutePath.endsWith('.json')) {
    const raw = await readFile(absolutePath, 'utf-8');
    loaded = JSON.parse(raw) as unknown;
  } else {
    try {
      const module = await import(absolutePath);
      loaded = (module.default ?? module) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load config file ${absolutePath}: ${message}. ` +
          'TypeScript configs require a Node loader such as tsx or ts-node.'
      );
    }
  }

  return deepMerge(
    defaultConfig as unknown as Record<string, unknown>,
    loaded
  ) as unknown as ReplayQAConfig;
}

export async function findConfig(
  cwd: string = process.cwd()
): Promise<ReplayQAConfig> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = resolve(cwd, fileName);
    if (existsSync(filePath)) {
      return loadConfigFile(filePath);
    }
  }

  return defaultConfig;
}

export function loadConfigFileSync(filePath: string): ReplayQAConfig {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  if (!absolutePath.endsWith('.json')) {
    throw new Error(
      `Synchronous config loading only supports JSON files. Received: ${absolutePath}`
    );
  }

  const raw = readFileSync(absolutePath, 'utf-8');
  const loaded = JSON.parse(raw) as unknown;

  return deepMerge(
    defaultConfig as unknown as Record<string, unknown>,
    loaded
  ) as unknown as ReplayQAConfig;
}

export function findConfigSync(
  cwd: string = process.cwd()
): ReplayQAConfig {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = resolve(cwd, fileName);
    if (existsSync(filePath) && filePath.endsWith('.json')) {
      return loadConfigFileSync(filePath);
    }
  }

  return defaultConfig;
}

export function loadConfigSync(): ReplayQAConfig {
  return defaultConfig;
}

export { defaultConfig };
export type { ReplayQAConfig };
export * from './types';
