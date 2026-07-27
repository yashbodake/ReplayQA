import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DefaultRenderPolicy, loadRenderConfig } from './render/policy.js';
import { renderSummary, probeDurationMs } from './render/index.js';
import type { RenderConfig, RenderInputs } from './render/policy.js';

/**
 * v0.9 cinematic benchmark.
 *
 * Renders the SAME narration audio + browser video twice — once with the
 * pre-v0.9 "legacy" encoding (CRF 23 / veryfast / 720p / 30fps, no faststart)
 * and once with the v0.9 "cinematic" defaults (CRF 18 / slow / 1080p / 30fps /
 * faststart) — then probes both with ffprobe and emits a comparison table.
 *
 * This isolates presentation quality: Discovery/Reasoning/Planning/Generation
 * are not re-run; only the final encode differs.
 */

export interface BenchmarkEntry {
  label: string;
  policy: string;
  config: RenderConfig;
  renderMs: number;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  avgBitrate?: string;
  fps?: number;
  outPath: string;
}

export interface BenchmarkResult {
  generatedAt: string;
  audioPath: string;
  videoPath: string;
  legacy: BenchmarkEntry;
  cinematic: BenchmarkEntry;
  /** Multiplicative size ratio cinematic/legacy (>1 means v0.9 is larger). */
  sizeRatio: number;
  /** Render-time ratio cinematic/legacy. */
  renderTimeRatio: number;
}

const LEGACY_CONFIG: RenderConfig = {
  resolution: { width: 1280, height: 720 },
  fps: 30,
  crf: 23,
  preset: 'veryfast',
  audioBitrate: '128k',
};

/**
 * Run the benchmark against an existing narration audio + browser video.
 * Produces two mp4s under `outDir` and a `benchmark.json`.
 */
export async function runBenchmark(args: {
  audioPath: string;
  videoPath: string;
  outDir: string;
}): Promise<BenchmarkResult> {
  if (!existsSync(args.audioPath)) throw new Error(`audio not found: ${args.audioPath}`);
  if (!existsSync(args.videoPath)) throw new Error(`video not found: ${args.videoPath}`);
  mkdirSync(args.outDir, { recursive: true });

  const legacy = await renderVariant({
    label: 'legacy (v0.8)',
    config: LEGACY_CONFIG,
    audioPath: args.audioPath,
    videoPath: args.videoPath,
    outPath: resolve(args.outDir, 'summary-legacy.mp4'),
  });
  const cinematic = await renderVariant({
    label: 'cinematic (v0.9)',
    config: loadCinematicConfig(),
    audioPath: args.audioPath,
    videoPath: args.videoPath,
    outPath: resolve(args.outDir, 'summary-cinematic.mp4'),
  });

  const result: BenchmarkResult = {
    generatedAt: new Date().toISOString(),
    audioPath: args.audioPath,
    videoPath: args.videoPath,
    legacy,
    cinematic,
    sizeRatio: cinematic.sizeBytes / Math.max(1, legacy.sizeBytes),
    renderTimeRatio: cinematic.renderMs / Math.max(1, legacy.renderMs),
  };
  writeFileSync(resolve(args.outDir, 'benchmark.json'), JSON.stringify(result, null, 2) + '\n', 'utf-8');
  return result;
}

interface RenderVariantArgs {
  label: string;
  config: RenderConfig;
  audioPath: string;
  videoPath: string;
  outPath: string;
}

async function renderVariant(args: RenderVariantArgs): Promise<BenchmarkEntry> {
  // A throwaway policy instance carrying the variant's config.
  const policy = new DefaultRenderPolicy(args.config);
  const inputs: RenderInputs = {
    videoPath: args.videoPath,
    audioPath: args.audioPath,
    outPath: args.outPath,
  };
  const t0 = Date.now();
  // renderSummary uses the registry to pick a policy by env; for the benchmark
  // we bypass it and call the policy + ffmpeg via the same path by inlining
  // the orchestration that renderSummary does. To keep this self-contained we
  // reuse renderSummary with a temporary policy override through its options.
  await renderSummary(inputs, { policy });
  const renderMs = Date.now() - t0;

  const sizeBytes = existsSync(args.outPath) ? statSync(args.outPath).size : 0;
  const probe = await probeFile(args.outPath);

  return {
    label: args.label,
    policy: policy.name,
    config: args.config,
    renderMs,
    sizeBytes,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    avgBitrate: probe.bitrate,
    fps: probe.fps,
    outPath: args.outPath,
  };
}

/** The v0.9 cinematic config — read from env exactly like production. */
function loadCinematicConfig(): RenderConfig {
  // Delegates to the same loader the production policy uses, so the benchmark
  // reflects whatever the operator has configured.
  return loadRenderConfig();
}

interface ProbeResult {
  durationMs?: number;
  width?: number;
  height?: number;
  bitrate?: string;
  fps?: number;
}

async function probeFile(file: string): Promise<ProbeResult> {
  const durationMs = await probeDurationMs(file);
  const out: ProbeResult = { durationMs };
  // ffprobe stream details (width/height/bit_rate/r_frame_rate).
  await new Promise<void>((pass) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,bit_rate,r_frame_rate',
      '-show_entries', 'format=bit_rate',
      '-of', 'default=noprint_wrappers=1',
      file,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.on('close', () => {
      const m = {
        width: stdout.match(/^width=(\d+)/m),
        height: stdout.match(/^height=(\d+)/m),
        bitrate: stdout.match(/^bit_rate=(\d+)/m),
        fps: stdout.match(/^r_frame_rate=(\d+)\/(\d+)/m),
      };
      if (m.width) out.width = parseInt(m.width[1], 10);
      if (m.height) out.height = parseInt(m.height[1], 10);
      if (m.bitrate) out.bitrate = `${(parseInt(m.bitrate[1], 10) / 1_000_000).toFixed(2)} Mbps`;
      if (m.fps) out.fps = Math.round(parseInt(m.fps[1], 10) / parseInt(m.fps[2], 10));
      pass();
    });
    child.on('error', () => pass());
  });
  return out;
}

/** Render the benchmark result as a markdown table for the report. */
export function renderBenchmarkMarkdown(r: BenchmarkResult): string {
  const row = (e: BenchmarkEntry) =>
    `| ${e.label} | ${e.policy} | ${e.config.resolution.width}×${e.config.resolution.height} | ${e.config.fps} | ${e.config.preset}/CRF${e.config.crf} | ${(e.sizeBytes / 1_048_576).toFixed(2)} MB | ${(e.renderMs / 1000).toFixed(1)} s | ${e.avgBitrate ?? '—'} |`;
  return [
    `# v0.9 Cinematic Benchmark`,
    ``,
    `Generated: ${r.generatedAt}`,
    ``,
    `| Variant | Policy | Resolution | FPS | Encode | Size | Render time | Avg bitrate |`,
    `|---|---|---|---|---|---|---|---|`,
    row(r.legacy),
    row(r.cinematic),
    ``,
    `Size ratio (cinematic / legacy): **${r.sizeRatio.toFixed(2)}×**`,
    `Render-time ratio (cinematic / legacy): **${r.renderTimeRatio.toFixed(2)}×**`,
  ].join('\n');
}
