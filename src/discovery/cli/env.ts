import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tiny .env loader — reads KEY=VALUE pairs from `.env` in the project root
 * and sets them on process.env (without overriding values already set in the
 * real environment). Zero dependencies. Runs once at CLI startup.
 *
 * This lets you persist CEREBRAS_API_KEY (and REPLAYQA_DISCOVERY_USERNAME /
 * _PASSWORD) in `.env` instead of exporting them every terminal session.
 * `.env` is gitignored — never committed.
 */
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't override real env vars
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
