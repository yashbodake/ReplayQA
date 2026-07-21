// Re-export from production so the lab hashes with the exact same primitive
// the StateManager ships. The lab must never drift from production.
export { fingerprintHash } from '../state/fingerprint.js';
