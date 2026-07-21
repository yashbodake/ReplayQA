/**
 * Selector — the runner-agnostic way callers express "which element".
 *
 * The BrowserController is the only module permitted to touch Playwright, so
 * callers cannot hand it Playwright `Locator` objects. A `Selector` is a small
 * declarative descriptor the controller resolves to a Playwright locator
 * internally:
 *   - a CSS string, or
 *   - an accessible-role descriptor `{ role, name? }` (preferred, stable).
 *
 * Mirrors the `Locator` abstraction in docs/discovery/05-ram.md §3.2 — the
 * model never embeds Playwright code, and neither do callers of the controller.
 */
export type Selector =
  | string
  | { role: string; name?: RegExp | string };

/**
 * A visible action button on the page, with the label to display/audit and the
 * Selector to drive it. Produced by `BrowserController.currentActions()` and
 * consumed by the Action Probe runner.
 */
export interface ActionCandidate {
  label: string;
  selector: Selector;
}
