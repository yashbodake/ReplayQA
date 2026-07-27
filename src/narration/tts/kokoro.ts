import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { TTSOptions, TTSProvider, TTSResult } from './provider.js';

/**
 * KokoroTTSProvider — the new default TTS engine (v0.9).
 *
 * Kokoro is a high-quality open-weight TTS model. Its full Python package needs
 * torch + spacy, which (a) is heavy and (b) does not build on Python 3.14. We
 * therefore isolate it in a uv-managed Python 3.12 venv and shell out to a tiny
 * helper script (`kokoro.py`). The provider surface stays identical to
 * EdgeTTSProvider — callers see only `TTSProvider`, and swapping is one env var.
 *
 * Voice is fully configurable via `KOKORO_VOICE` (default `af_sarah` — Sarah,
 * American English). Audio is cached by sha256(text|voice|speed) exactly like
 * the edge provider, so re-runs are free.
 */
export class KokoroTTSProvider implements TTSProvider {
  readonly name = 'kokoro';

  private readonly voice: string;
  private readonly speed: number;
  private readonly cacheDir: string;
  private readonly projectRoot: string;
  private readonly uvBin: string;
  private readonly venvPython: string;

  constructor(options?: { voice?: string; speed?: number; cacheDir?: string; projectRoot?: string }) {
    this.voice = options?.voice ?? process.env.KOKORO_VOICE ?? 'af_sarah';
    this.speed = options?.speed ?? Number(process.env.KOKORO_SPEED ?? '1.0');
    this.cacheDir = options?.cacheDir ?? process.env.NARRATION_CACHE_DIR ?? resolve(process.cwd(), 'artifacts/narration/.cache');
    this.projectRoot = options?.projectRoot ?? process.cwd();
    this.uvBin = process.env.UV_BIN ?? resolveHome('.local/bin/uv');
    // The isolated venv created during provisioning (see requirements-kokoro.txt).
    this.venvPython = process.env.KOKORO_VENV_PYTHON ?? resolve(this.projectRoot, '.venv-kokoro', 'bin', 'python');
    this.assertAvailable();
  }

  describe(): string {
    return `kokoro voice=${this.voice} speed=${this.speed}`;
  }

  async synthesize(text: string, opts?: TTSOptions): Promise<TTSResult> {
    const voice = opts?.voice ?? this.voice;
    const speed = this.speed; // speed is provider-configured, not per-call
    const cacheKey = hashKey(text, voice, speed);
    const cacheFile = resolve(this.cacheDir, `${cacheKey}.mp3`);

    if (existsSync(cacheFile)) {
      return { audio: readFileSync(cacheFile), format: 'mp3', cached: true, voice };
    }

    mkdirSync(this.cacheDir, { recursive: true });

    // 1. Run the Python helper → produces a 24kHz WAV in a temp path.
    const tmpTxt = resolve(tmpdir(), `kokoro-${cacheKey}.txt`);
    const tmpWav = resolve(tmpdir(), `kokoro-${cacheKey}.wav`);
    writeFileSync(tmpTxt, text, 'utf-8');

    await runKokoro({
      uvBin: this.uvBin,
      venvPython: this.venvPython,
      projectRoot: this.projectRoot,
      inputTxt: tmpTxt,
      outputWav: tmpWav,
      voice,
      speed,
    });

    if (!existsSync(tmpWav)) {
      throw new Error('kokoro.py did not produce an output WAV — see stderr above.');
    }

    // 2. Convert WAV → mp3 (consistent format with the edge provider + cache).
    await wavToMp3(tmpWav, cacheFile);

    // Best-effort cleanup of intermediates.
    try { unlinkSync(tmpTxt); } catch { /* ignore */ }
    try { unlinkSync(tmpWav); } catch { /* ignore */ }

    return { audio: readFileSync(cacheFile), format: 'mp3', cached: false, voice };
  }

  private assertAvailable(): void {
    // Check uv presence.
    const uvCheck = spawnSync(this.uvBin, ['--version'], { stdio: 'ignore' });
    if (uvCheck.error || uvCheck.status !== 0) {
      throw new Error(
        `uv not found at "${this.uvBin}". Install uv (https://docs.astral.sh/uv/) — Kokoro runs in a uv-managed venv.`
      );
    }
    // Check the provisioned venv exists. We DON'T run kokoro here (it's slow to
    // import torch); a missing venv is caught later with the helper's clear msg.
    if (!existsSync(this.venvPython)) {
      throw new Error(
        `Kokoro venv not found at "${this.venvPython}". Provision it:\n` +
          '  uv venv --python 3.12 .venv-kokoro\n' +
          '  uv pip install --python .venv-kokoro/bin/python -r requirements-kokoro.txt'
      );
    }
  }
}

interface KokoroRunArgs {
  uvBin: string;
  venvPython: string;
  projectRoot: string;
  inputTxt: string;
  outputWav: string;
  voice: string;
  speed: number;
}

function runKokoro(args: KokoroRunArgs): Promise<void> {
  return new Promise((pass, fail) => {
    const helper = resolve(args.projectRoot, 'src', 'narration', 'tts', 'kokoro_synth.py');
    // `uv run` with an explicit venv python ensures the right interpreter +
    // isolated deps are used regardless of the caller's PATH/activate state.
    const child = spawn(
      args.uvBin,
      ['run', '--python', args.venvPython, helper, args.inputTxt, args.outputWav],
      {
        cwd: args.projectRoot,
        env: {
          ...process.env,
          KOKORO_VOICE: args.voice,
          KOKORO_SPEED: String(args.speed),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', (err) => fail(new Error(`kokoro failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) pass();
      else fail(new Error(`kokoro.py exited with code ${code}.${stderr ? `\n${stderr.trim().slice(-800)}` : ''}`));
    });
  });
}

/** Convert a WAV file to mp3 via ffmpeg (high quality, 192k). */
function wavToMp3(wavPath: string, mp3Path: string): Promise<void> {
  return new Promise((pass, fail) => {
    const child = spawn('ffmpeg', [
      '-y', '-i', wavPath,
      '-codec:a', 'libmp3lame', '-b:a', '192k',
      mp3Path,
    ], { stdio: 'ignore' });
    child.on('error', (err) => fail(new Error(`ffmpeg (wav→mp3) failed to start: ${err.message}`)));
    child.on('close', (code) => (code === 0 ? pass() : fail(new Error(`ffmpeg (wav→mp3) exited ${code}`))));
  });
}

function resolveHome(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return home ? resolve(home, p) : p;
}

function hashKey(text: string, voice: string, speed: number): string {
  return createHash('sha256').update(`${voice}|${speed}|${text}`).digest('hex').slice(0, 24);
}
