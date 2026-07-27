/**
 * Render policies (Refinement #5).
 *
 * The rendering pipeline is policy-agnostic: it builds the ffmpeg input/output
 * flags and hands the rest to whatever `RenderPolicy` is selected. Adding a new
 * behaviour (freeze last frame, loop the video, trim, fade-out, chapter-synced
 * pacing, …) is a matter of implementing `RenderPolicy` and registering it in
 * `getRenderPolicy` — `renderSummary` and the rest of the pipeline never change.
 */

export interface RenderInputs {
  videoPath: string;
  audioPath: string;
  outPath: string;
  /** Audio duration in ms, if known (used by policies that need to compare). */
  audioDurationMs?: number;
  /** Video duration in ms, if known. */
  videoDurationMs?: number;
  /** Narration chapters, if the policy wants chapter-boundary alignment. */
  chapters?: { start: number; duration: number; title: string }[];
}

export interface RenderPolicy {
  readonly name: string;
  /** ffmpeg args placed BEFORE the `-i` inputs (e.g. `-stream_loop`). Default: none. */
  buildInputArgs?(inputs: RenderInputs): string[];
  /** ffmpeg args placed BETWEEN the `-i` inputs and the output path. */
  buildFFmpegArgs(inputs: RenderInputs): string[];
  /** Human description for metadata + the evaluation doc. */
  describe(): string;
}

/**
 * Parsed render configuration, read from environment with presentation-quality
 * defaults. Centralised here so every policy reads the same knobs.
 *
 * Defaults target a polished product demo (v0.9): 1920×1080, 30 FPS, visually
 * lossless CRF, slow preset. These are NOT CI-artifact settings.
 */
export interface RenderConfig {
  resolution: { width: number; height: number };
  fps: number;
  crf: number;
  preset: string;
  videoBitrate?: string; // when set, overrides CRF (constant bitrate mode)
  audioBitrate: string;
}

export function loadRenderConfig(): RenderConfig {
  const resolution = parseResolution(process.env.NARRATION_RESOLUTION ?? '1920x1080');
  const fps = clampInt(process.env.NARRATION_FPS, 30, 1, 120);
  const crf = clampInt(process.env.NARRATION_CRF, 18, 0, 51);
  const preset = process.env.NARRATION_PRESET ?? 'slow';
  const videoBitrate = process.env.NARRATION_VIDEO_BITRATE || undefined; // e.g. "8M"
  const audioBitrate = process.env.NARRATION_AUDIO_BITRATE ?? '192k';
  return { resolution, fps, crf, preset, videoBitrate, audioBitrate };
}

/**
 * The default policy shipped with v0.9 (presentation quality).
 *
 * Browser execution videos from Playwright are often much SHORTER than the
 * narration (a passing test may record only 1–3s while the narration runs
 * 60–90s). The default policy loops the video to cover the full audio and then
 * truncates to the audio length, so the result always matches the narration.
 *
 * Mechanism:
 *   - `-stream_loop -1` on the video input repeats it indefinitely.
 *   - Video is transcoded to H.264 (Playwright writes VP8/VP9 in webm, which
 *     the mp4 container cannot hold, so it cannot be stream-copied).
 *   - `-vf scale…,pad…` guarantees the target resolution with correct aspect
 *     ratio (letterboxing rather than stretching).
 *   - `-r <fps>` sets a clean constant frame rate (default 30; 60 optional).
 *   - Audio is transcoded to AAC at 192k.
 *   - `-shortest` ends output at the (looped) audio length.
 *   - `-movflags +faststart` moves the moov atom for web playback.
 *
 * Future policies (freeze-last-frame, trim, fade-out, chapter-synced) implement
 * `RenderPolicy` and are selected via env — the pipeline never changes.
 */
export class DefaultRenderPolicy implements RenderPolicy {
  readonly name: string = 'default';
  protected readonly config: RenderConfig;

  constructor(config?: RenderConfig) {
    this.config = config ?? loadRenderConfig();
  }

  /** Expose the resolved config for metadata/benchmark reporting. */
  getRenderConfig(): RenderConfig {
    return this.config;
  }

  buildInputArgs(_inputs: RenderInputs): string[] {
    return ['-stream_loop', '-1']; // loop the FIRST (-i 0) video input forever
  }

  buildFFmpegArgs(_inputs: RenderInputs): string[] {
    const { resolution, fps, crf, preset, videoBitrate, audioBitrate } = this.config;
    const scaleFilter = buildScaleFilter(resolution.width, resolution.height);
    const args = [
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-preset', preset,
      '-pix_fmt', 'yuv420p', // broad player compatibility
      '-r', String(fps),
    ];
    if (videoBitrate) {
      args.push('-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', `${multiplyBitrate(videoBitrate, 2)}`);
    } else {
      args.push('-crf', String(crf));
    }
    args.push(
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-movflags', '+faststart',
      '-shortest',
    );
    return args;
  }

  describe(): string {
    const { resolution, fps, crf, preset, videoBitrate, audioBitrate } = this.config;
    const rate = videoBitrate ? `bitrate ${videoBitrate}` : `crf ${crf}`;
    return `loop browser video → ${resolution.width}×${resolution.height}@${fps}fps, h264 ${preset} (${rate}), aac ${audioBitrate}`;
  }
}

/** Build a scale+pad filter that fits the source into WxH preserving aspect. */
function buildScaleFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
}

function parseResolution(spec: string): { width: number; height: number } {
  const m = spec.toLowerCase().match(/^(\d+)[x×](\d+)$/);
  if (!m) return { width: 1920, height: 1080 };
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value !== undefined ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Multiply a bitrate spec like "8M" or "192k" by a factor (for -bufsize). */
function multiplyBitrate(spec: string, factor: number): string {
  const m = spec.match(/^(\d+(?:\.\d+)?)([kKmMgG]?)$/);
  if (!m) return spec;
  const n = parseFloat(m[1]) * factor;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}${m[2]}`;
}
