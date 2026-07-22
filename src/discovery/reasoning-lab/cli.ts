#!/usr/bin/env node
import { loadEnv } from "../cli/env.js"; loadEnv();
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadObservations } from './collect.js';
import { reason } from './llm.js';

/**
 * AI Reasoning PoC entry point.
 *
 *   npm run reason
 *
 * Reads ReplayQA's discovery artifacts, sends them as structured JSON to an
 * OpenAI-compatible LLM (Cerebras / gpt-oss-120b by default), and writes the
 * model's understanding of the application to:
 *
 *   artifacts/discovery/reasoning.json        (parsed result)
 *   artifacts/discovery/reasoning.raw.txt     (raw model output, for audit)
 *
 * The API key is read from the environment (CEREBRAS_API_KEY) and is never
 * written to disk. Override the endpoint/model with REASONING_BASE_URL and
 * REASONING_MODEL (e.g. for Olama Cloud).
 */
main().catch((error) => {
  console.error('\nReasoning failed:');
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

  const artifactsDir = resolve(process.cwd(), process.argv[2] ?? 'artifacts/discovery');
  const model = process.env.REASONING_MODEL ?? 'gpt-oss-120b';

  console.log('Loading ReplayQA observations...');
  const observations = await loadObservations(artifactsDir);
  console.log(
    `  pages: ${observations.discoveredPages.length} · ` +
      `states: ${observations.exploredStates.length} · ` +
      `findings: ${observations.findings.length}`
  );

  if (observations.discoveredPages.length === 0) {
    console.error('No discovered pages found. Run `npm run discover -- <url>` first.');
    process.exit(2);
  }

  console.log(`Reasoning with ${model}...`);
  const outcome = await reason(observations, { apiKey });

  mkdirSync(artifactsDir, { recursive: true });
  const outFile = resolve(artifactsDir, 'reasoning.json');
  const rawFile = resolve(artifactsDir, 'reasoning.raw.txt');
  writeFileSync(outFile, `${JSON.stringify(outcome.result, null, 2)}\n`, 'utf-8');
  writeFileSync(rawFile, outcome.raw, 'utf-8');

  console.log('\nReasoning written:');
  console.log(`  ${outFile}`);
  console.log(`  ${rawFile}`);
  console.log('');
  console.log(`applicationType:     ${outcome.result.applicationType}`);
  console.log(`entities:            ${outcome.result.entities.join(', ') || '(none)'}`);
  console.log(`capabilities:        ${outcome.result.capabilities.join(', ') || '(none)'}`);
  console.log(`confidence:          ${outcome.result.confidence}`);
  console.log(`flows:`);
  for (const flow of outcome.result.flows) console.log(`  - ${flow}`);
  console.log(`missingInformation:`);
  for (const m of outcome.result.missingInformation) console.log(`  - ${m}`);
}
