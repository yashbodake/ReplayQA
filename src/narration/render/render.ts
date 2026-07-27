import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getRenderPolicy } from './registry.js';
import type { RenderInputs, RenderPolicy } from './policy.js';

export interface RenderResult {
  path: string;
  /** Output duration in ms (from ffprobe). */
  durationMs?: number;
  policy: string;
  videoDurationMs?: number;
  audioDurationMs?: number;
}

/**
 * Mux the browser video and the narration audio into `ReplayQA-Summary.mp4`
 * using ffmpeg, delegating stream handling to a `RenderPolicy` (Refinement #5).
 *
 * The pipeline here never encodes policy behaviour: it owns input/output flags,
 * validation, error reporting, and duration probing. Behaviour lives in the
 * policy, so new policies require no change here.
 */
export async function renderSummary(
  inputs: RenderInputs,
  options: { policy?: RenderPolicy } = {}
): Promise<RenderResult> {
  const policy = options.policy ?? getRenderPolicy();
  if (!existsSync(inputs.videoPath)) {
    throw new Error(`Render input video not found: ${inputs.videoPath}`);
  }
  if (!existsSync(inputs.audioPath)) {
    throw new Error(`Render input audio not found: ${inputs.audioPath}`);
  }

  const inputArgs = policy.buildInputArgs?.(inputs) ?? [];
  const policyArgs = policy.buildFFmpegArgs(inputs);
  const ffmpegArgs = [
    '-y',
    ...inputArgs,            // e.g. -stream_loop -1 (applies to the next -i)
    '-i', inputs.videoPath,
    '-i', inputs.audioPath,
    ...policyArgs,
    inputs.outPath,
  ];
  await runFFmpeg(ffmpegArgs);

  const videoDurationMs = inputs.videoDurationMs ?? (await probeDurationMs(inputs.videoPath));
  const audioDurationMs = inputs.audioDurationMs ?? (await probeDurationMs(inputs.audioPath));
  const durationMs = await probeDurationMs(inputs.outPath).catch(() => undefined);

  return {
    path: inputs.outPath,
    durationMs,
    policy: policy.name,
    videoDurationMs,
    audioDurationMs,
  };
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((pass, fail) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => fail(new Error(`ffmpeg failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) pass();
      else {
        const tail = stderr.split('\n').slice(-12).join('\n').trim();
        fail(new Error(`ffmpeg exited with code ${code}.${tail ? `\n${tail}` : ''}`));
      }
    });
  });
}

/** Probe a media file's duration in ms via ffprobe (best-effort). */
export async function probeDurationMs(file: string): Promise<number | undefined> {
  return new Promise((pass) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', () => pass(undefined));
    child.on('close', () => {
      const seconds = parseFloat(stdout.trim());
      pass(Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined);
    });
  });
}

/** Resolve a video file under an artifacts/test-output tree (recursive glob). */
export function defaultSummaryPath(reportDir: string): string {
  return resolve(reportDir, 'ReplayQA-Summary.mp4');
}
