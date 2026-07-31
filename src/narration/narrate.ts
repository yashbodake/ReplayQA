import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadNarrationContext } from './context.js';
import { planChapters } from './planner/index.js';
import { generateAppScript } from './app-script/index.js';
import { toSpeakableText } from './script/plain-text.js';
import { checkAccuracy, checkObservationGrounding, auditVisualMatch } from './audit/index.js';
import { getTTSProvider } from './tts/index.js';
import { defaultSummaryPath, renderSummary, loadRenderConfig, getRenderPolicy } from './render/index.js';
import { renderNarrationSection, injectNarrationIntoReport } from '../reporter/narration-section.js';
import type { NarrationLlmOptions } from './types.js';
import type { NarrationStyle } from './audio/style.js';
import type { MusicConfig, AudioTrack } from './audio/index.js';
import { getStyle } from './audio/style.js';
import { BackgroundMusicManager, loadMusicConfig, AudioMixer } from './audio/index.js';
import type { RenderPolicy } from './render/policy.js';
import type { TTSProvider } from './tts/provider.js';

export interface NarrateOptions {
  /** API key for the LLM (script generation). When absent, the deterministic fallback script is used. */
  apiKey?: string;
  /** OpenAI-compatible LLM config. */
  llm?: NarrationLlmOptions;
  /** Discovery artifacts root, e.g. ./artifacts/discovery. */
  artifactsDir: string;
  /** Where the HTML report + summary mp4 live, e.g. ./reports. */
  reportDir: string;
  /** Override the TTS provider (default: from env, or "edge"). */
  tts?: TTSProvider;
  /** Override the render policy (default: from env, or "default"). */
  policy?: RenderPolicy;
  /** Override the browser video path; otherwise discovered under artifactsDir/../test-output. */
  videoPath?: string;
  /**
   * DEMO MODE (v0.9.1): when set, narrate the APPLICATION over the interactive
   * walkthrough video (no looping), using the app-narrator + walkthrough policy.
   * `walkthroughChapters` drives both the script and the chapter list.
   */
  walkthrough?: {
    videoPath: string;
    chapters: import('../walkthrough/walkthrough.js').WalkthroughChapter[];
  };
  /** Override the narration style (default: from NARRATION_STYLE env). */
  narrationStyle?: NarrationStyle;
  /** Override background music config (default: from NARRATION_MUSIC env). */
  music?: Partial<MusicConfig>;
}

export interface NarrateResult {
  ok: boolean;
  error?: string;
  summaryPath: string;
  scriptPath: string;
  narrationPath: string;
  chapters: { index: number; title: string; start: number; duration: number }[];
  durationMs?: number;
  source: 'llm' | 'fallback';
  provider: string;
  policy: string;
}

/**
 * Run the full narration pipeline against a completed ReplayQA run.
 *
 * Order (each step persists its artifact before the next, mirroring the main
 * orchestrator's error policy):
 *   context → chapters → script → tts → render → html embed → meta.
 *
 * The whole stage is best-effort relative to the wider ReplayQA run: a failure
 * here never invalidates discovery/test artifacts produced earlier.
 */
