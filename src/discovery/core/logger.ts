/**
 * Minimal Logger interface. Carried on the DiscoveryContext so every module
 * has a single diagnostic channel. The default implementation routes to the
 * console; the future architecture (docs/discovery/03-modules.md §2.3) will
 * swap in a scoped, file-writing logger without changing call sites.
 *
 * Milestone 0.5 only uses it where the PoC already used `console.error`
 * (relocation, not new output). It is otherwise carried for future modules.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};
