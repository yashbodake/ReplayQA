import type { DiscoveredPage } from '../models/result.js';
import type { State } from '../models/state.js';
import { dedupe, deriveLabel } from './labels.js';

/**
 * Pure transform: State → DiscoveredPage (the output shape that becomes
 * `discovery.json`). Applies label derivation and dedup. Has no dependency on
 * the browser.
 *
 * Capturing a State (materials + snapshot + stateId) is now the StateManager's
 * job (`src/discovery/state/manager.ts`); this module only shapes the State
 * for human/output consumption.
 */
export function toDiscoveredPage(state: State, index: number): DiscoveredPage {
  const { snapshot, url } = state;
  return {
    id: `page-${index}`,
    title: deriveLabel(snapshot, url),
    url,
    buttons: dedupe(snapshot.buttons),
    links: dedupe(snapshot.links),
    forms: snapshot.forms,
    tables: snapshot.tables,
    inputs: snapshot.inputs,
  };
}
