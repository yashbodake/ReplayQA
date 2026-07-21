import { fingerprintHash } from './hash.js';
import { computeStateId, buildStateCanonical } from '../state/fingerprint.js';
import type { StateMaterials } from './materials.js';

export type StrategyId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface Strategy {
  id: StrategyId;
  name: string;
  description: string;
  /** Compute the canonical string this strategy hashes. (Exposed for debugging.) */
  canonical: (m: StateMaterials) => string;
  /** Compute the fingerprint hash. */
  fingerprint: (m: StateMaterials) => string;
}

/**
 * The five strategies. A–D are kept as COMPARISON BASELINES so the lab can
 * keep proving that E remains the right choice (and that cheaper strategies
 * still have the failure modes documented in state-fingerprint-report.md).
 *
 * Strategy E is NOT duplicated here — it delegates to the production
 * `computeStateId` / `buildStateCanonical` in `state/fingerprint.ts`. So the
 * lab's E IS the shipped algorithm; if anyone changes the production
 * fingerprint, the lab's E reflects it automatically and the regression suite
 * (experiment.ts) will surface any behaviour change.
 */
export const strategies: Strategy[] = [
  {
    id: 'A',
    name: 'Canonical URL',
    description: 'URL only. Cheapest; blind to modals, tabs, dialogs.',
    canonical: (m) => m.url,
    fingerprint: (m) => fingerprintHash(m.url),
  },
  {
    id: 'B',
    name: 'URL + DOM structure',
    description: 'URL + depth-first tag/role tree of visible elements (collapsed).',
    canonical: (m) => `${m.url}\n${m.domTagTree}`,
    fingerprint: (m) => fingerprintHash(`${m.url}\n${m.domTagTree}`),
  },
  {
    id: 'C',
    name: 'URL + Accessibility tree',
    description: 'URL + a11y role/level tree (names dropped, collapsed).',
    canonical: (m) => `${m.url}\n${m.a11yRoleTree}`,
    fingerprint: (m) => fingerprintHash(`${m.url}\n${m.a11yRoleTree}`),
  },
  {
    id: 'D',
    name: 'URL + Interactive + Components',
    description: 'URL + deduped interactive surface + component-presence flags.',
    canonical: (m) => `${m.url}\n${m.interactive.join('\n')}\n${m.components}`,
    fingerprint: (m) =>
      fingerprintHash(`${m.url}\n${m.interactive.join('\n')}\n${m.components}`),
  },
  {
    id: 'E',
    name: 'Hybrid (production)',
    description:
      'PRODUCTION Strategy E — delegates to state/fingerprint.ts. ' +
      'URL + a11y + DOM + interactive surface + components + nav.',
    canonical: (m) => buildStateCanonical(m),
    fingerprint: (m) => computeStateId(m),
  },
];

export function strategyById(id: StrategyId): Strategy {
  const s = strategies.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown strategy: ${id}`);
  return s;
}
