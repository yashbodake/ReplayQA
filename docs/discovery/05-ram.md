# 05 — ReplayQA Application Model (RAM)

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`..`04-detectors.md`.

This document defines the **ReplayQA Application Model (RAM)** — the single durable, machine-readable artifact a discovery run produces. It specifies the model's **objects, relationships, schema sketch, extensibility model, and versioning policy**. It does **not** contain an implementation; the JSON fragments here are schema illustrations, validated against the rules in §6.

The RAM is the contract between ReplayQA's exploration side (today) and its AI-generation side (future). Its stability matters more than its completeness.

---

## 1. Design goals

| Goal | How the design meets it |
|------|-------------------------|
| **Stable across app churn** | Objects key off semantic identity (entity name, route signature, stable locator), not raw DOM. |
| **Runner-agnostic** | The model never references Playwright APIs. Locators are an abstract `{role, name, fallback}` structure, not framework code. |
| **Versioned and evolvable** | Top-level `schemaVersion` + per-object `kind` allow additive evolution without breaking older consumers (§5). |
| **Extensible without forks** | An `extensions` namespace lets custom detectors attach data without modifying the core schema (§4). |
| **Validatable** | The model conforms to a JSON Schema (draft 2020-12). Validation is mandatory before `ram.json` is written (§6). |
| **Human-skimmable** | Names, labels, and confidence scores are first-class; the JSON reads top-down like a dossier of the app. |
| **Diff-friendly** | Stable IDs and sorted arrays make `git diff` between two runs of the same app meaningful for regression detection. |

---

## 2. Top-level shape

> **This document targets RAM `schemaVersion` 1.1.0.** The v1.0.0 → v1.1.0 change is **MINOR and additive** (optional `flows`, two named extension namespaces); any 1.0.0 consumer ignores the new keys and continues to work. See §5.1.

```
RAM {
  schemaVersion:  string        // semver of THIS schema; this doc targets "1.1.0"
  modelVersion:   string        // semver of the modelled app (bumped by reporter per app)
  generatedAt:    timestamp
  generator:      { name:"replayqa-discovery", version, runId }
  application:    Application
  pages:          Page[]
  entities:       Entity[]
  navigation:     Navigation
  flows?:         Flow[]         // first-class behavioral sequences (§3.2, 09-flows.md) — NEW in 1.1
  authFlow?:      AuthFlow       // convenience projection of flows[kind=auth]; source of truth is flows[]
  crudMatrix:     CrudMatrix     // entity × operation coverage grid
  states:         StateRef[]     // pointers into states/*.json
  graph:          string         // relative path to graph.json
  confidence:     { mean, min, histogram }   // overall model confidence
  extensions:     Extensions     // namespaced custom data; two blessed sub-schemas in 1.1 (§4.3)
}
```

`application`, `pages`, `entities`, `navigation`, `crudMatrix` are the **core** objects every consumer relies on. `flows`, `authFlow`, `extensions`, and confidence stats are optional or enriched.

`flows` is optional (a model may legitimately contain zero synthesized flows, e.g. if confidence fell below threshold). When `flows` is populated, the AuthFlow is also exposed at top-level as `authFlow` for ergonomic access by auth-only consumers — but `flows[]` is always the source of truth, and the builder guarantees the two never diverge.

---

## 3. Objects and relationships

### 3.1 Entity-relationship overview

```
                       ┌──────────────┐
                       │ Application  │
                       │  (1)         │
                       └──────┬───────┘
                              │ 1
              ┌───────────────┼────────────────┐
              │ n             │ n               │ n
       ┌──────▼─────┐   ┌─────▼──────┐   ┌──────▼──────┐
       │   Page     │   │  Entity    │   │ Navigation  │
       └──────┬─────┘   └─────┬──────┘   └─────────────┘
              │ n             │ 1
       ┌──────┴──────┐        │ n
       │             │        ├───────────────┐
  ┌────▼────┐  ┌─────▼───┐    │ n             │ n
  │Component│  │ Action  │ ┌──▼─────┐    ┌────▼─────┐
  │(Form,   │  │(CRUD,   │ │ Field  │    │CrudAction│
  │ Table,  │  │ nav,    │ └────────┘    └────┬─────┘
  │ Search, │  │ auth)   │                     │ 1
  │ Modal,  │  └────┬────┘                ┌────┴─────┐
  │ Toast)  │       │ n                   │ Form /   │
  └─────────┘       ▼                     │ Table /  │
                ┌──────────┐              │ Trigger  │
                │   Flow   │◀──cleanup─── └──────────┘
                │ (1)      │
                └────┬─────┘
                     │ n
                ┌────▼─────────┐
                │  FlowStep    │   (navigate/action/fill/assert/wait/subflow/observe)
                │  + Parameter │
                │  + Assertion │
                └──────────────┘
