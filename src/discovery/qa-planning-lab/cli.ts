#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPlannerInput } from './collect.js';
import { generatePlan } from './llm.js';
import { renderMarkdown } from './markdown.js';

/**
 * QA Planning Engine entry point.
 *
 *   npm run plan [artifactsDir]
 *
 * Reads ReplayQA artifacts (observations + reasoning.json), asks an LLM to act
 * as a Senior QA Lead, and writes both a structured plan and a review-ready
 * Markdown document:
 *
 *   <artifactsDir>/test-plan.json
 *   <artifactsDir>/test-plan.md
 *
 * The API key is read from the environment (CEREBRAS_API_KEY) and never
 * persisted. Override the endpoint/model with REASONING_BASE_URL /
 * REASONING_MODEL.
 */
main().catch((error) => {
  console.error('\nQA planning failed:');
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

  console.log('Loading ReplayQA observations + reasoning...');
  const input = await loadPlannerInput(artifactsDir);
  console.log(
    `  pages: ${input.observations.discoveredPages.length} · ` +
      `states: ${input.observations.exploredStates.length} · ` +
      `findings: ${input.observations.findings.length} · ` +
      `reasoning: ${input.reasoning ? 'present' : 'absent'}`
  );

  if (input.observations.discoveredPages.length === 0) {
    console.error('No discovered pages found. Run `npm run discover -- <url>` first.');
    process.exit(2);
  }

  console.log(`Planning with ${model} (Senior QA Lead)...`);
  const outcome = await generatePlan(input, { apiKey });

  mkdirSync(artifactsDir, { recursive: true });
  const jsonFile = resolve(artifactsDir, 'test-plan.json');
  const mdFile = resolve(artifactsDir, 'test-plan.md');
  const rawFile = resolve(artifactsDir, 'test-plan.raw.txt');
  writeFileSync(jsonFile, `${JSON.stringify(outcome.plan, null, 2)}\n`, 'utf-8');
  writeFileSync(mdFile, renderMarkdown(outcome.plan), 'utf-8');
  writeFileSync(rawFile, outcome.raw, 'utf-8');

  console.log('\nTest plan written:');
  console.log(`  ${jsonFile}`);
  console.log(`  ${mdFile}`);
  console.log('');
  console.log(`applicationType:     ${outcome.plan.applicationSummary.applicationType}`);
  console.log(`journeys:            ${outcome.plan.criticalUserJourneys.length}`);
  console.log(`scenarios:           ${outcome.plan.functionalScenarios.length}`);
  console.log(`edge-case groups:    ${outcome.plan.edgeCases.length}`);
  console.log(`confidence:          ${outcome.plan.confidence}`);
  console.log(`blind spots:         ${outcome.plan.missingInformation.length}`);
}
