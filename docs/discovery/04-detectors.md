# 04 — Detectors

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`, `02-pipeline.md`, `03-modules.md`.

This document specifies the **detector subsystem**: the common contract every detector obeys, the manager that runs them, the correlation rules that resolve overlaps, and the per-detector designs for the eight detectors shipped in v1 — **Login, Table, Form, CRUD, Search, Navigation, Modal, Toast**.

Interface sketches are **language-neutral pseudocode** (not TypeScript, not an implementation).

---

## 1. Design principles for detectors

1. **Pure observers.** A detector reads a `State` and emits `Findings`. It never navigates, never clicks, never mutates, never imports Playwright. (See `03-modules.md` invariant: a grep for `playwright` under `src/discovery/detectors/` is a build violation.)
2. **Idempotent.** Running a detector twice on the same `State` yields the same findings. This makes them trivially cacheable and testable.
3. **Time-boxed.** Each detector declares a `runCost` and is bounded by a per-detector timeout enforced by the manager. A slow detector never blocks the loop.
4. **Confidence-bearing.** Every finding carries a `confidence ∈ [0,1]` and an `evidence` list (the signals that produced it). Low-confidence findings are kept in the model only if config requests them; they never block downstream stages.
5. **Composable, not greedy.** Detectors declare the *kinds* of things they recognize. They do not decide what the model *means*. Meaning (e.g. "this form creates a Contact") is resolved later by the RAM Builder, which correlates detector findings with each other and with network evidence.
6. **Pluggable.** Adding a detector (e.g. a future `ChartDetector`) requires no changes to any other module — only registration with the Detector Manager.

---

## 2. Common contract

### 2.1 Detector interface (pseudocode)

```
Detector {
  id:           string               // stable, unique, e.g. "table"
  findingTypes: FindingType[]        // what this detector can emit
  priority:     number               // lower runs first; used for correlation
  runCost:      "cheap" | "expensive"// scheduling hint (cheap → parallel-safe)

  detect(state: State, ctx: DetectorContext) → Finding[]
}
```

### 2.2 Finding shape (shared by all detectors)

```
Finding {
  findingId:   string               // stable hash of (detectorId, stateId, key)
  detectorId:  string
  findingType: FindingType
  stateId:     string                // which State this was observed in
  confidence:  number                // 0..1
  evidence:    Evidence[]            // the concrete signals that fired
  locator?:    string                // stable locator of the primary element
  refs?:       Ref[]                 // links to other findings/entities (resolved by RAM Builder)
  payload:     object                // detector-specific structured data
}

