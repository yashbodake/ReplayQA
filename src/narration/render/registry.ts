import { DefaultRenderPolicy } from './policy.js';
import { SyncedTimelinePolicy } from './synced-policy.js';
import { WalkthroughRenderPolicy } from './walkthrough-policy.js';
import type { RenderPolicy } from './policy.js';

/**
 * Policy registry (in its own module to avoid a circular import between
 * `policy.ts` and `synced-policy.ts`). `synced-policy.ts` extends
 * `DefaultRenderPolicy` from `policy.ts`, so neither of those two may import the
 * other's registry — keeping the registry here breaks the cycle cleanly.
 *
 * Add new policies here.
 */
const POLICIES: Record<string, () => RenderPolicy> = {
  default: () => new DefaultRenderPolicy(),
  synced: () => new SyncedTimelinePolicy(),
  walkthrough: () => new WalkthroughRenderPolicy(),
};

/**
 * Select a render policy by name.
 * Resolution: explicit `name` → `NARRATION_RENDER_POLICY` env → "default".
 */
export function getRenderPolicy(name?: string): RenderPolicy {
  const requested = name ?? process.env.NARRATION_RENDER_POLICY ?? 'default';
  const factory = POLICIES[requested];
  if (!factory) {
    const known = Object.keys(POLICIES).join(', ');
    throw new Error(`Unknown render policy "${requested}". Known policies: ${known}.`);
  }
  return factory();
}
