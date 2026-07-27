import { EdgeTTSProvider } from './edge-tts.js';
import { KokoroTTSProvider } from './kokoro.js';

/**
 * The provider-agnostic TTS surface (Refinement #4). Anything that wants
 * narration audio depends on `TTSProvider`, never on a concrete
 * implementation. New providers (OpenAI, local Coqui, etc.) are added by
 * implementing this interface and registering in `getTTSProvider`.
 */
export interface TTSProvider {
  /** Stable identifier, e.g. "edge". */
  readonly name: string;
  /** Human-readable voice/rate description, for metadata + evaluation. */
  describe(): string;
  /** Synthesize `text` to an audio buffer (mp3). */
  synthesize(text: string, opts?: TTSOptions): Promise<TTSResult>;
}

export interface TTSOptions {
  voice?: string;
  /** Speaking-rate adjustment, e.g. "+0%", "-10%". Provider-specific format. */
  rate?: string;
}

export interface TTSResult {
  audio: Buffer;
  format: 'mp3';
  /** Spoken duration in ms, if the provider reports it. */
  durationMs?: number;
  /** Whether the result came from the cache. */
  cached: boolean;
  /** Voice actually used. */
  voice: string;
}

/**
 * Registry of known provider names → factory. Add new providers here.
 *
 * Provider selection is fully interchangeable (Refinement #4): the narration
 * pipeline depends only on `TTSProvider`. The default is `kokoro` (v0.9) for
 * production-quality local narration; `edge` remains available for environments
 * without a Kokoro venv.
 */
const PROVIDERS: Record<string, (opts?: { cacheDir?: string }) => TTSProvider> = {
  kokoro: (opts) => new KokoroTTSProvider({ cacheDir: opts?.cacheDir }),
  edge: (opts) => new EdgeTTSProvider({ cacheDir: opts?.cacheDir }),
};

/**
 * Select a TTS provider by name. Resolution order:
 *   explicit `opts.name` → `NARRATION_TTS_PROVIDER` env → default "kokoro".
 * Throws a helpful error listing registered providers if the name is unknown.
 */
export function getTTSProvider(opts?: { name?: string; cacheDir?: string }): TTSProvider {
  const requested = opts?.name ?? process.env.NARRATION_TTS_PROVIDER ?? 'kokoro';
  const factory = PROVIDERS[requested];
  if (!factory) {
    const known = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown TTS provider "${requested}". Known providers: ${known}.`);
  }
  return factory(opts);
}
