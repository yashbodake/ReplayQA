#!/usr/bin/env node
import { loadEnv } from '../discovery/cli/env.js';
loadEnv();

import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import { runDiscovery } from '../discovery/core/discover.js';
import { loadObservations, reason } from '../discovery/reasoning-lab/index.js';
import { loadPlannerInput, generatePlan, renderMarkdown } from '../discovery/qa-planning-lab/index.js';
import { generateTest } from '../discovery/run/generate.js';
import { generateUntilPass } from '../discovery/run/reliability/index.js';
import { pickTopScenario } from '../discovery/run/summary.js';
import { recordWalkthrough } from './walkthrough.js';
import { narrate } from '../narration/narrate.js';
import { TimelineRecorder } from '../narration/timeline/index.js';
import { LoginFailedError, reportLoginFailure } from '../discovery/login/index.js';
import { getStyle, listStyles } from '../narration/audio/style.js';
import type { NarrationStyle } from '../narration/audio/style.js';
import type { MusicConfig } from '../narration/audio/music.js';
import { BackgroundMusicManager, loadMusicConfig } from '../narration/audio/music.js';

function writeJSON(dir: string, name: string, value: unknown): void {
  writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', 'utf-8');
}
function writeRaw(dir: string, name: string, value: string): void {
  writeFileSync(resolve(dir, name), value, 'utf-8');
}

/**
 * `npm run demo` — the full cinematic demo pipeline (v0.9.1).
 *
 *   discover → reason → plan → generate → execute(test)
 *           → walkthrough (login + exercise every feature ON CAMERA)
 *           → app-narrate + render (no-loop) → embed in HTML
 *
 * The result is a genuine product-demo video, not a looped test clip. This is a
 * separate command from `npm run replayqa` so the existing pipeline is untouched.
 *
 * Usage:
 *   npm run demo -- <url> --username <u> --password <p>
 */