export async function narrate(options: NarrateOptions): Promise<NarrateResult> {
  const artifactsDir = resolve(options.artifactsDir);
  const reportDir = resolve(options.reportDir);
  const narrationDir = resolve(artifactsDir, 'narration');
  mkdirSync(narrationDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  const baseResult: Omit<NarrateResult, 'ok' | 'error'> = {
    summaryPath: defaultSummaryPath(reportDir),
    scriptPath: resolve(narrationDir, 'script.md'),
    narrationPath: resolve(narrationDir, 'narration.mp3'),
    chapters: [],
    source: 'fallback',
    provider: '',
    policy: '',
  };

  try {
    // 1 ── Aggregate context (the sole script input — Refinement #3).
    const ctx = await loadNarrationContext(artifactsDir);

    // 2 ── Chapters + script. ALWAYS use the app-narrator (storytelling tone)
    //    for natural narration. If walkthrough chapters are available (demo
    //    mode), use those. Otherwise, build chapters from the timeline events
    //    via the planner. The old process-narrator is kept as a fallback when
    //    the LLM is unavailable.
    const demoMode = Boolean(options.walkthrough);
    let scriptMarkdown: string;
    let scriptSource: 'llm' | 'fallback';
    let scriptModel: string | undefined;
    let reportChapters: { index: number; title: string; start: number; duration: number }[];

    if (demoMode && options.walkthrough) {
      // Walkthrough chapters available — use them directly.
      const wtChapters = options.walkthrough.chapters;
      const appScript = await generateAppScript(ctx, wtChapters, {
        apiKey: options.apiKey,
        ...(options.llm ?? {}),
      });
      scriptMarkdown = appScript.markdown;
      scriptSource = appScript.source;
      scriptModel = appScript.model;
      reportChapters = wtChapters.map((c, i) => ({
        index: i,
        start: c.start,
        duration: Math.max(4, c.actions.length * 3),
        title: c.title || `Chapter ${i + 1}`,
      }));
      writeRaw(narrationDir, 'script.md', scriptMarkdown);
      writeJSON(narrationDir, 'narration.json', reportChapters);
    } else {
      // No walkthrough — build chapters from timeline + use app-narrator for
      // natural storytelling tone (not the old process-narrator).
      const chapters = planChapters(ctx);
      writeJSON(narrationDir, 'narration.json', chapters);

      // Convert planner chapters to the WalkthroughChapter shape the
      // app-narrator expects (it needs actions + verified observations).
      const appChapters = chapters.map((c) => ({
        index: c.index,
        title: c.title,
        start: c.start,
        actions: c.evidence.facts.actions
          ? (c.evidence.facts.actions as string[])
          : [c.evidence.summary],
        verified: [{
          action: c.evidence.summary,
          observations: c.evidence.summary ? [c.evidence.summary] : [],
          fillSucceeded: false,
        }],
      }));

      const appScript = await generateAppScript(ctx, appChapters, {
        apiKey: options.apiKey,
        ...(options.llm ?? {}),
      });
      scriptMarkdown = appScript.markdown;
      scriptSource = appScript.source;
      scriptModel = appScript.model;
      reportChapters = chapters.map((c) => ({ index: c.index, start: c.start, duration: c.duration, title: c.title }));
      writeRaw(narrationDir, 'script.md', scriptMarkdown);
    }
    baseResult.chapters = reportChapters;
    baseResult.source = scriptSource;
    void scriptModel; // surfaced via narration-meta below

    // 3 ── TTS (provider-agnostic). Pass the NarrationStyle so the provider can
    //    map pacing/register to its own voice/rate. Pass clean speakable text.
    const narrationStyle = options.narrationStyle ?? getStyle();
    const provider = options.tts ?? getTTSProvider({ cacheDir: resolve(narrationDir, '.cache') });
    baseResult.provider = provider.name;
    const speakable = toSpeakableText(scriptMarkdown);
    writeRaw(narrationDir, 'narration.txt', speakable); // audit/debug aid
    const ttsResult = await provider.synthesize(speakable, { style: narrationStyle });
    writeFileSync(baseResult.narrationPath, ttsResult.audio);

    // 3.5 ── Audio mixing (v1.0): combine narration + background music with
    //    automatic ducking. If music is disabled (default), this is a zero-cost
    //    no-op passthrough — the narration path is returned unchanged.
    const musicManager = new BackgroundMusicManager(
      options.music ? { ...loadMusicConfig(), ...options.music } : loadMusicConfig()
    );
    const mixer = new AudioMixer();
    const mixTracks: AudioTrack[] = [
      {
        path: baseResult.narrationPath,
        role: 'narration',
        volume: 1.0,
        loop: false,
        fadeInSec: 0,
        fadeOutSec: 0,
        duckUnder: [],
      },
    ];
    const musicTrack = musicManager.selectTrack();
    if (musicTrack) {
      const mc = musicManager.getConfig();
      mixTracks.push({
        path: musicTrack.path,
        role: 'music',
        volume: mc.volume,
        loop: true,
        fadeInSec: mc.fadeInSec,
        fadeOutSec: mc.fadeOutSec,
        duckUnder: ['narration'],
        duckingDb: mc.duckingDb,
      });
    }
    const mixResult = await mixer.mix({
      tracks: mixTracks,
      outputPath: resolve(narrationDir, 'narration-mixed.mp3'),
      durationMs: ttsResult.durationMs,
    });

    // 4 ── Render. DEMO mode uses the walkthrough video + walkthrough (no-loop)
    //    policy; otherwise the test-execution clip + the configured policy.
    const videoPath = demoMode
      ? options.walkthrough!.videoPath
      : options.videoPath ?? (await findVideo(artifactsDir));
    if (!videoPath || !existsSync(videoPath)) {
      throw new Error(
        demoMode
          ? 'Walkthrough video not found. Run the walkthrough recorder first.'
          : 'Browser execution video not found. Run the full pipeline first, or pass videoPath.'
      );
    }
    const policy = demoMode
      ? options.policy ?? getRenderPolicy('walkthrough')
      : options.policy;
    const render = await renderSummary(
      {
        videoPath,
        audioPath: mixResult.audioPath,
        outPath: baseResult.summaryPath,
        audioDurationMs: mixResult.durationMs,
        chapters: reportChapters,
      },
      { policy }
    );
    baseResult.durationMs = render.durationMs;
    baseResult.policy = render.policy;

    // 6 ── Embed into the HTML report (if it exists).
    const renderConfig = loadRenderConfig();
    const reportHtml = resolve(reportDir, 'index.html');
    if (existsSync(reportHtml)) {
      const section = renderNarrationSection({
        summarySrc: 'ReplayQA-Summary.mp4',
        chapters: reportChapters as unknown as import('./planner/types.js').NarrationChapter[],
        timeline: ctx.timeline,
        durationMs: render.durationMs,
        source: scriptSource,
        metadata: {
          provider: provider.name,
          voice: ttsResult.voice,
          policy: render.policy,
          resolution: `${renderConfig.resolution.width}x${renderConfig.resolution.height}`,
          fps: renderConfig.fps,
          source: scriptSource,
        },
      });
      injectNarrationIntoReport(reportHtml, section);
    }

    // 7 ── Accuracy check (milestone-compliant: text-vs-artifacts, no CV/OCR).
    //    Every spoken claim must reconcile with a value in the context's
    //    artifacts. In demo mode the chapters come from the walkthrough, so we
    //    adapt them to the checker's NarrationChapter shape (carrying the
    //    exercised actions as facts).
    const accuracyChapters: import('./planner/types.js').NarrationChapter[] = demoMode && options.walkthrough
      ? options.walkthrough.chapters.map((c, i) => ({
          index: i,
          title: c.title || `Chapter ${i + 1}`,
          start: c.start,
          duration: Math.max(4, c.actions.length * 3),
          evidence: { eventType: 'flow-discovered', facts: { actions: c.actions }, summary: `${c.actions.length} action(s) exercised` },
        }))
      : planChapters(ctx);
    const accuracy = checkAccuracy(scriptMarkdown, ctx, accuracyChapters);
    writeJSON(narrationDir, 'accuracy.json', accuracy);
    if (!accuracy.ok) {
      console.warn(
        `\n· Accuracy check flagged ${accuracy.ungrounded.length} ungrounded claim(s) — see artifacts/narration/accuracy.json`
      );
    } else {
      console.log(`\n· Accuracy check: all ${accuracy.totalClaims} claim(s) grounded in artifacts.`);
    }

    // P3: observation-grounding check (demo mode only). The numeric check above
    // is blind to qualitative prose, so for app-narration we additionally
    // verify the script doesn't assert forbidden bridged effects ("the item is
    // in the cart") without a supporting verified observation. This makes the
    // no-hallucination guarantee enforceable for the demo narrator.
    if (demoMode && options.walkthrough) {
      const grounding = checkObservationGrounding(scriptMarkdown, options.walkthrough.chapters);
      writeJSON(narrationDir, 'grounding.json', grounding);
      if (!grounding.ok) {
        console.warn(
          `\n· Grounding check flagged ${grounding.ungrounded.length} inferred effect(s) — see artifacts/narration/grounding.json`
        );
        grounding.ungrounded.forEach((c) => console.warn(`    ✗ "${c.effect}": ${c.note}`));
      } else if (grounding.totalEffectClaims > 0) {
        console.log(`\n· Grounding check: all ${grounding.totalEffectClaims} described effect(s) supported by observations.`);
      }
    }

    // 8 ── Visual-match audit (OPT-IN via NARRATION_VISUAL_AUDIT=true).
    //    NOTE: this uses a vision model and therefore overrides the milestone's
    //    no-CV/OCR constraint. It is a verification tool only — the narration
    //    pipeline above never analyzes pixels. (Planner-chapters based; skipped
    //    in demo mode where chapters are walkthrough-derived.)
    let visualAudit;
    if (!demoMode && process.env.NARRATION_VISUAL_AUDIT === 'true' && options.apiKey) {
      try {
        visualAudit = await auditVisualMatch(ctx, accuracyChapters, {
          apiKey: options.apiKey,
          summaryPath: baseResult.summaryPath,
          framesDir: resolve(narrationDir, 'frames'),
          ...(options.llm ?? {}),
        });
        writeJSON(narrationDir, 'visual-audit.json', visualAudit);
        const analyzed = visualAudit.frames.filter((f) => typeof f.consistent === 'boolean').length;
        console.log(
          `· Visual audit: ${analyzed} frame(s) analyzed${visualAudit.visionUsed ? '' : ' (no vision model — frames only)'}, ${visualAudit.ok ? 'all consistent' : 'see visual-audit.json'}.`
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`· Visual audit skipped: ${msg}`);
      }
    }

    // 9 ── Persist metadata for the evaluation doc.
    writeJSON(narrationDir, 'narration-meta.json', {
      generatedAt: new Date().toISOString(),
      provider: provider.name,
      providerDescription: provider.describe(),
      voice: ttsResult.voice,
      cached: ttsResult.cached,
      policy: render.policy,
      resolution: `${renderConfig.resolution.width}x${renderConfig.resolution.height}`,
      fps: renderConfig.fps,
      crf: renderConfig.crf,
      preset: renderConfig.preset,
      source: scriptSource,
      model: scriptModel ?? null,
      narrationStyle: narrationStyle.id,
      music: musicManager.describe(),
      audioMixed: mixResult.tracksUsed.length > 1,
      chapters: reportChapters.length,
      totalDurationMs: render.durationMs ?? null,
      audioDurationMs: render.audioDurationMs ?? null,
      videoDurationMs: render.videoDurationMs ?? null,
      summaryPath: baseResult.summaryPath,
      accuracy: { ok: accuracy.ok, totalClaims: accuracy.totalClaims, ungrounded: accuracy.ungrounded.length },
      visualAudit: visualAudit
        ? { ok: visualAudit.ok, visionUsed: visualAudit.visionUsed, frames: visualAudit.frames.length }
        : null,
    });

    return { ...baseResult, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ Narration failed: ${message}`);
    return { ...baseResult, ok: false, error: message };
  }
}

/**
 * Locate the browser execution video. Playwright writes it under
 * `artifacts/test-output/<test-slug>/video.webm`; we resolve the artifacts root
 * from `artifactsDir` (which is the *discovery* dir) and search its sibling.
 */
async function findVideo(artifactsDir: string): Promise<string | undefined> {
  const testOutput = resolve(artifactsDir, '..', 'test-output'); // …/artifacts/test-output
  if (!existsSync(testOutput)) return undefined;
  return findRecursively(testOutput, 'video.webm');
}

function findRecursively(root: string, name: string): string | undefined {
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

function writeJSON(dir: string, name: string, value: unknown): void {
  writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function writeRaw(dir: string, name: string, value: string): void {
  writeFileSync(resolve(dir, name), value, 'utf-8');
}
