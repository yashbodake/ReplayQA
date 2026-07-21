import type { FormInfo, InputInfo, TableInfo } from './result.js';

/**
 * Raw, DOM-level observation of a page, produced by the BrowserController's
 * `currentSnapshot()`. This is NOT the semantic application model — it is the
 * verbatim output of a single in-page `evaluate`, before any interpretation.
 *
 * The future State Manager (docs/discovery/03-modules.md §3.3) will consume
 * this and add fingerprints/dedup. For Milestone 0.5 it is carried as-is.
 */
export interface RawSnapshot {
  /** First visible h1/h2 text, used as a label hint. Empty string if none. */
  heading: string;
  /** Whether any visible password input is present (login-page signal). */
  hasPassword: boolean;
  /** Visible button labels (not deduped). */
  buttons: string[];
  /** Visible link texts (not deduped). */
  links: string[];
  /** Visible forms with their field names and submit label. */
  forms: FormInfo[];
  /** Visible tables with headers and row count. */
  tables: TableInfo[];
  /** All visible inputs (not only those inside a form). */
  inputs: InputInfo[];
}
