import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * BackgroundMusicManager — manages a music library and selects tracks for the
 * audio mix (v1.0).
 *
 * Unlike a single-file approach, this scans a configurable directory for
 * supported audio files (a "playlist") and picks one per run (shuffled or
 * first). A specific file can still be forced via NARRATION_MUSIC_FILE.
 *
 * The manager does NOT mix audio itself — it only sources tracks. The
 * AudioMixer consumes the selected track.
 */

export interface MusicConfig {
  /** Whether background music is enabled. Default: false. */
  enabled: boolean;
  /** Directory to scan for music files. Default: assets/music/. */
  musicDir: string;
  /** Music volume (0–1 linear). Default: 0.15 (subtle, ≈ -16dB). */
  volume: number;
  /** Fade-in duration in seconds. Default: 2. */
  fadeInSec: number;
  /** Fade-out duration in seconds. Default: 3. */
  fadeOutSec: number;
  /** How much music ducks under narration, in dB (negative). Default: -12. */
  duckingDb: number;
  /** Shuffle track selection from the library. Default: true. */
  shuffle: boolean;
  /** Force a specific file (overrides directory scan). */
  filePath?: string;
}

export interface MusicTrack {
  path: string;
  name: string;
}

const SUPPORTED_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'];

function hasSupportedAudio(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    const entries = readdirSync(dir);
    return entries.some((f) => SUPPORTED_EXTENSIONS.includes(ext(f).toLowerCase()));
  } catch {
    return false;
  }
}

/** Load music config from env vars with sensible defaults. */
export function loadMusicConfig(): MusicConfig {
  let musicDir = process.env.NARRATION_MUSIC_DIR;
  if (!musicDir) {
    const rootMusic = resolve(process.cwd(), 'music');
    const assetsMusic = resolve(process.cwd(), 'assets', 'music');
    if (existsSync(rootMusic) && hasSupportedAudio(rootMusic)) {
      musicDir = rootMusic;
    } else {
      musicDir = assetsMusic;
    }
  }

  const enabledEnv = process.env.NARRATION_MUSIC;
  const enabled = enabledEnv !== undefined
    ? enabledEnv === 'true'
    : hasSupportedAudio(musicDir);

  return {
    enabled,
    musicDir,
    volume: clamp(Number(process.env.NARRATION_MUSIC_VOLUME ?? '0.06'), 0, 1, 0.06),
    fadeInSec: clamp(Number(process.env.NARRATION_MUSIC_FADE_IN ?? '2'), 0, 30, 2),
    fadeOutSec: clamp(Number(process.env.NARRATION_MUSIC_FADE_OUT ?? '3'), 0, 30, 3),
    duckingDb: clamp(Number(process.env.NARRATION_DUCKING_DB ?? '-12'), -60, 0, -12),
    shuffle: process.env.NARRATION_MUSIC_SHUFFLE !== 'false',
    filePath: process.env.NARRATION_MUSIC_FILE || undefined,
  };
}

export class BackgroundMusicManager {
  private readonly config: MusicConfig;

  constructor(config?: MusicConfig) {
    this.config = config ?? loadMusicConfig();
  }

  getConfig(): MusicConfig {
    return this.config;
  }

  /** True if music is enabled and at least one track is available. */
  isAvailable(): boolean {
    if (!this.config.enabled) return false;
    return Boolean(this.selectTrack());
  }

  /** Human-readable description for metadata/logging. */
  describe(): string {
    if (!this.config.enabled) return 'background music: disabled';
    const track = this.selectTrack();
    if (!track) return `background music: enabled but no tracks found in ${this.config.musicDir}`;
    return `background music: ${track.name} (vol=${this.config.volume}, duck=${this.config.duckingDb}dB)`;
  }

  /** Scan the music directory; returns all supported audio files. */
  listTracks(): MusicTrack[] {
    // Forced file overrides directory scan.
    if (this.config.filePath) {
      if (existsSync(this.config.filePath)) {
        return [{ path: resolve(this.config.filePath), name: basename(this.config.filePath) }];
      }
      return [];
    }
    if (!existsSync(this.config.musicDir)) return [];
    let entries: string[];
    try {
      entries = readdirSync(this.config.musicDir);
    } catch {
      return [];
    }
    return entries
      .filter((f) => SUPPORTED_EXTENSIONS.includes(ext(f).toLowerCase()))
      .map((f) => ({ path: resolve(this.config.musicDir, f), name: f }))
      .filter((t) => {
        try { return statSync(t.path).isFile(); } catch { return false; }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Pick one track for this run. If shuffle is enabled, the selection is
   * randomized so consecutive runs don't repeat. Returns undefined if the
   * library is empty.
   */
  selectTrack(): MusicTrack | undefined {
    const tracks = this.listTracks();
    if (tracks.length === 0) return undefined;
    if (tracks.length === 1 || !this.config.shuffle) return tracks[0];
    return tracks[Math.floor(Math.random() * tracks.length)];
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function ext(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '';
}

function basename(path: string): string {
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return sep >= 0 ? path.slice(sep + 1) : path;
}
