import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { probeDurationMs } from '../render/render.js';

/**
 * AudioMixer — combines multiple audio tracks into a single mixed output (v1.0).
 *
 * Designed for N tracks from the start. Today: narration + background music.
 * Tomorrow: sound effects, transitions, stingers — just add more AudioTrack
 * entries with the appropriate role and duckUnder settings.
 *
 * Ducking is implemented via ffmpeg's `sidechaincompress` filter: when the
 * narration signal (the sidechain input) exceeds a threshold, the music
 * compresses (ducks). When narration pauses, the music smoothly restores
 * (controlled by the release parameter).
 *
 * If only one track is provided (narration, no music), the mixer is a zero-cost
 * no-op passthrough — no ffmpeg invocation, the original path is returned.
 */

export type AudioRole = 'narration' | 'music' | 'sfx';

export interface AudioTrack {
  /** Path to the audio file on disk. */
  path: string;
  /** How this track is treated in the mix. */
  role: AudioRole;
  /** Linear gain (0–1). Default 1.0. */
  volume: number;
  /** Loop to fill the master duration. Music: true; narration: false. */
  loop: boolean;
  /** Fade-in duration in seconds. */
  fadeInSec: number;
  /** Fade-out duration in seconds. */
  fadeOutSec: number;
  /**
   * Roles whose presence should cause this track to duck (compress).
   * Music typically has `duckUnder: ['narration']`; narration has `[]`.
   */
  duckUnder: AudioRole[];
  /** Ducking depth in dB (negative). Default -12. Only used if duckUnder is non-empty. */
  duckingDb?: number;
}

export interface MixInputs {
  /** All tracks to mix. The narration track must be present and is the master. */
  tracks: AudioTrack[];
  /** Where to write the mixed output. */
  outputPath: string;
  /** Master duration in ms (narration length). Probed if absent. */
  durationMs?: number;
}

export interface MixResult {
  /** Path to the mixed audio (or the original narration if no mixing needed). */
  audioPath: string;
  /** Probed duration of the result. */
  durationMs?: number;
  /** Role labels of tracks that were mixed. */
  tracksUsed: string[];
}

export class AudioMixer {
  /**
   * Mix the provided tracks. If there's only one track (narration alone), this
   * is a zero-cost passthrough — the original path is returned unchanged.
   */
  async mix(inputs: MixInputs): Promise<MixResult> {
    const narration = inputs.tracks.find((t) => t.role === 'narration');
    const nonNarration = inputs.tracks.filter((t) => t.role !== 'narration');

    // Validate inputs.
    if (!narration || !existsSync(narration.path)) {
      throw new Error('AudioMixer: narration track not found or file missing.');
    }

    // No-op passthrough: single track, nothing to mix.
    const validExtras = nonNarration.filter((t) => existsSync(t.path));
    if (validExtras.length === 0) {
      const durationMs = inputs.durationMs ?? (await probeDurationMs(narration.path));
      return { audioPath: narration.path, durationMs, tracksUsed: ['narration'] };
    }

    // Build the ffmpeg filter graph for multi-track mixing with ducking.
    const masterDurationMs = inputs.durationMs ?? (await probeDurationMs(narration.path));
    const masterDurationSec = (masterDurationMs ?? 60000) / 1000;
    const filterGraph = buildFilterGraph(inputs.tracks, masterDurationSec);
    const inputArgs = buildInputArgs(inputs.tracks);

    const ffmpegArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterGraph,
      '-map', '[out]',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      inputs.outputPath,
    ];

    await runFFmpeg(ffmpegArgs);
    const resultDurationMs = await probeDurationMs(inputs.outputPath);

    return {
      audioPath: inputs.outputPath,
      durationMs: resultDurationMs ?? masterDurationMs,
      tracksUsed: inputs.tracks.map((t) => t.role),
    };
  }
}

/**
 * Build the ffmpeg input arguments. Each track becomes an `-i` input. Looping
 * tracks get `-stream_loop -1` before their `-i` so they repeat to fill the
 * master duration.
 *
 * Input ordering: narration is always input [0] (the sidechain source). Other
 * tracks follow in their array order.
 */
