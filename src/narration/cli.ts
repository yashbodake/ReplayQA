#!/usr/bin/env node
import { loadEnv } from '../discovery/cli/env.js';
loadEnv(); // Load .env before anything else (matches the other CLIs).

import { resolve } from 'node:path';
import { narrate } from './narrate.js';

/**
 * `npm run narrate` — produce ReplayQA-Summary.mp4 from a completed run.
 *
 * Usage:
 *   npm run narrate                                  # defaults: ./artifacts/discovery, ./reports
 *   npm run narrate -- --artifacts ./artifacts/discovery --reports ./reports
 *   npm run narrate -- --video ./path/to/video.webm  # override the discovered video
 */
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const artifactsDir = resolve(args.artifacts ?? './artifacts/discovery');
  const reportDir = resolve(args.reports ?? './reports');

  console.log('ReplayQA Narration Engine');
  console.log(`  artifacts: ${artifactsDir}`);
  console.log(`  reports:   ${reportDir}`);

  const result = await narrate({
    apiKey: process.env.CEREBRAS_API_KEY,
    artifactsDir,
    reportDir,
    videoPath: args.video ? resolve(args.video) : undefined,
  });

  if (!result.ok) {
    console.error(`\n✗ Narration did not complete: ${result.error ?? 'unknown error'}`);
    process.exit(1);
  }

  console.log(`\n✓ Narration summary: ${result.summaryPath}`);
  console.log(`  duration: ${result.durationMs ? (result.durationMs / 1000).toFixed(1) + 's' : 'unknown'}`);
  console.log(`  chapters: ${result.chapters.length}`);
  console.log(`  tts:      ${result.provider}`);
  console.log(`  script:   ${result.source === 'llm' ? 'LLM-generated' : 'deterministic fallback'}`);
}

function parseArgs(argv: string[]): { artifacts?: string; reports?: string; video?: string } {
  const out: { artifacts?: string; reports?: string; video?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--artifacts' || a === '-a') out.artifacts = argv[++i];
    else if (a === '--reports' || a === '-r') out.reports = argv[++i];
    else if (a === '--video' || a === '-v') out.video = argv[++i];
  }
  return out;
}
