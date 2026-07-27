import { DefaultRenderPolicy, loadRenderConfig } from './policy.js';
import type { RenderInputs, RenderPolicy } from './policy.js';

/**
 * WalkthroughRenderPolicy — renders the interactive walkthrough video (v0.9.1).
 *
 * Unlike `DefaultRenderPolicy`, this does NOT loop the source. The walkthrough
 * recorder already produced 30–90s of genuine feature usage matching the
 * narration, so looping would only repeat content. This policy scales the
 * source to the target resolution (scale+pad, preserving aspect), encodes
 * high-quality H.264, and uses `-shortest` only to trim any tiny audio/video
 * mismatch.
 *
 * If the narration audio is longer than the walkthrough video (rare), ffmpeg
 * will still stop at the shorter stream; for v0.9.1 we accept that rather than
 * reintroduce looping. A future policy could hold the last frame.
 */
export class WalkthroughRenderPolicy extends DefaultRenderPolicy implements RenderPolicy {
  readonly name = 'walkthrough';

  constructor(config = loadRenderConfig()) {
    super(config);
  }

  // No `-stream_loop`: the walkthrough footage is played once, as recorded.
  buildInputArgs(_inputs: RenderInputs): string[] {
    return [];
  }

  describe(): string {
    return `${super.describe()} (no loop — real walkthrough footage)`;
  }
}