```

A `Flow` is an **ordered sequence of steps** that achieves a user-visible goal (login, create contact, search, …). Steps reference existing `Action`s by id (`kind=action`), call other `Flow`s (`kind=subflow`), or carry inline primitives (`fill`, `assert`, `wait`, `observe`). Flows are the unit the future AI Planner reasons about and the future Test Generator expands into concrete test code. Full Flow semantics live in `09-flows.md`.

### 3.2 Object catalog

Each object below lists its **fields**, **purpose**, and **key relationships**. Field types are informal (not TypeScript). `[ ]` denotes arrays, `?` denotes optional.

#### Application
The root descriptor of the discovered app.
```
Application {
  name            string         // from <title>, og:site_name, or URL host
  origin          string         // canonical origin, e.g. https://app.example.com
  description?    string         // from <meta name=description>
  appType         "crud"         // v1 is always crud; reserved for future types
  locale?         string
  techHints?      [string]       // e.g. ["vue","fastapi"] — best-effort, non-authoritative
}
```

#### Page
A discovered application screen/state-class. One Page can be backed by many concrete States (e.g. list-with-0-items vs list-with-5-items are the same Page).
```
Page {
  id              string         // stable hash of routeSignature + primary component
  routeSignature  string         // path template, e.g. "/contacts", "/contacts/:id/edit"
  url             string         // canonical exemplar URL
  title?          string
  requiresAuth    bool           // true if reachable only post-login
  components      [ComponentRef] // forms, tables, search, modals present here
  navItems        [NavItemRef]   // nav entries visible on this page
  stateRefs       [string]       // concrete stateIds (into states/*.json)
}
```

#### Entity
A logical data type the app manages (Contact, Todo, Employee, Note, …).
```
Entity {
  id              string         // stable hash of name (singular)
  name            string         // singular, normalized: "Contact"
  plural?         string         // "Contacts"
  fields          [Field]
  source          "rest" | "form" | "table" | "mixed"   // where we learned it
  confidence      number
  pages           [string]       // Page ids where this entity appears
}
```

#### Field
A single data attribute of an Entity.
```
Field {
  name            string         // machine name if derivable, else slug(label)
  label?          string         // human label
  type            "text"|"email"|"password"|"number"|"date"
                  |"select"|"checkbox"|"radio"|"textarea"|"file"|"unknown"
  required        bool
  options?        [string]       // for select/radio
  validation?     [string]       // ["required","email","minlen:8","pattern"]
  locator?        Locator        // stable, runner-agnostic
}
```

#### Locator (runner-agnostic)
The model NEVER embeds Playwright code. Locators are abstract:
```
Locator {
  primary   { role?: string, name?: string }   // a11y-based, preferred
  fallback  string                             // stable CSS or test-id, e.g. "[data-testid=add-contact]"
  hint?     string                             // human description
}
```
The future Test Generator translates a `Locator` into a concrete Playwright locator at generation time. This keeps the RAM decoupled from any runner.

#### Component (polymorphic via `kind`)
A semantic region on a Page. Discriminated by `kind`:
```
Component {
  kind      "form" | "table" | "search" | "modal" | "toast" | "navigation"
  id        string               // findingId of the detector that produced it
  pageId    string
  confidence number
  data      object               // kind-specific payload (see 04-detectors.md payloads)
}
```
`Component.data` for `kind=form` mirrors the `FormDetected` payload; for `kind=table`, the `TableDetected` payload; etc. This keeps the detector output and the RAM shape structurally identical — the RAM Builder is mostly a correlation + cross-reference pass, not a transformation.

#### Action
An interaction the user/app can perform, with a side effect on the state-graph.
```
Action {
  id          string
  kind        "crud" | "navigation" | "auth" | "search"
  trigger     { locator, label, safety: "read"|"write-reversible"|"destructive" }
  fromPageId  string
  toPageId?   string             // resolved when edge was traversed
  crudRef?    string             // → CrudAction id, when kind=crud
  feedback?   [ToastRef]         // toasts observed after performing this action
}
```

#### CrudAction
An entity-bound Create/Read/Update/Delete operation.
```
CrudAction {
  id          string
  entityId    string
  operation   "create" | "read" | "update" | "delete"
  trigger?    { locator, label }
  formId?     string             // → Component id of the form used (create/update)
  tableId?    string             // → Component id of the table (read)
  targetPageId? string           // page reached after the operation
  destructive bool               // always true for delete
  observedVia  [ "verb" | "form" | "network" ]   // which evidence contributed
  confidence  number
}
```

#### Navigation
The app's navigation skeleton, aggregated across pages.
```
Navigation {
  landmarks  [ { kind, pageIds:[string], items:[NavItem] } ]
}
NavItem {
  label       string
  targetPageId? string
  targetRoute?  string
  locator     Locator
}
```

#### Flow                          *(NEW in schema 1.1 — first-class)*
An ordered, named, reusable **sequence of steps** that achieves a user-visible goal. Flows are synthesized by the RAM Builder from discovered `Action`s, `CrudAction`s, observed feedback (toasts), and the state-graph — they are **not** emitted by a detector. Full semantics, step taxonomy, parameterization, and composition rules are specified in `09-flows.md`; this section defines the persisted shape only.
```
Flow {
  id            string                          // stable hash of (kind, entityId?, operation?, stepSignature)
  kind          "auth" | "crud" | "navigation" | "search" | "custom"
  name          string                          // human, e.g. "Create Contact", "Login"
  description?  string
  entityId?     string                          // → Entity, when kind=crud
  operation?    "create"|"read"|"update"|"delete"   // when kind=crud
  parameters?   [Parameter]                     // inputs the flow needs (templates; §09 §3)
  precondition? Precondition                    // required state before running
  steps         [FlowStep]                      // ordered; non-empty
  postcondition? Postcondition                  // expected state / feedback / data delta after
  produces?     [Binding]                       // outputs exposed to callers (e.g. createdContactId)
  confidence    number                          // 0..1, from evidence aggregation
  reliability?  number                          // observed success rate, 0..1, when known
  reversible?   bool                            // whether an undo/cleanup path exists
  cleanupFlowId? string                         // → Flow.id that reverses this one (e.g. delete-after-create)
  source        "synthesized" | "observed" | "imported"
}
```
`reversible=true` with a `cleanupFlowId` is the signal the future Test Generator uses to emit teardown (e.g. create-then-delete) so generated tests leave no residue.

#### FlowStep                      *(NEW in 1.1)*
A single step within a Flow. Discriminated by `kind`; each kind uses a different subset of fields.
```
FlowStep {
  id            string                          // stable within the flow; referenced by Bindings & onFailure
  kind          "navigate" | "action" | "fill" | "assert" | "wait" | "observe" | "subflow"
  ref?          string                          // → Action.id (kind=action) | Flow.id (kind=subflow)
  locator?      Locator                         // target element (kind=fill | observe | assert on element)
  value?        string | ParameterRef           // kind=fill: a literal or "${param.name}" reference
  assertion?    Assertion                       // kind=assert
  wait?         { for: "stable"|"selector"|"network"|"timeout", ms?: number, locator?: Locator }
  description?  string
  onFailure?    "abort" | "continue" | "recover:<stepId>"   // default "abort"
}
```
Step kinds are exhaustive in v1 (a new kind is a MINOR schema bump). The mapping to concrete runner code is the future Test Generator's job; the model never contains runner code.

#### Parameter, Binding, ParameterRef      *(NEW in 1.1 — data flow)*
```
Parameter {
  name          string                          // e.g. "contact.name"; referenced as ${contact.name}
  type          Field.type-like                 // "text"|"email"|"number"|...
  required      bool
  default?      string                          // sentinel probe value (disposable corpus; see 06-exploration.md §7.3)
  source?       "config" | "generated" | "runtime"
}
Binding {
  name          string                          // e.g. "createdContactId"
  from          string                          // stepId | locator producing the value
  scope         "flow" | "run"                  // available to subflows/siblings, or whole run
}
ParameterRef = "\${" <param.name> "}"           // resolves to the matching Parameter.default at plan time
```
Bindings are how a `create` flow exposes the id of the row it created so a downstream `update` or `delete` flow can reference it — the foundation for compositional multi-step tests.

#### Precondition / Postcondition / Assertion      *(NEW in 1.1)*
```
Precondition {
  requiresAuth?     bool
  requiredPageId?   string                      // must be on this page
  requiredStateId?  string                      // or this concrete state
  dataConstraints?  object                      // e.g. { "entity:contact": "non-empty" }
}
Postcondition {
  expectedPageId?      string
  expectedFeedback?    [ { variant: "success"|"error"|"warning"|"info", messagePattern?: string } ]
  expectedDataDelta?   object                   // e.g. { "entity:contact": "+1" } after a create
  expectedNetwork?     [ { method, urlTemplate, statusRange: [number,number] } ]
}
Assertion {
  kind      "visible" | "hidden" | "text" | "count" | "url" | "network"
  target    string                               // locator, urlTemplate, or entity ref
  op        "equals" | "contains" | "matches" | "gte" | "lte" | "exists"
  value?    string | number
}
```
These are **declarative**. They carry intent ("after Create, expect a success toast and +1 row") without dictating how to check it. This is what lets the same flow drive both a Playwright test and a human-readable test plan.

#### AuthFlow
Special first-class structure: the sequence to reach an authenticated session. **As of schema 1.1, `AuthFlow` is a typed projection of a `Flow` with `kind="auth"`** — kept as a top-level convenience for auth-only consumers, but no longer the source of truth.
```
AuthFlow {
  flowId          string                         // → Flow.id (kind=auth); source of truth
  loginPageId     string                         // mirrored for ergonomic access
  registerPageId? string
  fields          [Field]                        // credentials shape
  oauthProviders? [string]
  resultStateIds  { authenticated: string, anonymous: string }
}
```
The builder populates `authFlow` by projecting the auth Flow; the two are guaranteed consistent. Pre-1.1 consumers that read `authFlow` continue to work unchanged.

#### CrudMatrix
The headline coverage grid — what entities × operations the app supports.
```
CrudMatrix {
  rows  [ { entityId, create:bool, read:bool, update:bool, delete:bool } ]
  totals { create, read, update, delete }     // counts across entities
}
```

#### StateRef
Pointer into the raw `states/*.json` artifacts. Keeps the RAM itself compact.
```
StateRef {
  stateId     string
  pageId      string
  capturedAt  timestamp
  path        string             // relative, e.g. "states/<state-id>.json"
}
```

---

## 4. Extensibility

Two extensibility mechanisms, one for *custom data* and one for *custom object kinds*.

### 4.1 The `extensions` namespace (custom data, no schema change)

Any detector — including third-party or app-specific ones — can attach structured data without modifying the core schema:

```
extensions: {
  "<detector-id>": {
    schema: "https://example.com/my-extension/v1.json",
    data:   { ... arbitrary, detector-defined ... }
  }
}
```

Rules:

- Extensions are namespaced by detector id; collisions are a validation error.
- Each extension SHOULD declare its own JSON Schema URL for self-description.
- Core consumers (AI Planner, Test Generator) **must** tolerate unknown extensions gracefully (ignore-if-unknown).
- Extensions never override core objects; they augment.

### 4.2 New `Component.kind` values (additive schema evolution)

A new component type (e.g. `chart`, `kanban`) is added by:

1. Defining its `data` payload schema.
2. Registering a new `kind` enum value (additive — existing values untouched).
3. Registering a detector that emits the matching `FindingType`.

Because `Component.data` is `object`-typed at the core level with a discriminator on `kind`, adding a kind never breaks existing consumers.

### 4.3 Blessed extension namespaces (`api`, `transitions`)   *(NEW in 1.1)*

§4.1 permits arbitrary, detector-namespaced extensions. In addition, v1.1 defines **two blessed extension namespaces** — `extensions.api` and `extensions.transitions` — that ship with their **own versioned JSON sub-schemas** and first-class treatment. These are the "prepared extension points" requested for API mapping and state-transition semantics: the schema slots exist and are stable from 1.1 onward, and population ranges from automatic (v1, from data already captured) to enriched (future detectors).

A blessed namespace looks like:

```
extensions.<name> = {
  schema:    "https://replayqa.dev/schemas/ram/extensions/<name>/<ver>/schema.json"
  version:   "1.0.0"        // independent SemVer, MAJOR pinned to the core MAJOR it was introduced under
  populated: "automatic" | "enriched" | "off"     // how complete v1 expects this to be
  data:      { ...namespace-specific... }
}
```

Rules that distinguish a *blessed* namespace from an *arbitrary* one (§4.1):

- Its sub-schema is **part of the RAM spec**, versioned in lockstep with the core MAJOR, and lives in the repo at `src/discovery/ram/extensions/<name>.schema.json` (see `08-folder-structure.md`).
- A blessed namespace MAY be referenced from core objects (e.g. `CrudAction.apiEndpointIds` is permitted but not required). Core objects never **depend** on a blessed namespace being populated.
- Core consumers SHOULD understand blessed namespaces; they MUST tolerate any blessed namespace being absent (`populated: "off"`).
- Adding a new blessed namespace is a **MINOR** core bump. Removing or breaking-changing one is a **MAJOR** core bump.

#### 4.3.1 `extensions.api` — API mapping

Binds observed HTTP endpoints to model objects. This is the bridge between the UI model and a backend/OpenAPI view of the app. In v1 it is populated **automatically** from network observations the Browser Controller already captures (no new detector required): the CRUDDetector's network-correlation evidence and the existing network collector are lifted into this structured form. A future `ApiDetector` or an OpenAPI merge can enrich it to `populated: "enriched"`.

```
extensions.api.data = {
  endpoints: [
    {
      id              string                     // stable hash of method + urlTemplate
      method          "GET"|"POST"|"PUT"|"PATCH"|"DELETE"
      urlTemplate     string                     // "/api/contacts/:id"
      baseUrl?        string
      authRequired    bool
      request?: {
        params?      [ { name, in: "path"|"query"|"header", type?, required } ]
        body?:       { contentType, schemaRef?, fieldsRef?: string }   // fieldsRef → Entity.id
      }
      response?: {
        status:      [ number | [number,number] ]    // 200  or  [200,299]
        contentType? string
        schemaRef?   string
        fieldsRef?   string                          // → Entity.id of the returned shape
      }
      bindings: {
        entityId?      string
        crudOperation? "create"|"read"|"update"|"delete"
        flowIds?       [string]                      // flows whose steps trigger this endpoint
        actionIds?     [string]                      // UI actions that trigger this
      }
      observedCount   number                        // times seen during the run
      confidence      number
    }
  ],
  resourceNaming: {
    strategy   "rest" | "graphql" | "rpc" | "mixed"
    notes?     string
  },
  openApiCompanion?: { url?: string, mergedFrom?: string }   // if a spec was discovered/merged
}
```

Why an extension and not core: not every consumer cares about the backend contract (a pure UI-smoke test does not), and endpoint schemas change at a different cadence than UI structure. Keeping it as a blessed extension lets UI-only consumers ignore it while giving the future AI Planner a rigorous API surface to generate API-level or contract tests against.

#### 4.3.2 `extensions.transitions` — state-transition semantics

Enriches the raw state-graph (`graph.json`) with **semantic** transitions the core graph does not capture: enabling guards, declared side effects, conditional availability, grouping into regions, and reliability. In v1 it is populated **automatically** by lifting the explored graph and annotating with whatever guard/side-effect evidence detectors already produced (e.g. auth gates from `LoginDetector`, confirm-dialog gates from `ModalDetector`). The richer guard-expression and reliability fields are reserved slots for future detectors.

```
extensions.transitions.data = {
  transitions: [
    {
      id            string                         // stable hash of (fromStateId, actionId, toStateId)
      fromStateId?  string                         // omitted ⇒ origin wildcard
      toStateId?    string                         // omitted ⇒ terminal/external
      actionId?     string                         // → Action.id in graph.json
      label         string                         // human, e.g. "openAddContactModal"
      guard?: {
        kind        "auth" | "data" | "ui-state" | "custom"
        expression  string                         // declarative, e.g. "authenticated AND contacts:notEmpty"
        description? string
      }
      sideEffects?: [
        { kind: "url-change"|"dom-mutation"|"network"|"state-data", detail: object }
      ]
      availability? "always" | "conditional" | "rare"
      group?:       string                         // state-machine region id (see regions)
      reliability?: number                         // observed success rate, 0..1
    }
  ],
  regions?: [
    { id: string, name: string, stateIds: [string], initial: string }
  ],
  invariants?: [ string ]                          // e.g. "delete requires confirm dialog",
                                                   // "authenticated state is reachable only via login flow"
}
```

Why an extension and not core: the raw `graph.json` already records every concrete `(state --action--> state)` edge at full fidelity. `extensions.transitions` adds *meaning* on top of those edges (when is this edge usable? what does it really do?). That semantics layer is valuable to the AI Planner (for choosing viable paths) and to the Test Generator (for asserting guards and side effects), but it is derived, not primary — so it lives one layer out, with a clean promotion path to core if it proves load-bearing.

#### 4.3.3 Promoting a blessed extension to core

If a blessed namespace becomes universally required (e.g. Flows themselves started life conceptually similar and were promoted in 1.1), the path is:

1. Add the object to §3.2 as an optional core field (MINOR bump).
2. Keep the blessed namespace as a deprecated alias for one MAJOR cycle.
3. Remove the alias in the next MAJOR.

This is the same evolutionary discipline the rest of the schema follows.

---

## 5. Versioning

The RAM uses **two independent versions**, both SemVer.

| Version | Where | Meaning |
|---------|-------|---------|
| `schemaVersion` | top-level | The version of **this JSON schema** (the contract). Bumped when the schema changes. |
| `modelVersion` | top-level | The version of **the modelled application**. Bumped by the reporter when comparing against a prior run of the same app. |

### 5.1 Schema evolution policy

- **MAJOR** (breaking): removing a required field, changing a field's semantics, renaming without aliasing. Consumers may reject. Requires a migration guide in `docs/discovery/`.
- **MINOR** (additive, backward-compatible): adding an optional field, adding a `Component.kind` enum value, adding a new `FindingType`, adding a blessed extension namespace. Old consumers must ignore-unknown and continue.
- **PATCH** (clarification): docs, value-format tightening, no structural change.

**Guarantees for consumers:**

- Within the same MAJOR, any RAM file validates against the latest MINOR schema of that MAJOR.
- Consumers SHOULD declare the MAJOR they target and reject other MAJORS with a clear error.
- The future AI Planner/Test Generator MUST pin a MAJOR and degrade gracefully on unknown MINOR additions.

**Changelog (authoritative record of MINOR/MAJOR bumps):**

| Version | Change | Class |
|---------|--------|-------|
| `1.0.0` | Initial schema: Application, Page, Entity, Field, Locator, Component, Action, CrudAction, Navigation, AuthFlow, CrudMatrix, StateRef. | — |
| `1.1.0` | Added first-class **`Flow`** (+ `FlowStep`, `Parameter`, `Binding`, `Precondition`, `Postcondition`, `Assertion`) as an **optional** top-level array; `AuthFlow` re-specified as a typed projection of `Flow` (mirror fields preserved for backward compatibility). Added two **blessed extension namespaces**: `extensions.api` and `extensions.transitions`, each with its own versioned sub-schema. | MINOR (additive) |

A 1.0.0 consumer reading a 1.1.0 model: ignores `flows`, ignores the two new extension keys, and reads `authFlow` exactly as before (its mirror fields are still populated). No code change required.

### 5.2 Model evolution policy

Two discovery runs of the **same app version** produce models whose stable IDs (`Page.id`, `Entity.id`, `Component.id`, `Action.id`) are **structurally equivalent**. This makes:

- `git diff artifacts/discovery/<run-a>/ram.json artifacts/discovery/<run-b>/ram.json` meaningful,
- and lets a future regression step say "the Contact entity lost its `delete` operation between these two runs".

---

## 6. Schema sketch (JSON Schema, draft 2020-12)

The schema lives at `src/discovery/ram/schema.json` (see `08-folder-structure.md`). Blessed-extension sub-schemas live at `src/discovery/ram/extensions/{api,transitions}.schema.json`. A fragment — illustrating shape and the new 1.1 additions, not the full document — is:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://replayqa.dev/schemas/ram/1.1.0/schema.json",
  "title": "ReplayQA Application Model",
  "type": "object",
  "required": ["schemaVersion", "modelVersion", "generatedAt", "generator", "application", "pages", "entities", "navigation", "crudMatrix", "confidence"],
  "properties": {
    "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "modelVersion":  { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "generatedAt":   { "type": "string", "format": "date-time" },
    "generator": {
      "type": "object",
      "required": ["name", "version", "runId"],
      "properties": {
        "name":    { "const": "replayqa-discovery" },
        "version": { "type": "string" },
        "runId":   { "type": "string" }
      }
    },
    "application": { "$ref": "#/$defs/Application" },
    "pages":       { "type": "array", "items": { "$ref": "#/$defs/Page" } },
    "entities":    { "type": "array", "items": { "$ref": "#/$defs/Entity" } },
    "navigation":  { "$ref": "#/$defs/Navigation" },
    "flows":       { "type": "array", "items": { "$ref": "#/$defs/Flow" } },
    "authFlow":    { "$ref": "#/$defs/AuthFlow" },
    "crudMatrix":  { "$ref": "#/$defs/CrudMatrix" },
    "states":      { "type": "array", "items": { "$ref": "#/$defs/StateRef" } },
    "graph":       { "type": "string" },
    "confidence":  { "$ref": "#/$defs/Confidence" },
    "extensions":  {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "api":         { "$ref": "https://replayqa.dev/schemas/ram/extensions/api/1.0.0/schema.json" },
        "transitions": { "$ref": "https://replayqa.dev/schemas/ram/extensions/transitions/1.0.0/schema.json" }
      }
    }
  },
  "$defs": {
    "Locator": {
      "type": "object",
      "required": ["fallback"],
      "properties": {
        "primary":  { "type": "object", "properties": {
          "role": { "type": "string" }, "name": { "type": "string" } } },
        "fallback": { "type": "string" },
        "hint":     { "type": "string" }
      }
    },
    "Entity": {
      "type": "object",
      "required": ["id", "name", "fields", "source", "confidence"],
      "properties": {
        "id":         { "type": "string" },
        "name":       { "type": "string" },
        "plural":     { "type": "string" },
        "fields":     { "type": "array", "items": { "$ref": "#/$defs/Field" } },
        "source":     { "enum": ["rest", "form", "table", "mixed"] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "pages":      { "type": "array", "items": { "type": "string" } }
      }
    },
    "Flow": {
      "type": "object",
      "required": ["id", "kind", "name", "steps", "confidence", "source"],
      "properties": {
        "id":            { "type": "string" },
        "kind":          { "enum": ["auth", "crud", "navigation", "search", "custom"] },
        "name":          { "type": "string" },
        "description":   { "type": "string" },
        "entityId":      { "type": "string" },
        "operation":     { "enum": ["create", "read", "update", "delete"] },
        "parameters":    { "type": "array", "items": { "$ref": "#/$defs/Parameter" } },
        "precondition":  { "$ref": "#/$defs/Precondition" },
        "steps":         { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/FlowStep" } },
        "postcondition": { "$ref": "#/$defs/Postcondition" },
        "produces":      { "type": "array", "items": { "$ref": "#/$defs/Binding" } },
        "confidence":    { "type": "number", "minimum": 0, "maximum": 1 },
        "reliability":   { "type": "number", "minimum": 0, "maximum": 1 },
        "reversible":    { "type": "boolean" },
        "cleanupFlowId": { "type": "string" },
        "source":        { "enum": ["synthesized", "observed", "imported"] }
      }
    },
    "FlowStep": {
      "type": "object",
      "required": ["id", "kind"],
      "properties": {
        "id":          { "type": "string" },
        "kind":        { "enum": ["navigate", "action", "fill", "assert", "wait", "observe", "subflow"] },
        "ref":         { "type": "string" },
        "locator":     { "$ref": "#/$defs/Locator" },
        "value":       { "type": ["string", "number", "boolean"] },
        "assertion":   { "$ref": "#/$defs/Assertion" },
        "wait":        { "type": "object" },
        "description": { "type": "string" },
        "onFailure":   { "type": "string" }
      }
    },
    "Parameter": { "type": "object", "required": ["name", "type", "required"] },
    "Binding":   { "type": "object", "required": ["name", "from", "scope"] },
    "Precondition":  { "type": "object", "additionalProperties": true },
    "Postcondition": { "type": "object", "additionalProperties": true },
    "Assertion":     { "type": "object", "required": ["kind", "target", "op"] }
  }
}
```

The `flows` property, the `extensions.api` / `extensions.transitions` references, and the `Flow`/`FlowStep`/`Parameter`/`Binding`/`Precondition`/`Postcondition`/`Assertion` `$defs` are the **1.1 additions**; everything else is unchanged from 1.0.0. The complete schema and the two extension sub-schemas are part of the implementation work, not this spec.

The full schema enumerates every `$def` from §3 plus the helpers defined alongside `Flow` in §3.2. The point of this sketch is to show that the RAM is **schema-defined from day one** — including its 1.1 additions — not reverse-engineered from code.

### 6.1 Validation

- **Mandatory.** `ram.json` is validated by the RAM Builder before it is written. A model that fails validation fails the discovery run (partial model still persisted for debugging under `states/`).
- **Validator:** `ajv` (draft 2020-12, JSON Schema). Recommended as a **devDependency** used at both (a) boot for `DiscoveryConfig` validation and (b) finalize for RAM validation. If the team insists on strict zero-runtime-deps, validation can be moved to a separate `replayqa discovery validate` post-command, but this weakens the trust guarantee for the primary output and is not recommended.
- **Strictness:** `additionalProperties: false` on core objects (catches typos / schema drift); `additionalProperties: true` only under `extensions`.

---

## 7. Worked example (illustrative fragment)

A fragment of what `ram.json` would look like for PhoneBook Pro — shown to make the schema concrete, **not** a real run output:

```json
{
  "schemaVersion": "1.1.0",
  "modelVersion":  "0.1.0",
  "generatedAt":   "2026-07-21T09:18:00Z",
  "generator":     { "name": "replayqa-discovery", "version": "0.1.0", "runId": "20260721-091800-a1b2c3" },
  "application": {
    "name":    "Phonebook Pro",
    "origin":  "https://phone-book-yrap.vercel.app",
    "appType": "crud",
    "techHints": ["vue", "fastapi"]
  },
  "pages": [
    {
      "id": "page-login",
      "routeSignature": "/login",
      "url": "/login",
      "requiresAuth": false,
      "components": [ { "kind": "form", "id": "form-auth-login", "confidence": 0.92 } ],
      "stateRefs": ["state-7f3a…"]
    },
    {
      "id": "page-contacts-list",
      "routeSignature": "/contacts",
      "url": "/contacts",
      "requiresAuth": true,
      "components": [
        { "kind": "table",  "id": "table-contacts", "confidence": 0.88 },
        { "kind": "search", "id": "search-contacts", "confidence": 0.71 }
      ],
      "navItems": [ { "navItemId": "nav-contacts", "active": true } ]
    },
    {
      "id": "page-contact-edit",
      "routeSignature": "/contacts/:id/edit",
      "requiresAuth": true,
      "components": [ { "kind": "form", "id": "form-contact-edit", "confidence": 0.83 } ]
    }
  ],
  "entities": [
    {
      "id": "entity-contact",
      "name": "Contact",
      "plural": "Contacts",
      "source": "mixed",
      "confidence": 0.86,
      "pages": ["page-contacts-list", "page-contact-edit"],
      "fields": [
        { "name": "name", "label": "Name", "type": "text", "required": true },
        { "name": "phone", "label": "Phone", "type": "text", "required": true, "validation": ["pattern"] },
        { "name": "email", "label": "Email", "type": "email", "required": false, "validation": ["email"] }
      ]
    }
  ],
  "crudMatrix": {
    "rows": [
      { "entityId": "entity-contact", "create": true, "read": true, "update": true, "delete": true }
    ],
    "totals": { "create": 1, "read": 1, "update": 1, "delete": 1 }
  },
  "flows": [
    {
      "id": "flow-contact-create",
      "kind": "crud",
      "name": "Create Contact",
      "entityId": "entity-contact",
      "operation": "create",
      "parameters": [
        { "name": "contact.name",  "type": "text",  "required": true,  "default": "__replayqa_probe__" },
        { "name": "contact.phone", "type": "text",  "required": true,  "default": "555-0100" },
        { "name": "contact.email", "type": "email", "required": false, "default": "probe@example.com" }
      ],
      "precondition": { "requiresAuth": true, "requiredPageId": "page-contacts-list" },
      "steps": [
        { "id": "s1", "kind": "action",  "ref": "action-open-add-modal", "description": "open the Add Contact form" },
        { "id": "s2", "kind": "fill",    "locator": { "primary": { "role": "textbox", "name": "Name" } },  "value": "${contact.name}" },
        { "id": "s3", "kind": "fill",    "locator": { "primary": { "role": "textbox", "name": "Phone" } }, "value": "${contact.phone}" },
        { "id": "s4", "kind": "fill",    "locator": { "primary": { "role": "textbox", "name": "Email" } }, "value": "${contact.email}" },
        { "id": "s5", "kind": "action",  "ref": "action-submit-contact-form" },
        { "id": "s6", "kind": "assert",  "assertion": { "kind": "count", "target": "table-contacts", "op": "gte", "value": 1 } }
      ],
      "postcondition": {
        "expectedFeedback":    [ { "variant": "success" } ],
        "expectedDataDelta":   { "entity:contact": "+1" },
        "expectedNetwork":     [ { "method": "POST", "urlTemplate": "/api/contacts", "statusRange": [200, 299] } ]
      },
      "produces":     [ { "name": "createdContactId", "from": "s5", "scope": "run" } ],
      "confidence":   0.82,
      "reliability":  0.95,
      "reversible":   true,
      "cleanupFlowId":"flow-contact-delete",
      "source":       "synthesized"
    }
  ],
  "authFlow": {
    "flowId":          "flow-auth-login",
    "loginPageId":     "page-login",
    "fields": [
      { "name": "username", "type": "text",     "required": true },
      { "name": "password", "type": "password", "required": true }
    ],
    "resultStateIds":  { "authenticated": "state-9c41…", "anonymous": "state-7f3a…" }
  },
  "confidence": { "mean": 0.84, "min": 0.71, "histogram": { "0.5-0.7": 1, "0.7-0.9": 3, "0.9-1.0": 1 } },
  "extensions": {
    "api": {
      "schema":    "https://replayqa.dev/schemas/ram/extensions/api/1.0.0/schema.json",
      "version":   "1.0.0",
      "populated": "automatic",
      "data": {
        "resourceNaming": { "strategy": "rest" },
        "endpoints": [
          {
            "id": "ep-contacts-list",
            "method": "GET",
            "urlTemplate": "/api/contacts",
            "authRequired": true,
            "response": { "status": [[200,299]], "fieldsRef": "entity-contact" },
            "bindings": { "entityId": "entity-contact", "crudOperation": "read", "flowIds": ["flow-contact-create"] },
            "observedCount": 7,
            "confidence": 0.9
          },
          {
            "id": "ep-contacts-create",
            "method": "POST",
            "urlTemplate": "/api/contacts",
            "authRequired": true,
            "request":  { "body": { "contentType": "application/json", "fieldsRef": "entity-contact" } },
            "response": { "status": [[200,201]] },
            "bindings": { "entityId": "entity-contact", "crudOperation": "create", "flowIds": ["flow-contact-create"] },
            "observedCount": 2,
            "confidence": 0.88
          }
        ]
      }
    },
    "transitions": {
      "schema":    "https://replayqa.dev/schemas/ram/extensions/transitions/1.0.0/schema.json",
      "version":   "1.0.0",
      "populated": "automatic",
      "data": {
        "transitions": [
          {
            "id": "tr-open-add-modal",
            "fromStateId": "state-contacts-list",
            "toStateId":   "state-contacts-list-add-open",
            "actionId":    "action-open-add-modal",
            "label": "openAddContactModal",
            "guard": { "kind": "auth", "expression": "authenticated" },
            "sideEffects": [ { "kind": "dom-mutation", "detail": { "modal": "form-contact-create" } } ],
            "availability": "always",
            "group": "contact-list-actions"
          },
          {
            "id": "tr-delete-confirm",
            "fromStateId": "state-contact-row",
            "actionId":    "action-delete-contact",
            "label": "deleteContact",
            "guard": { "kind": "ui-state", "expression": "confirmDialog:open" },
            "sideEffects": [ { "kind": "network", "detail": { "method": "DELETE", "urlTemplate": "/api/contacts/:id" } } ],
            "availability": "conditional",
            "group": "contact-list-actions",
            "reliability": 0.9
          }
        ],
        "invariants": [ "delete requires confirm dialog", "authenticated state reachable only via login flow" ]
      }
    }
  }
}
```

Note how nothing in the model references Playwright, TypeScript, or any AI provider. A different test runner, a different AI backend, or a human reader can all consume this file equally well. That neutrality is the RAM's reason to exist.

The `flows` entry shows a fully parameterized Create-Contact flow with precondition, ordered steps, declarative postcondition, a produced binding (`createdContactId`), and a `cleanupFlowId` pointing at the delete flow — everything the future Test Generator needs to emit a real, self-teardown Playwright test. The `extensions.api` block binds the observed REST endpoints back to the Contact entity and the Create flow, and `extensions.transitions` annotates the graph edges with the auth guard and the confirm-dialog gate.

---

## 8. What the RAM deliberately omits

- **Raw HTML/DOM** — too verbose, too brittle. Lives in `states/*.json` instead, referenced by `StateRef`.
- **Network payloads (bodies)** — only endpoint templates, methods, status ranges, and field-shape references are modeled (in `extensions.api`); bodies live in the existing network collector artifacts.
- **Screenshots and video** — captured as artifacts, never embedded in the model.
- **Test assertions as runner code** — the model carries **declarative** assertions (`Assertion`, `Postcondition`) that express intent, but never Playwright/`expect` code. Translating intent to runner code is the future Test Generator's job.
- **AI prompts or model preferences** — the RAM is provider-agnostic.
- **Imperative control flow / branching logic** — Flows are ordered step lists with `onFailure` policies, not Turing-complete programs. Loops, retries-with-backoff, and conditional branching belong to the Test Generator or AI Planner, not the model.

Anything not in this list and not in §3 (and not in a blessed extension under §4.3) should be proposed as a §4.1 extension before being added to the core schema.
