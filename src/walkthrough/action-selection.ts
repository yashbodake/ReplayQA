import { classifyAction } from '../discovery/probes/vocabulary.js';
import { isLogoutLabel } from '../discovery/collector/index.js';
import type { ActionCandidate } from '../discovery/browser/selector.js';
import type { RawSnapshot } from '../discovery/models/snapshot.js';

export function isSearchInput(label: string): boolean {
  return /search|filter|query|^q$/i.test(label);
}

export function isMenuToggle(label: string): boolean {
  return /^(open|close)\s*menu$|^menu$/i.test(label);
}

export function isFlowAction(label: string): boolean {
  if (/\badd\b/i.test(label)) return false;
  return /cart|checkout|continue|view (?:your )?cart|shopping|order|proceed|finish|complete/i.test(label);
}

export function findNextAction(
  actions: ActionCandidate[],
  tried: Set<string>,
  lastObsSignature: string,
  repeatCount: number,
): ActionCandidate | undefined {
  const isRepeating = repeatCount >= 2 && lastObsSignature.length > 0;

  // Priority 1: primary action buttons (Add, Create, New, Submit, Save).
  const primary = actions.find((a) => {
    if (a.type === 'input' || tried.has(a.label.toLowerCase())) return false;
    if (isLogoutLabel(a.label)) return false;
    if (isMenuToggle(a.label)) return false;
    const v = classifyAction(a.label);
    return v.classification === 'probe' || /add|create|new|submit|save/i.test(a.label);
  });
  if (primary) return primary;

  // Priority 2: flow-advancing actions (cart, checkout, continue, finish).
  const flow = actions.find((a) => {
    if (a.type === 'input' || tried.has(a.label.toLowerCase())) return false;
    if (isLogoutLabel(a.label)) return false;
    return isFlowAction(a.label);
  });
  if (flow) return flow;

  // Priority 3: search/filter inputs.
  const search = actions.find(
    (a) => a.type === 'input' && isSearchInput(a.label) && !tried.has(a.label.toLowerCase()),
  );
  if (search) return search;

  // Priority 4: nav links / cards — skip if stuck in a repeat loop.
  if (isRepeating) return undefined;

  const nav = actions.find((a) => {
    if (a.type === 'input' || tried.has(a.label.toLowerCase())) return false;
    if (isLogoutLabel(a.label)) return false;
    const v = classifyAction(a.label);
    return v.classification !== 'destructive' && a.type !== 'button';
  });
  return nav;
}

export function pickSearchValue(_snap: RawSnapshot | undefined, actions: ActionCandidate[]): string {
  for (const a of actions) {
    if (a.type === 'button' || a.type === 'card') {
      const word = a.label.match(/^([A-Za-z]{3,})/);
      if (word) return word[1];
    }
  }
  return 'test';
}

export function sampleValueFor(label: string, _trigger: string): string | undefined {
  const l = label.toLowerCase();
  if (/password|secret/.test(l)) return undefined;
  if (/email/.test(l)) return 'demo@example.com';
  if (/phone|mobile|tel/.test(l)) return '555' + Date.now().toString().slice(-7);
  if (/name|user|first|last|full/.test(l)) return 'Demo ' + Date.now().toString().slice(-5);
  if (/address|street/.test(l)) return '123 Demo Street';
  if (/todo|task|item|note|text|comment|message/.test(l)) return 'Demo item ' + Date.now().toString().slice(-5);
  if (/search|filter|query/.test(l)) return 'demo';
  if (/zip|postal/.test(l)) return '12345';
  if (/quantity|qty|count|number/.test(l)) return '2';
  if (/\d{3,}|@/.test(label)) return label;
  return 'Demo Value';
}