Evidence {
  kind:   "role" | "tag" | "attr" | "text" | "url" | "network" | "aria" | "computed"
  value:  string
  weight: number                     // contribution to confidence
}
```

Findings are the *only* data a detector produces. They are emitted onto the Event Bus as typed events (`FormDetected`, `TableDetected`, … — see `07-events.md`), consumed by the RAM Builder and the Navigation Explorer.

### 2.3 DetectorContext (pseudocode)

A small read-only handle given to every detector at run time, so detectors never need to import engine internals:

```
DetectorContext {
  config:       DiscoveryConfig     // thresholds, enabled flags
  url:          string              // current canonical URL
  routeSignature: string            // path template
  network:      NetworkObservation[]// recent XHR/fetch (method, urlTemplate, status)
  a11y:         A11yNode             // pruned a11y tree root
  dom:          DomSnapshot          // serialized DOM (fallback signal)
  interactive:  ElementRef[]         // visible interactive elements
  logger:       ScopedLogger
}
```

### 2.4 Confidence model

Confidence is a function of weighted evidence, clamped to `[0,1]`:

```
confidence = clamp( Σ evidence.weight , 0, 1 )
```

Each detector documents its evidence weights (see per-detector tables). The model-wide threshold for "promoted to RAM" is configurable (`discovery.detectors.minConfidence`, default `0.5`); below-threshold findings survive in `states/*.json` for review but are not promoted.

---

## 3. Detector Manager

**Responsibilities**

- Hold the registry of enabled detectors, ordered by `priority`.
- For each new `State`, dispatch detectors. Cheap, independent detectors run concurrently; expensive ones run after cheap ones finish (so a cheap positive signal can skip an expensive one if configured).
- Enforce per-detector timeouts; a timed-out detector emits no findings and logs a warning.
- **Correlate** overlapping findings (§4) before publishing.
- Publish findings on the Event Bus.

**Non-responsibilities**

- Does not decide what the model means (that is the RAM Builder's job).
- Does not enqueue actions (that is the Navigation Explorer's job; detectors only *suggest* candidate actions inside `payload`).

**Scheduling example for a single state**

```
Phase 1 (cheap, parallel):
   NavigationDetector, ModalDetector, ToastDetector, SearchDetector
Phase 2 (cheap-to-mid, parallel):
   FormDetector, TableDetector, LoginDetector
Phase 3 (correlator, depends on Phase 1+2):
   CRUDDetector             (consumes Form/Table/Login/Search findings)
```

CRUDDetector is intentionally last and consumes other detectors' findings — CRUD is a *correlation* over lower-level signals, not a primary signal.

---

## 4. Correlation rules (overlap resolution)

A single DOM region frequently satisfies multiple detectors (a login form is both a `Form` and a `Login`; a table row's "Edit" button is both a `Navigation` action and part of a `CRUDAction`). Rather than dropping duplicates or emitting conflicting entities, the manager applies these rules:

| Overlap | Rule |
|---------|------|
| `Login` ⊂ `Form` | The form is tagged as `kind=login` in its payload; the LoginDetector's finding is the *authoritative* semantic; the generic Form survives as structural detail. |
| `Form` ↔ `CRUDAction(create/update)` | The CRUD action references the Form by `findingId`; both persist. |
| `Table` ↔ `CRUDAction(read)` | A Read action references the Table; both persist. |
| `Navigation` action ↔ `CRUDAction` trigger | If a navigation trigger is part of a CRUD action (e.g. "Add New" opens a form), the CRUD action claims it; the Navigation finding is marked `role=secondary`. |
| `Modal` ↔ `Form` inside it | The Form's payload gains `container=modal`; the Modal finding references the Form. |
| `Toast` after action | Toasts are not promoted at detection time; they are *captured* by the Browser Controller after an action and correlated by the RAM Builder to the action that caused them. |

Correlation is identity-based (via `findingId` and `refs`) and deterministic. The RAM Builder never has to guess which finding is which.

---

## 5. Non-approaches (explicit)

Before the per-detector designs, the following are **deliberately not used** as detection strategies:

- **Playwright `codegen`.** It records human interactions into tests. It does not produce semantic models, it does not explore autonomously, and it emits Playwright-specific code (which would couple the model to a single runner). Discovery emits a runner-agnostic model.
- **Computer vision / screenshot classification.** Pixels are high-variance and brittle across theme, locale, and viewport. DOM + a11y + network are far more stable for CRUD semantics. Screenshots remain an *artifact*, never a *signal*.
- **LLM-based detection in the loop.** Detectors are deterministic. This keeps discovery fast, cheap, reproducible, and offline-capable. LLMs are consumers of the resulting RAM, not part of producing it.
- **Full XPath matching against app-specific markup.** Detectors must generalize across PhoneBook, Todo, Inventory, etc. App-specific locators belong only in the emitted `locator` field, not in detection logic.

---

## 6. Per-detector designs

The eight subsections below each specify: **Input · Output · Detection strategy · Success criteria**.

For every detector, *Input* is `(State, DetectorContext)` as defined in §2.3. *Output* is a list of Findings of the declared type, each conforming to §2.2. To avoid repetition, only the **payload** and **evidence weights** are documented per detector.

---

### 6.1 LoginDetector

**Purpose:** Identify authentication surfaces — login, registration, password reset, and OAuth entry points — and structure them as an `AuthFlow`.

| Aspect | Detail |
|--------|--------|
| `id` | `login` |
| `findingTypes` | `AuthenticationDetected` |
| `priority` | 20 (Phase 2) |
| `runCost` | cheap |

**Output payload (`AuthenticationDetected`)**

```
{
  flow:       "login" | "register" | "password-reset" | "oauth",
  fields:     [ { locator, type: "email"|"password"|"text"|"otp", name, required } ],
  submit:     { locator, label },
  oauth:      [ { provider: "google"|"github"|..., locator } ],     // if present
  trustSignals: [ "https" , "terms-link", "password-visibility-toggle" ],
  candidateAction: { kind: "submit", locator, safety: "write-reversible" }
}
```

**Detection strategy**

- **URL signals** (`weight 0.25`): canonical path matches `/login`, `/signin`, `/register`, `/signup`, `/auth`, `/reset`, `/forgot`.
- **Field signals** (`weight 0.35`): presence of an `input[type=password]`; presence of `input[type=email]` or a text input labeled `username/email`; an OTP/single-use-code field.
- **Submit signals** (`weight 0.15`): a submit button whose label matches the verb dictionary (`sign in`, `log in`, `register`, `sign up`, `reset password`).
- **OAuth signals** (`weight 0.15`): buttons containing provider hints (`data-provider`, `aria-label`, visible text, `href` to known OAuth hosts).
- **Trust signals** (`weight 0.10`): HTTPS, a link to Terms/Privacy, a password visibility toggle.

**Success criteria**

- A login flow is positively detected when `confidence ≥ 0.6` and a password field is present.
- A register flow is positively detected when `confidence ≥ 0.6`, a password field is present, *and* a confirm-password field or a terms checkbox is present, *or* the URL matches `/register|signup`.
- OAuth entry points are recorded separately (no password field required) at `confidence ≥ 0.4`.
- Negative: a logged-in page (presence of a "logout"/"sign out" control or a user avatar menu) suppresses this detector and instead annotates the state as `authenticated=true`.

---

### 6.2 TableDetector

**Purpose:** Identify tabular data displays — `<table>` lists, CSS grids, and repeated card/row structures — and extract their column schema and row count.

| Aspect | Detail |
|--------|--------|
| `id` | `table` |
| `findingTypes` | `TableDetected` |
| `priority` | 20 (Phase 2) |
| `runCost` | mid |

**Output payload (`TableDetected`)**

```
{
  variant:    "table" | "grid" | "list" | "cards",
  columns:    [ { name, locator, sortable?: bool } ],
  rows:       { count, sample: ElementRef, hasHeader: bool },
  pagination: { present: bool, type?: "page-numbers"|"load-more"|"infinite", locator? },
  rowActions: [ { locator, label, safety } ],   // per-row Edit/Delete buttons
  impliedEntity?: string                        // RAM Builder finalizes the entity binding
}
```

**Detection strategy**

- **Semantic table** (`weight 0.40`): a `<table>` with `<thead>`/`<tbody>`, or a node with `role=grid`/`role=treegrid`.
- **Repeated structure** (`weight 0.35`): three or more sibling elements with identical structural fingerprint (role + tag sequence) under a common `role=list`/`listbox`/`rowgroup` parent — covers card grids and Todo-style lists.
- **Header evidence** (`weight 0.15`): column names derivable from `<th>`, `role=columnheader`, `aria-labelledby`, or visible headings in the first row/card.
- **Pagination evidence** (`weight 0.10`): controls labeled `next/prev/page`, "load more" buttons, or infinite-scroll sentinel (`IntersectionObserver`-style markers detected via DOM/network activity).

**Success criteria**

- Promoted when `confidence ≥ 0.5` and at least one column name is derivable.
- A "table" with zero columns is demoted to a `list` and kept only if `rows.count ≥ 1`.
- Per-row action buttons are captured *as candidate actions* (handed to CRUDDetector), not executed.

---

### 6.3 FormDetector

**Purpose:** Identify data-entry forms (create/edit), extract their field schema, validation hints, and submit control.

| Aspect | Detail |
|--------|--------|
| `id` | `form` |
| `findingTypes` | `FormDetected` |
| `priority` | 20 (Phase 2) |
| `runCost` | mid |

**Output payload (`FormDetected`)**

```
{
  variant:   "create" | "edit" | "filter" | "generic",
  container: "page" | "modal" | "drawer",
  fields:    [ {
     locator, name, label, type: "text"|"email"|"password"|"number"|"date"
                           |"select"|"checkbox"|"radio"|"textarea"|"file",
     required, options?: string[], validation?: [ "required","email","minlen","pattern" ]
  } ],
  submit:    { locator, label },
  cancel?:   { locator, label },
  prefilledValues?: object,           // present if variant=edit (read-only capture)
  candidateAction: { kind: "submit", locator, safety }
}
```

**Detection strategy**

- **Container** (`weight 0.30`): a `<form>` element, or a grouping with `role=form`/`aria-labelledby`, or a modal/drawer containing multiple inputs.
- **Field cluster** (`weight 0.35`): two or more labeled inputs inside the same container (a single search input is *not* a form — that is SearchDetector's domain).
- **Labels** (`weight 0.20`): each input's label derivable from `<label for>`, `aria-label`, `aria-labelledby`, preceding sibling text, or `placeholder`.
- **Validation hints** (`weight 0.10`): `required`, `type=email`, `pattern`, `minlength`, native constraint attributes.
- **Submit control** (`weight 0.05`): a `button[type=submit]` or any button whose label matches the verb dictionary.

**Variant inference**

- `edit`: any field is prefilled with a non-empty value at capture time, *or* the route signature contains `/:id/edit` or `/:id` with a form present.
- `filter`: container appears adjacent to a table and contains only selects/checkboxes/text inputs with no create-style submit label.
- `create`: default when none of the above apply.
- `generic`: fallback when confidence on variant is low.

**Success criteria**

- Promoted when `confidence ≥ 0.5` and at least one labeled field and a submit control are identified.
- A login form is detected here *as a form* and also by LoginDetector; correlation (§4) tags it `variant=login` and lets the Login finding take semantic precedence.

---

### 6.4 CRUDDetector

**Purpose:** The synthesizer. Correlate Forms, Tables, buttons, and network observations into **CRUD actions bound to an Entity**. This is the detector that turns "there is a form and a table" into "this app manages Contacts with full CRUD".

| Aspect | Detail |
|--------|--------|
| `id` | `crud` |
| `findingTypes` | `CrudDetected` |
| `priority` | 40 (Phase 3 — runs after Forms/Tables) |
| `runCost` | mid |

**Output payload (`CrudDetected`)**

```
{
  entity:     { name: "Contact", plural: "Contacts", confidence },
  operations: {
     create: { entry: { locator, label }, formFindingId?, targetStateId? },
     read:   { tableFindingId?, entryStateId },
     update: { entry: { locator, label }, formFindingId?, targetStateId? },
     delete: { entry: { locator, label }, confirmLocator?, destructive: true }
  },
  coverage:   ["create","read","update","delete"]    // subset present
}
```

**Detection strategy**

CRUDDetector consumes lower-level findings plus network observations:

- **Verb dictionary** (`weight 0.30`): button/link labels mapped to operations via a synonym table.
  - Create: `add`, `create`, `new`, `+`, `add new`, `add contact/todo/…`
  - Update: `edit`, `update`, `modify`, `save changes`, pencil-icon `aria-label`
  - Delete: `delete`, `remove`, `trash`, `discard`
  - Read: implied by any `Table`/`list` finding (no button needed).
- **Form correlation** (`weight 0.25`): a `create`-variant Form within click-reach of a Create entry ⇒ `create` op; an `edit`-variant Form reachable from a row Edit button ⇒ `update` op.
- **Network correlation** (`weight 0.30`): observed XHR/fetch mapped by method + URL template:
  - `POST   /api/<entity>`         ⇒ create
  - `GET    /api/<entity>(/:id)?`  ⇒ read
  - `PUT/PATCH /api/<entity>/:id`  ⇒ update
  - `DELETE /api/<entity>/:id`     ⇒ delete
  The URL-template → entity-name inference is the strongest single signal for naming the `Entity`.
- **Entity naming** (`weight 0.15`): resolved by precedence — REST resource in network URL (highest) → table column-header noun → form section heading → route segment.

**Success criteria**

- An `Entity` is promoted when at least **two** of {create, read, update, delete} are present *and* at least one of them is corroborated by a network call. A single button labeled "Add" with no network evidence is recorded as a *candidate* entity with low confidence, not promoted.
- `delete` operations are always marked `destructive: true` and **never executed** during discovery (see `06-exploration.md` §"Action safety"). Their existence is inferred from button presence and/or a `DELETE` network call observed when *the app's own UI* was triggered by a safe probe — never triggered by Discovery itself.
- `coverage` is what the Reporter renders as the CRUD coverage grid.

> **Build vs. buy (verb matching):** A small, curated synonym table is deterministic, debuggable, and tailored to CRUD apps. A fuzzy library (`fuse.js`) would add a dependency and non-determinism (rank ordering) for negligible benefit at this vocabulary size. **Recommendation: hand-roll the synonym table.**

---

### 6.5 SearchDetector

**Purpose:** Identify search and filter controls and classify how they take effect (client-side filter, query-param, server-side XHR).

| Aspect | Detail |
|--------|--------|
| `id` | `search` |
| `findingTypes` | `SearchDetected` |
| `priority` | 10 (Phase 1) |
| `runCost` | cheap |

**Output payload (`SearchDetected`)**

```
{
  control:    { locator, type: "text"|"select"|"checkbox-group", placeholder?, label? },
  scope:      "global" | "table-local",
  mechanism:  "client-filter" | "query-param" | "server-xhr",
  targetEntity?: string,
  candidateAction: { kind: "type", locator, safety: "read", probeValue? }
}
```

**Detection strategy**

- **Role/attribute** (`weight 0.35`): `input[type=search]`, `role=searchbox`, `aria-label` containing `search`/`filter`, or `input[placeholder]` matching the verb dictionary (`search`, `filter`, `find`).
- **Placement** (`weight 0.20`): `scope=global` when inside a `role=search` landmark or top nav; `scope=table-local` when immediately preceding a Table finding.
- **Mechanism inference** (`weight 0.45`, decided by Browser Controller observation, not the detector's own DOM look):
  - `query-param`: typing changes the URL query (e.g. `?q=`).
  - `server-xhr`: typing triggers XHR/fetch to a search endpoint.
  - `client-filter`: typing changes only the DOM (row count shrinks) with no network.

  *Note:* the mechanism verdict requires a safe probe (typing a benign value and observing). Probes are governed by Action Safety; see `06-exploration.md`.

**Success criteria**

- Promoted at `confidence ≥ 0.5`.
- `mechanism` is left `unknown` (finding not promoted, but kept for review) if the probe could not be performed safely.

---

### 6.6 NavigationDetector

**Purpose:** Map the application's navigation structure: primary nav, sidebars, tabs, breadcrumbs — the skeleton of the page graph.

| Aspect | Detail |
|--------|--------|
| `id` | `navigation` |
| `findingTypes` | `NavigationFound` |
| `priority` | 10 (Phase 1) |
| `runCost` | cheap |

**Output payload (`NavigationFound`)**

```
{
  landmark: "primary-nav" | "sidebar" | "tabs" | "breadcrumb" | "footer",
  items:    [ { locator, label, target?: url | routeSignature, active?: bool } ]
}
```

**Detection strategy**

- **Landmarks** (`weight 0.40`): `<nav>`, `role=navigation`, `aria-label`/`aria-labelledby` naming a region (`Main`, `Primary`, `Breadcrumbs`, `Tabs`, `Sidebar`).
- **Tabs** (`weight 0.30`): `role=tablist` with `role=tab` children, or ARIA `aria-selected` patterns.
- **Breadcrumbs** (`weight 0.20`): `<ol>`/`<ul>` inside a `nav[aria-label=Breadcrumb]`, or schema.org `BreadcrumbList`.
- **Active state** (`weight 0.10`): `aria-current=page`, `aria-selected=true`, or an `active` class on an item.

**Success criteria**

- Promoted at `confidence ≥ 0.5` with at least one item.
- Each item's `target` is computed via the same canonicalization used by the State Manager, so nav items deduplicate cleanly against discovered pages.

---

### 6.7 ModalDetector

**Purpose:** Detect modal dialogs and drawers that overlay primary content — common hosts for create/edit forms and confirm dialogs in CRUD apps.

| Aspect | Detail |
|--------|--------|
| `id` | `modal` |
| `findingTypes` | `ModalDetected` |
| `priority` | 10 (Phase 1) |
| `runCost` | cheap |

**Output payload (`ModalDetected`)**

```
{
  variant:   "dialog" | "drawer" | "confirm",
  role:      "dialog" | "alertdialog",
  title?:    string,
  trigger?:  { locator, label },                 // the button that opened it (correlated)
  dismissible: bool,
  dismiss?:  { locator, label },                 // close button / overlay click / Esc
  contains:  [ findingId[] ]                     // forms/toasts found within
}
```

**Detection strategy**

- **Semantics** (`weight 0.45`): `role=dialog`, `role=alertdialog`, `aria-modal=true`.
- **Overlay** (`weight 0.25`): a fixed/absolute layer covering the viewport with a higher stacking context than content (computed style signal).
- **Focus trap** (`weight 0.15`): focus moved into the container on open; `Esc` handler present (inferred from keydown listeners is *not* required — Esc dismissal is verified only if a safe probe occurs).
- **Confirm pattern** (`weight 0.15`): an `alertdialog` with two buttons whose labels match `{confirm}` × `{cancel}` dictionaries (e.g. `Delete` / `Cancel`) ⇒ `variant=confirm`.

**Success criteria**

- Promoted at `confidence ≥ 0.5`.
- Confirm dialogs are especially important: they are the safety gate for destructive CRUD operations in the future Test Generator, so their `dismiss` control is captured even at lower confidence.

---

### 6.8 ToastDetector

**Purpose:** Capture transient feedback messages (success/error toasts, banners, snackbars) that appear *after* an action. Unlike other detectors, ToastDetector is **event-driven**, not state-scanned: it listens for elements that *enter* the DOM after an action is performed.

| Aspect | Detail |
|--------|--------|
| `id` | `toast` |
| `findingTypes` | `ToastDetected` |
| `priority` | 10 (Phase 1, but reactive) |
| `runCost` | cheap |

**Output payload (`ToastDetected`)**

```
{
  variant:    "success" | "error" | "warning" | "info",
  role:       "status" | "alert" | "log" | "(none)",
  message:    string,                       // truncated, redacted
  triggerActionId?: string,                 // correlated by Browser Controller
  duration?:  number                        // observed visible time, ms
}
```

**Detection strategy**

- **Live regions** (`weight 0.40`): elements with `role=status`, `role=alert`, `role=log`, or `aria-live=polite|assertive` that were *not* present before the last action.
- **Transient insertion** (`weight 0.35`): an element added to a known toast container (`[class*=toast]`, `[class*=snackbar]`, `[class*=notification]`) within a short window (default `1500ms`) after an action.
- **Auto-dismiss** (`weight 0.15`): the element disappears without further interaction (distinguishing a toast from a persistent banner).
- **Variant cues** (`weight 0.10`): class/attribute hints (`success`, `error`, `danger`, `warning`) or an icon with a matching `aria-label`.

**Success criteria**

- Promoted when a live-region *or* transient-insertion signal fires with `confidence ≥ 0.4`.
- The Browser Controller tags every toast with the `triggerActionId` of the action that preceded it, so the RAM Builder can attach success/error feedback to the relevant CRUD operation — this is what later lets the Test Generator assert "after Create, a success toast appears".

---

## 7. Detector registry and ordering (v1 default)

| Priority | Detector | Phase | Depends on |
|----------|----------|-------|------------|
| 10 | NavigationDetector | 1 | — |
| 10 | ModalDetector | 1 | — |
| 10 | SearchDetector | 1 | — |
| 10 | ToastDetector | 1 (reactive) | action events |
| 20 | FormDetector | 2 | Modal (for container tagging) |
| 20 | TableDetector | 2 | — |
| 20 | LoginDetector | 2 | Form (shares field evidence) |
| 40 | CRUDDetector | 3 | Form, Table, Login, Search, Network |

This ordering is the default; every entry is configurable via `discovery.detectors.<id>.{enabled,priority,minConfidence}`.

---

## 8. Adding a new detector (recipe)

1. Pick a stable `id` and one or more `FindingType`s. Add them to the event catalog (`07-events.md`) and the RAM schema (`05-ram.md`) if they introduce new model objects.
2. Implement `detect(state, ctx) → Finding[]` as a pure function under `src/discovery/detectors/<id>/`.
3. Declare `priority`, `runCost`, evidence weights, and any correlation rules.
4. Register with the Detector Manager (one line) and add a unit test fixture (a captured `State` + expected findings).
5. If the finding should be explorable (e.g. a candidate action), expose it in `payload.candidateAction`; the Navigation Explorer will pick it up automatically.

No other module changes required. This locality is the property that makes the detector set safely extensible by multiple engineers in parallel.