function buildInputArgs(tracks: AudioTrack[]): string[] {
  const args: string[] = [];
  // Narration first (index 0).
  const narration = tracks.find((t) => t.role === 'narration');
  if (narration) args.push('-i', narration.path);
  // Then non-narration tracks.
  for (const track of tracks) {
    if (track.role === 'narration') continue;
    if (track.loop) args.push('-stream_loop', '-1');
    args.push('-i', track.path);
  }
  return args;
}

/**
 * Build the ffmpeg filter_complex graph for multi-track mixing with ducking.
 *
 * Strategy:
 *  1. For each non-narration track: apply volume + fades, producing a labeled
 *     stream (e.g. [bg0], [bg1]).
 *  2. For each track that ducks under narration: sidechain-compress it against
 *     [0:a] (the narration), producing a ducked label (e.g. [ducked0]).
 *  3. Mix narration + all processed tracks together with amix.
 *
 * This is dynamic — adding a third track (SFX) just adds another branch.
 */
function buildFilterGraph(tracks: AudioTrack[], masterDurationSec: number): string {
  const parts: string[] = [];
  const mixInputs: string[] = ['[0:a]']; // narration is always the first mix input

  // Non-narration tracks, in order. Their ffmpeg input index is narration(0)+n.
  const nonNarration = tracks.filter((t) => t.role !== 'narration');

  nonNarration.forEach((track, i) => {
    const inputIdx = i + 1; // ffmpeg input index (0 = narration)
    const volLabel = `bg${i}`;
    const fadeOutStart = Math.max(0, masterDurationSec - track.fadeOutSec);

    // Volume + fades.
    const vol = track.volume;
    let chain = `[${inputIdx}:a]volume=${vol}`;
    if (track.fadeInSec > 0) chain += `,afade=t=in:st=0:d=${track.fadeInSec}`;
    if (track.fadeOutSec > 0) chain += `,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${track.fadeOutSec}`;
    parts.push(`${chain}[${volLabel}]`);

    // Ducking via proper sidechain compression: split the narration into a
    // Ducking via proper sidechain compression: split the narration into a
    // sidechain trigger + clean copy, compress the music when speech is active.
    // The key parameters (threshold=0.005, ratio=8, level_sc=1.0, attack=10,
    // release=400) produce strong, natural ducking — music recedes by ~12-16dB
    // when the narrator speaks and comes back up smoothly during pauses.
    if (track.duckUnder.includes('narration')) {
      const duckedLabel = `ducked${i}`;
      // Split narration: [sc] = sidechain trigger, [narration_clean] = for final mix
      parts.push(`[0:a]asplit=2[sc${i}][narration_clean${i}]`);
      // sidechaincompress: music ducks when narration (sc) is active
      parts.push(
        `[${volLabel}][sc${i}]sidechaincompress=threshold=0.005:ratio=8:level_sc=1.0:attack=10:release=400[${duckedLabel}]`
      );
      mixInputs.push(`[${duckedLabel}]`);
      // Override the narration mix input with the clean copy (not the original)
      mixInputs[0] = `[narration_clean${i}]`;
    } else {
      // No ducking (e.g. SFX at full volume).
      mixInputs.push(`[${volLabel}]`);
    }
  });

  // Final mix: combine narration + all processed tracks.
  // normalize=0 is CRITICAL: default (normalize=1) divides all inputs by the
  // number of inputs, halving the narration (-6dB). With normalize=0, each
  // input retains its full volume and the music (already at a lower volume)
  // sits naturally underneath the narration.
  const numInputs = mixInputs.length;
  parts.push(
    `${mixInputs.join('')}amix=inputs=${numInputs}:duration=first:dropout_transition=0:normalize=0[out]`
  );

  return parts.join(';');
}

/** Run ffmpeg with the given args, capturing stderr on failure. */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((pass, fail) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
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
