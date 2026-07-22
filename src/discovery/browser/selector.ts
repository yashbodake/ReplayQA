/**
 * Selector — the runner-agnostic way callers express "which element".
 *
 * The BrowserController is the only module permitted to touch Playwright, so
 * callers cannot hand it Playwright `Locator` objects. A `Selector` is a small
 * declarative descriptor the controller resolves to a Playwright locator
 * internally.
 *
 * Supported forms:
 *   - a CSS string
 *   - an accessible-role descriptor `{ role, name? }` (preferred for buttons/links/tabs)
 *   - a placeholder descriptor `{ placeholder }` (for text inputs)
 *   - a label descriptor `{ label }` (for inputs with associated labels)
 */
export type Selector =
  | string
  | { role: string; name?: RegExp | string }
  | { placeholder: string }
  | { label: string };

/** The kind of interaction a candidate represents. */
export type InteractionType = 'button' | 'link' | 'input' | 'tab' | 'expander' | 'card';

/**
 * A visible interactive element on the page, with the label to display/audit
 * and the Selector to drive it. Produced by `BrowserController.currentActions()`
 * and consumed by the Action Probe runner.
 */
export interface ActionCandidate {
  label: string;
  selector: Selector;
  type: InteractionType;
}
