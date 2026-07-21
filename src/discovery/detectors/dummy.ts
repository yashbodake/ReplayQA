import type { Detector } from './types.js';
import type { Finding, NavigationFinding } from '../models/finding.js';
import type { State } from '../models/state.js';
import { findingId } from './id.js';

/**
 * A placeholder detector that always emits one sample NavigationFinding. It
 * exists ONLY so the findings pipeline (DetectorManager → aggregation →
 * persistence) can be exercised end-to-end before any real detector exists.
 *
 * It is explicitly not detection logic: the payload is a constant. Real
 * detectors (LoginDetector, FormDetector, … per docs/discovery/04-detectors.md)
 * replace this without changing the framework.
 */
export class DummyDetector implements Detector {
  readonly id = 'dummy';

  async detect(state: State): Promise<Finding[]> {
    const finding: NavigationFinding = {
      id: findingId(this.id, state.id, 'sample'),
      detectorId: this.id,
      type: 'navigation',
      stateId: state.id,
      confidence: 0.5,
      evidence: [
        { kind: 'tag', value: 'dummy', weight: 0.5 },
      ],
      metadata: { capturedAt: new Date().toISOString() },
      payload: {
        landmark: 'primary-nav',
        items: [],
      },
    };
    return [finding];
  }
}
