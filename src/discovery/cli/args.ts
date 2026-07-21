import type { DiscoveryCredentials } from '../../config/types.js';

export interface ParsedArgs {
  headed: boolean;
  yes: boolean;
  positionalUrl?: string;
  username?: string;
  password?: string;
}

const BOOLEAN_FLAGS = new Set(['--headed', '--watch', '--yes']);
const VALUE_FLAGS = new Set(['--username', '--password']);

/** Flag-aware parser. Distinguishes `--username admin` values from positionals. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOLEAN_FLAGS.has(a)) {
      flags[a] = true;
      continue;
    }
    if (a.startsWith('--')) {
      if (a.includes('=')) {
        const eq = a.indexOf('=');
        flags[a.slice(0, eq)] = a.slice(eq + 1);
        continue;
      }
      if (VALUE_FLAGS.has(a)) {
        flags[a] = argv[++i];
        continue;
      }
      flags[a] = true;
      continue;
    }
    positionals.push(a);
  }

  return {
    headed: Boolean(flags['--headed']) || Boolean(flags['--watch']),
    yes: Boolean(flags['--yes']),
    positionalUrl: positionals[0],
    username: stringFlag(flags['--username']),
    password: stringFlag(flags['--password']),
  };
}

function stringFlag(v: string | true | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Prepend https:// if no scheme is present. Passes file:// through untouched. */
export function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^file:\/\//i.test(value)) return value;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * Resolve credentials with ${ENV_VAR} interpolation so secrets are never
 * committed to replayqa.config.json. Returns undefined if either field is
 * missing/empty (in which case discovery runs unauthenticated).
 *
 * NOTE: prefer {@link resolveCredentialsLayered} for CLI/env/config precedence.
 */
export function resolveCredentials(
  raw: { username: string; password: string } | undefined
): DiscoveryCredentials | undefined {
  if (!raw) return undefined;
  const username = interpolate(raw.username);
  const password = interpolate(raw.password);
  if (!username || !password) return undefined;
  return { username, password };
}

/**
 * Layered credential resolution. Precedence (highest first):
 *   1. CLI flags  (--username / --password)
 *   2. Environment (REPLAYQA_DISCOVERY_USERNAME / REPLAYQA_DISCOVERY_PASSWORD)
 *   3. Config     (discovery.credentials, with ${ENV} interpolation)
 *
 * Credentials are returned only to be handed to the login flow — they are
 * never persisted, logged, or written to any artifact.
 */
export function resolveCredentialsLayered(args: {
  configCreds?: { username: string; password: string };
  cliUsername?: string;
  cliPassword?: string;
}): DiscoveryCredentials | undefined {
  const configResolved = args.configCreds
    ? { username: interpolate(args.configCreds.username), password: interpolate(args.configCreds.password) }
    : undefined;

  const username = firstDefined(
    args.cliUsername,
    process.env.REPLAYQA_DISCOVERY_USERNAME,
    configResolved?.username
  );
  const password = firstDefined(
    args.cliPassword,
    process.env.REPLAYQA_DISCOVERY_PASSWORD,
    configResolved?.password
  );
  if (!username || !password) return undefined;
  return { username, password };
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v && v.length > 0) return v;
  }
  return undefined;
}

export function interpolate(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) =>
    process.env[name] ? process.env[name]! : ''
  );
}
