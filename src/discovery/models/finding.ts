/**
 * The Finding model — a single observation extracted from one State by a
 * Detector. Findings are the inputs the future RAM Builder consumes; they are
 * deliberately NOT the RAM (docs/discovery/05-ram.md) and not the application
 * model. They are raw, evidence-bearing observations.
 *
 * Design (docs/discovery/04-detectors.md §2):
 *   - A Finding is a discriminated union on `type`. Each category narrows the
 *     `payload` to a strongly-typed shape.
 *   - Every finding carries stable identity (`id`, `stateId`, `detectorId`),
 *     a confidence score, and the evidence that produced it — so any consumer
 *     (RAM Builder, Reporter, a human reviewer) can audit why a finding exists.
 *   - Categories are aligned with the documented detectors' payloads so a
 *     future real detector fills the same shape the RAM Builder expects.
 */

/** Where a piece of evidence came from. */
export type EvidenceKind =
  | 'role'
  | 'tag'
  | 'attr'
  | 'text'
  | 'url'
  | 'network'
  | 'aria'
  | 'computed';

/** A single signal that contributed to a finding. */
export interface Evidence {
  kind: EvidenceKind;
  /** The observed value (a role name, a tag, an attribute value, a URL…). */
  value: string;
  /** This signal's contribution to the finding's confidence (0..1). */
  weight: number;
}

/** Generic, type-stable metadata carried by every finding. */
export interface FindingMetadata {
  /** ISO-8601 capture timestamp. */
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Type-specific payloads (one per category). Aligned with 04-detectors.md.
// ---------------------------------------------------------------------------

export interface AuthenticationPayload {
  flow: 'login' | 'register' | 'password-reset' | 'oauth';
  fields: AuthenticationField[];
  submit?: { locator?: string; label?: string };
  oauthProviders?: string[];
}

export interface AuthenticationField {
  locator?: string;
  type: 'email' | 'password' | 'text' | 'otp';
  name?: string;
  required?: boolean;
}

export interface TablePayload {
  variant: 'table' | 'grid' | 'list' | 'cards';
  columns: { name: string; locator?: string; sortable?: boolean }[];
  rowCount: number;
  pagination?: {
    present: boolean;
    type?: 'page-numbers' | 'load-more' | 'infinite';
    locator?: string;
  };
}

export interface FormPayload {
  variant: 'create' | 'edit' | 'filter' | 'generic';
  container: 'page' | 'modal' | 'drawer';
  fields: FormField[];
  submit?: { locator?: string; label?: string };
  cancel?: { locator?: string; label?: string };
}

export interface FormField {
  locator?: string;
  name?: string;
  label?: string;
  type:
    | 'text'
    | 'email'
    | 'password'
    | 'number'
    | 'date'
    | 'select'
    | 'checkbox'
    | 'radio'
    | 'textarea'
    | 'file'
    | 'unknown';
  required?: boolean;
  options?: string[];
  validation?: string[];
}

export interface SearchPayload {
  control: { locator?: string; type: 'text' | 'select' | 'checkbox-group' };
  scope: 'global' | 'table-local';
  mechanism: 'client-filter' | 'query-param' | 'server-xhr' | 'unknown';
  targetEntity?: string;
}

export interface NavigationPayload {
  landmark: 'primary-nav' | 'sidebar' | 'tabs' | 'breadcrumb' | 'footer';
  items: { locator?: string; label: string; target?: string; active?: boolean }[];
}

// ---------------------------------------------------------------------------
// Finding discriminator + categories
// ---------------------------------------------------------------------------

/** The set of finding categories implemented in this milestone. */
export type FindingType =
  | 'authentication'
  | 'table'
  | 'form'
  | 'search'
  | 'navigation';

/** Fields shared by every finding regardless of category. */
export interface FindingBase {
  /** Stable, deterministic id (hash of detectorId + stateId + key). */
  id: string;
  /** Id of the detector that produced this finding. */
  detectorId: string;
  /** The State this finding was extracted from. */
  stateId: string;
  /** Aggregate confidence in the finding, 0..1. */
  confidence: number;
  /** The signals that produced this finding (auditable). */
  evidence: Evidence[];
  /** Generic capture metadata. */
  metadata: FindingMetadata;
}

export interface AuthenticationFinding extends FindingBase {
  type: 'authentication';
  payload: AuthenticationPayload;
}

export interface TableFinding extends FindingBase {
  type: 'table';
  payload: TablePayload;
}

export interface FormFinding extends FindingBase {
  type: 'form';
  payload: FormPayload;
}

export interface SearchFinding extends FindingBase {
  type: 'search';
  payload: SearchPayload;
}

export interface NavigationFinding extends FindingBase {
  type: 'navigation';
  payload: NavigationPayload;
}

/**
 * A Finding. Narrow with `finding.type` to access the typed payload, e.g.
 *   if (finding.type === 'form') { finding.payload.fields … }
 *
 * Adding a category (future: Modal, Toast, CRUD) = add an interface, a union
 * member, and a FindingType value. Nothing else in the framework changes.
 */
export type Finding =
  | AuthenticationFinding
  | TableFinding
  | FormFinding
  | SearchFinding
  | NavigationFinding;
