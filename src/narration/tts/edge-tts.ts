import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { TTSOptions, TTSProvider, TTSResult } from './provider.js';

/**
 * EdgeTTSProvider — the first concrete TTS provider (Refinement #4).
 *
 * Edge-TTS is a Python tool with no official npm package, so this provider
 * shells out to the `edge-tts` CLI via `child_process`. The provider surface
 * is independent of that detail: callers see only `TTSProvider`. Swapping to a
 * different engine is a matter of implementing the interface and registering it.
 *
 * Caching: each (text, voice, rate) combination is hashed; the resulting mp3
 * is stored under `cacheDir` and reused on hit, so re-running narration during
 * iteration is effectively free.
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = 'edge';

  private readonly defaultVoice: string;
  private readonly defaultRate: string;
  private readonly cacheDir: string;
  /** Resolved edge-tts executable (absolute path or bare command for PATH). */
  private readonly bin: string;

  constructor(options?: { voice?: string; rate?: string; cacheDir?: string; bin?: string }) {
    this.defaultVoice = options?.voice ?? process.env.NARRATION_VOICE ?? 'en-US-AriaNeural';
    this.defaultRate = options?.rate ?? process.env.REASONING_NARRATION_RATE ?? process.env.NARRATION_RATE ?? '+0%';
    this.cacheDir = options?.cacheDir ?? process.env.NARRATION_CACHE_DIR ?? resolve(process.cwd(), 'artifacts/narration/.cache');
    this.bin = options?.bin ?? process.env.NARRATION_EDGE_TTS_BIN ?? resolveEdgeTtsBin();
    this.assertCliAvailable();
  }

  describe(): string {
    return `edge-tts voice=${this.defaultVoice} rate=${this.defaultRate}`;
  }

  async synthesize(text: string, opts?: TTSOptions): Promise<TTSResult> {
    const voice = opts?.voice ?? this.defaultVoice;
    const rate = opts?.rate ?? this.defaultRate;
    const cacheKey = hashKey(text, voice, rate);
    const cacheFile = resolve(this.cacheDir, `${cacheKey}.mp3`);

    if (existsSync(cacheFile)) {
      const audio = readFileSync(cacheFile);
      return { audio, format: 'mp3', cached: true, voice };
    }

    // edge-tts writes to a file; use a temp path then read it back.
    mkdirSync(this.cacheDir, { recursive: true });
    const tmpFile = resolve(tmpdir(), `replayqa-tts-${cacheKey}.mp3`);
    await runEdgeTts(this.bin, { text, voice, rate, outFile: tmpFile });
    const audio = readFileSync(tmpFile);
    writeFileSync(cacheFile, audio); // populate cache
    try {
      unlinkSync(tmpFile); // best-effort cleanup of the temp file
    } catch {
      /* ignore */
    }
    return { audio, format: 'mp3', cached: false, voice };
  }

  private assertCliAvailable(): void {
    // `edge-tts --help` is cheap and exits 0 when the CLI is installed.
    const res = spawnSync(this.bin, ['--help'], { stdio: 'ignore' });
    if (res.error || res.status !== 0) {
      throw new Error(
        `The "edge-tts" command was not found (tried "${this.bin}"). Install it with:  pip install edge-tts\n` +
          '(EdgeTTSProvider shells out to the Python edge-tts CLI. A project venv at ./.venv is auto-detected.)'
      );
    }
  }
}

function runEdgeTts(bin: string, args: { text: string; voice: string; rate: string; outFile: string }): Promise<void> {
  return new Promise((resolveFn, reject) => {
    const child = spawn(bin, [
      '--voice', args.voice,
      '--rate', args.rate,
      '--text', args.text,
      '--write-media', args.outFile,
    ]);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(new Error(`edge-tts failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolveFn();
      else reject(new Error(`edge-tts exited with code ${code}.${stderr ? ` stderr: ${stderr.trim()}` : ''}`));
    });
  });
}

function hashKey(text: string, voice: string, rate: string): string {
  return createHash('sha256').update(`${voice}|${rate}|${text}`).digest('hex').slice(0, 24);
}

/**
 * Resolve the edge-tts executable.
 *
 * Order: a bare `edge-tts` on PATH (the common case once `pip install edge-tts`
 * is done globally), then a project-local venv at `./.venv/bin/edge-tts`
 * (auto-detected so users who install into a venv need no extra config).
 */
function resolveEdgeTtsBin(): string {
  const onPath = spawnSync('edge-tts', ['--help'], { stdio: 'ignore' });
  if (!onPath.error && onPath.status === 0) return 'edge-tts';
  const venvBin = resolve(process.cwd(), '.venv', 'bin', 'edge-tts');
  if (existsSync(venvBin)) return venvBin;
  return 'edge-tts'; // let assertCliAvailable produce a helpful error
}
