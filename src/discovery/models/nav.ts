/**
 * A visible same-origin anchor worth considering for navigation.
 *
 * Produced by the BrowserController's `currentNavLinks()`: the controller is
 * responsible for the raw gathering + same-origin/non-navigable filtering
 * (mailto/tel/javascript). Exploration policy (e.g. skipping logout) is
 * applied by the caller, not by the controller.
 */
export interface NavLink {
  /** Link text or aria-label. */
  text: string;
  /** Absolute href as resolved by the browser. */
  href: string;
  /** pathname + search, used as the visit/dedup key. */
  path: string;
}
