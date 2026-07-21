#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { findConfigSync } from '../../config/index.js';
import { runDiscovery } from '../core/discover.js';
import { consoleLogger } from '../core/logger.js';
import { LoginFailedError, reportLoginFailure } from '../login/index.js';
import { normalizeUrl, parseArgs, resolveCredentialsLayered } from './args.js';

main().catch((error) => {
  if (error instanceof LoginFailedError) {
    reportLoginFailure(error);
    process.exit(3);
  }
  consoleLogger.error('\nDiscovery failed:');
  consoleLogger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const { headed, positionalUrl, username, password } = parseArgs(process.argv.slice(2));

  const config = findConfigSync();
  const targetUrl = normalizeUrl(positionalUrl || config.discovery?.targetUrl);
  if (!targetUrl) {
    consoleLogger.error('Usage: replayqa discover <url> [--username U --password P]');
    consoleLogger.error(
      '  pass a URL as the first argument, or set discovery.targetUrl in replayqa.config.json'
    );
    process.exit(2);
  }

  const credentials = resolveCredentialsLayered({
    configCreds: config.discovery?.credentials,
    cliUsername: username,
    cliPassword: password,
  });
  const outputDir = resolve(config.outputDir, 'discovery');

  section('ReplayQA Discovery');

  const result = await runDiscovery(targetUrl, {
    headed,
    credentials,
    outputDir,
    onPhase: (phase) => {
      if (phase === 'opening') section('Opening browser...');
      else if (phase === 'login-start') section('Logging in...');
      else if (phase === 'discovering') section('Discovering pages...');
    },
  });

  const outFile = resolve(outputDir, 'discovery.json');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');

  console.log('Found:');
  console.log('');
  for (const page of result.pages) {
    console.log(`✓ ${page.title}`);
    console.log('');
  }

  console.log('Discovery Complete');
  console.log('');
  console.log(`Pages: ${result.pages.length}`);
  console.log('');
  console.log('Saved:');
  console.log('');
  console.log(relative(process.cwd(), outFile));
}

function section(message: string): void {
  console.log(message);
  console.log('');
}
