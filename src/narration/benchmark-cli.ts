#!/usr/bin/env node
import { loadEnv } from '../discovery/cli/env.js';
loadEnv();

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runBenchmark, renderBenchmarkMarkdown } from './benchmark.js';
import { writeFileSync } from 'node:fs';

/**
 * `npm run narrate:benchmark` — compare v0.8 legacy vs v0.9 cinematic encoding.
 *
 * Auto-discovers the latest narration.mp3 and video.webm under ./artifacts and
 * renders two summary variants, then prints + persists a comparison table.
 */
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const artifactsDir = resolve('./artifacts');
  const audio = resolve(artifactsDir, 'discovery', 'narration', 'narration.mp3');
  const video = findRecursively(resolve(artifactsDir, 'test-output'), 'video.webm');
  const outDir = resolve(artifactsDir, 'discovery', 'narration', 'benchmark');

  if (!existsSync(audio)) {
    console.error(`narration audio not found: ${audio}\nRun "npm run narrate" first.`);
    process.exit(2);
  }
  if (!video) {
    console.error(`browser video not found under ${resolve(artifactsDir, 'test-output')}`);
    process.exit(2);
  }

  console.log('ReplayQA v0.9 Cinematic Benchmark');
  console.log(`  audio: ${audio}`);
  console.log(`  video: ${video}`);
  console.log(`  out:   ${outDir}`);

  const result = await runBenchmark({ audioPath: audio, videoPath: video, outDir });
  const md = renderBenchmarkMarkdown(result);
  writeFileSync(join(outDir, 'benchmark.md'), md + '\n', 'utf-8');
  console.log('\n' + md);
  console.log(`\n✓ Wrote ${join(outDir, 'benchmark.json')} and benchmark.md`);
}

function findRecursively(root: string, name: string): string | undefined {
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      const found = findRecursively(full, name);
      if (found) return found;
    } else if (entry === name) {
      return full;
    }
  }
  return undefined;
}
