import { fingerprintHash } from '../state/fingerprint.js';

/**
 * Deterministic finding id: SHA-256 of `detectorId|stateId|key`, truncated to
 * 8 uppercase hex chars. Same inputs → same id, so re-running discovery against
 * the same app produces structurally equivalent findings (the same diffability
 * property State.id has). The `key` is detector-defined (e.g. a form's locator
 * or a table's position) so one detector can emit several distinct findings
 * per state without colliding.
 */
export function findingId(
  detectorId: string,
  stateId: string,
  key: string
): string {
  return fingerprintHash(`${detectorId}|${stateId}|${key}`);
}