main().catch((error) => {
  if (error instanceof LoginFailedError) { reportLoginFailure(error); process.exit(3); }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('Usage: npm run demo -- <url> [--username <u> --password <p>] [--headed]');
    process.exit(2);
  }
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) { console.error('CEREBRAS_API_KEY is not set.'); process.exit(2); }

  const artifactsDir = resolve(process.cwd(), 'artifacts/discovery');
  const walkthroughDir = resolve(process.cwd(), 'artifacts/walkthrough');
  const reportDir = resolve(process.cwd(), 'reports');
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(walkthroughDir, { recursive: true });
  const stage = (name: string) => console.log(`\n✓ ${name}`);

  const recorder = new TimelineRecorder({
    runId: `demo-${Date.now()}`,
    file: resolve(artifactsDir, 'narration', 'timeline.json'),
  });
  recorder.record('run-started', { url: args.url, mode: 'demo' }, 'high');

  try {
    // 1 ── Discovery
    stage('Discovering application');
    recorder.record('discovery-started', { url: args.url }, 'high');
    const discovery = await runDiscovery(args.url, {
      credentials: args.username && args.password ? { username: args.username, password: args.password } : undefined,
      outputDir: artifactsDir,
      headed: args.headed,
      onEvent: (type, metadata) => recorder.record(type, metadata ?? {}, 'medium'),
    });
    writeJSON(artifactsDir, 'discovery.json', discovery);

    // 2 ── Reasoning
    stage('Understanding application');
    const observations = await loadObservations(artifactsDir);
    const reasoningOutcome = await reason(observations, { apiKey });
    writeJSON(artifactsDir, 'reasoning.json', reasoningOutcome.result);
    writeRaw(artifactsDir, 'reasoning.raw.txt', reasoningOutcome.raw);
    recorder.record('reasoning-completed', { applicationType: reasoningOutcome.result.applicationType, confidence: reasoningOutcome.result.confidence }, 'high');

    // 3 ── QA Plan
    stage('Generating QA plan');
    const planInput = await loadPlannerInput(artifactsDir);
    const planOutcome = await generatePlan(planInput, { apiKey });
    writeJSON(artifactsDir, 'test-plan.json', planOutcome.plan);
    writeRaw(artifactsDir, 'test-plan.md', renderMarkdown(planOutcome.plan));
    recorder.record('qa-plan-generated', { scenarioCount: planOutcome.plan.functionalScenarios.length }, 'high');

    const scenario = pickTopScenario(planOutcome.plan);
    if (!scenario) { console.log('No testable scenario — aborting.'); process.exit(0); }

    // 4 ── Generate + execute the test (validates the app works)
    stage('Generating Playwright test');
    recorder.record('generation-started', { scenarioTitle: scenario.title }, 'high');
    const generated = await generateTest(args.url, observations, reasoningOutcome.result, scenario, { apiKey, credentials: args.username && args.password ? { username: args.username, password: args.password } : undefined });
    const testFile = resolve(process.cwd(), 'tests/replayqa-generated.spec.ts');
    stage('Executing test');
    const reliability = await generateUntilPass({
      initialCode: generated.code,
      scenario,
      observations,
      options: { apiKey, maxRepairAttempts: 3, testFile, headed: args.headed, credentials: args.username && args.password ? { username: args.username, password: args.password } : undefined },
    });
    recorder.record(reliability.passed ? 'execution-passed' : 'execution-failed', { firstPassSuccess: reliability.firstPassSuccess }, 'high');
    console.log(`\n  test ${reliability.passed ? '✓ passed' : '✗ failed'}`);

    // 5 ── WALKTHROUGH — login + exercise every feature on camera (the key step)
    stage('Recording interactive walkthrough');
    recorder.record('walkthrough-started', {}, 'high');
    const walkthrough = await recordWalkthrough({
      targetUrl: args.url,
      credentials: args.username && args.password ? { username: args.username, password: args.password } : undefined,
      outputDir: walkthroughDir,
      artifactsDir,
      headed: args.headed,
    });
    recorder.record('walkthrough-finished', { ok: walkthrough.ok, steps: walkthrough.performedSteps }, 'high');
    if (!walkthrough.ok || !walkthrough.videoPath) {
      console.log(`\n· Walkthrough did not produce a video: ${walkthrough.error ?? 'unknown'}.\n  Falling back to narrating the test clip.`);
    } else {
      console.log(`\n  walkthrough: ${walkthrough.performedSteps}/${walkthrough.totalSteps} steps performed, ${walkthrough.chapters.length} chapters, authenticated=${walkthrough.authenticated}`);
    }

    // 6 ── Narrate + render. Demo mode if we have a walkthrough video; else fall back.
    //    First, let the user pick narration style, voice, and background music.
    const audioPrefs = args.yes ? { style: getStyle(), music: loadMusicConfig() } : await promptAudioPreferences();

    stage('Generating cinematic narration');
    const narration = await narrate({
      apiKey,
      artifactsDir,
      reportDir,
      narrationStyle: audioPrefs.style,
      music: audioPrefs.music,
      ...(walkthrough.ok && walkthrough.videoPath
        ? { walkthrough: { videoPath: walkthrough.videoPath, chapters: walkthrough.chapters } }
        : {}),
    });

    recorder.record('run-finished', { passed: reliability.passed, summaryProduced: narration.ok }, 'high');

    if (narration.ok) {
      console.log(`\n✓ Demo summary: ${narration.summaryPath}` +
        (narration.durationMs ? ` (${(narration.durationMs / 1000).toFixed(1)}s)` : ''));
      console.log(`  chapters: ${narration.chapters.length}  tts: ${narration.provider}  policy: ${narration.policy}`);
    } else {
      console.log(`\n✗ Narration failed: ${narration.error}`);
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof LoginFailedError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ Demo pipeline failed: ${msg}`);
    process.exit(1);
  }
}

function parseArgs(argv: string[]): { url?: string; username?: string; password?: string; headed?: boolean; yes?: boolean } {
  const out: { url?: string; username?: string; password?: string; headed?: boolean; yes?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--username' || a === '-u') out.username = argv[++i];
    else if (a === '--password' || a === '-p') out.password = argv[++i];
    else if (a === '--headed') out.headed = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (!a.startsWith('-') && !out.url) out.url = a;
  }
  return out;
}

// ── Interactive audio preferences ───────────────────────────────────────────

const KOKORO_VOICES = [
  { id: 'af_sarah', label: 'Sarah — clear, neutral, professional (recommended)' },
  { id: 'af_heart', label: 'Heart — warm, expressive' },
  { id: 'af_bella', label: 'Bella — bright, friendly' },
  { id: 'af_nova', label: 'Nova — energetic, crisp' },
  { id: 'am_michael', label: 'Michael — deep, authoritative' },
  { id: 'am_eric', label: 'Eric — fast, neutral' },
];

/**
 * Interactive prompt for narration style, voice, and background music.
 * Lets the user choose before the video is generated. Skippable with --yes.
 */
async function promptAudioPreferences(): Promise<{ style: NarrationStyle; music: Partial<MusicConfig> }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n─────────────────────────────────────────────');
    console.log('  🎙️  Narration Audio Setup');
    console.log('─────────────────────────────────────────────');

    // 1. Narration style
    const styles = listStyles();
    console.log('\n1. Choose a narration style:');
    styles.forEach((s, i) => {
      const style = getStyle(s);
      const tag = s === 'professional' ? ' (default)' : '';
      console.log(`   ${i + 1}. ${style.label}${tag} — ${style.description}`);
    });
    const styleAns = (await rl.question('\n   Style [1]: ')).trim();
    const styleIdx = Math.max(0, Math.min(styles.length - 1, parseInt(styleAns || '1', 10) - 1));
    const style = getStyle(styles[styleIdx]);
    console.log(`   → ${style.label}`);

    // 2. Voice
    console.log('\n2. Choose a voice:');
    KOKORO_VOICES.forEach((v, i) => console.log(`   ${i + 1}. ${v.label}`));
    const voiceAns = (await rl.question('\n   Voice [1]: ')).trim();
    const voiceIdx = Math.max(0, Math.min(KOKORO_VOICES.length - 1, parseInt(voiceAns || '1', 10) - 1));
    const voice = KOKORO_VOICES[voiceIdx].id;
    console.log(`   → ${KOKORO_VOICES[voiceIdx].label.split('—')[0].trim()}`);
    // Override the style's voice with the user's choice.
    process.env.KOKORO_VOICE = voice;
    process.env.NARRATION_VOICE = voice;

    // 3. Background music
    const musicMgr = new BackgroundMusicManager(loadMusicConfig());
    const tracks = musicMgr.listTracks();
    console.log('\n3. Background music?');
    console.log(`   1. No music (default)`);
    if (tracks.length > 0) {
      console.log(`   2. Yes — shuffle from ${tracks.length} track(s) in ${musicMgr.getConfig().musicDir}`);
    } else {
      console.log(`   2. Yes — (no tracks found in ${musicMgr.getConfig().musicDir}, will be silent)`);
    }
    console.log(`   3. Yes — specify a file path`);
    const musicAns = (await rl.question('\n   Music [1]: ')).trim();
    let music: Partial<MusicConfig> = { enabled: false };
    if (musicAns === '2') {
      music = { enabled: true };
      console.log(`   → Music enabled (shuffle)`);
    } else if (musicAns === '3') {
      const filePath = (await rl.question('   Path to music file: ')).trim();
      music = { enabled: true, filePath: filePath || undefined };
      console.log(`   → Music: ${filePath || '(invalid, will be silent)'}`);
    } else {
      console.log(`   → No music`);
    }

    console.log('─────────────────────────────────────────────\n');
    return { style, music };
  } finally {
    rl.close();
  }
}
