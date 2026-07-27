#!/usr/bin/env python3
"""
Kokoro TTS helper for ReplayQA narration.

Invoked by KokoroTTSProvider (TypeScript) via `uv run`. Reads text from a file,
synthesizes speech, and writes a 24 kHz mono WAV to an output path.

Usage:
    KOKORO_VOICE=af_sarah KOKORO_SPEED=1.0 \\
        python src/narration/tts/kokoro_synth.py <input.txt> <output.wav>

Configuration (env):
    KOKORO_VOICE  — voice name (default af_sarah, American English female).
                    Any Kokoro voice: af_bella, am_michael, af_nova, ...
    KOKORO_SPEED  — speaking speed multiplier (default 1.0).
    KOKORO_MODEL_DIR — directory containing kokoro model files (default: models/kokoro).

Why a separate Python process: the full `kokoro` package depends on torch +
spacy, which (a) is heavy and (b) does not build on Python 3.14. We isolate it
in a uv-managed Python 3.12 venv and shell out, so the Node/TS narration
pipeline stays dependency-free.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: kokoro.py <input.txt> <output.wav>", file=sys.stderr)
        return 2

    text_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    voice = os.environ.get("KOKORO_VOICE", "af_sarah")
    speed = float(os.environ.get("KOKORO_SPEED", "1.0"))

    text = text_path.read_text(encoding="utf-8").strip()
    if not text:
        print("kokoro.py: input text is empty", file=sys.stderr)
        return 3

    try:
        from kokoro import KPipeline
    except ImportError:
        # The most common cause: the venv wasn't provisioned, or the kokoro
        # package failed to install. Give a precise, actionable message.
        print(
            "kokoro.py: the `kokoro` package is not available in this Python. "
            "Provision it with:\n"
            "  uv venv --python 3.12 .venv-kokoro\n"
            "  uv pip install --python .venv-kokoro/bin/python -r requirements-kokoro.txt",
            file=sys.stderr,
        )
        return 4
    except Exception as e:  # pragma: no cover - surface init-time failures honestly
        import traceback
        print(f"kokoro.py: failed to import kokoro: {e!r}", file=sys.stderr)
        traceback.print_exc()
        return 4

    pipeline = KPipeline(lang_code="a")  # 'a' = American English

    # KPipeline yields (graphemes, phonemes, audio_numpy) chunks per sentence
    # group. Concatenate the audio chunks into one continuous track.
    import numpy as np
    import soundfile as sf

    chunks = []
    for _gs, _ps, audio in pipeline(text, voice=voice, speed=speed):
        if audio is not None and len(audio) > 0:
            chunks.append(np.asarray(audio, dtype=np.float32))

    if not chunks:
        print("kokoro.py: synthesis produced no audio", file=sys.stderr)
        return 5

    combined = np.concatenate(chunks)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Kokoro outputs at 24 kHz mono float32 in [-1, 1].
    sf.write(str(out_path), combined, 24000, subtype="PCM_16")
    return 0


if __name__ == "__main__":
    sys.exit(main())
