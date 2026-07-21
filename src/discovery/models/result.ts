/**
 * Output shapes — what becomes `artifacts/discovery/discovery.json`.
 *
 * These are intentionally simple "raw discovery" shapes. They are NOT the
 * ReplayQA Application Model (RAM) described in docs/discovery/05-ram.md.
 */

export interface InputInfo {
  name?: string;
  type: string;
}

export interface FormInfo {
  fields: string[];
  submit?: string;
}

export interface TableInfo {
  headers: string[];
  rowCount: number;
}

export interface DiscoveredPage {
  id: string;
  title: string;
  url: string;
  buttons: string[];
  links: string[];
  forms: FormInfo[];
  tables: TableInfo[];
  inputs: InputInfo[];
}

export interface DiscoveryResult {
  application: { url: string };
  pages: DiscoveredPage[];
}
