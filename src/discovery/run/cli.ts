#!/usr/bin/env node
import { parseArgs, resolveCredentialsLayered, normalizeUrl } from '../cli/args.js';
import { findConfigSync } from '../../config/index.js';
import { LoginFailedError, reportLoginFailure } from '../login/index.js';
import { runReplayQA } from './orchestrator.js';

/**
 * ReplayQA MVP — one command for the complete workflow:
 *
 *   npm run replayqa -- <url>                            # interactive
 *   npm run replayqa -- <url> --yes                      # auto-approve
 *   npm run replayqa -- <url> --username U --password P  # authenticate
 *   npm run replayqa -- <url> --headed                   # watch the browser
 *
 * Pipeline: discover → reason → plan → review → generate ONE test → execute → report.
 * The API key is read from CEREBRAS_API_KEY; credentials are never persisted.
 */
main().catch((error) => {
  if (error instanceof LoginFailedError) {
    reportLoginFailure(error);
    process.exit(3);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    console.error('CEREBRAS_API_KEY is not set.');
    console.error('  export CEREBRAS_API_KEY=...   (or your OpenAI-compatible key)');
    process.exit(2);
  }

  const { headed, yes, positionalUrl, username, password } = parseArgs(process.argv.slice(2));
  const config = findConfigSync();

  const targetUrl = normalizeUrl(positionalUrl || config.discovery?.targetUrl);
  if (!targetUrl) {
    console.error('Usage: npm run replayqa -- <url> [--username U --password P] [--yes]');
    process.exit(2);
  }

  const credentials = resolveCredentialsLayered({
    configCreds: config.discovery?.credentials,
    cliUsername: username,
    cliPassword: password,
  });

  const result = await runReplayQA(targetUrl, { apiKey, headed, credentials, yes });
  process.exit(result.ok ? (result.testPassed === false ? 1 : 0) : 1);
}
