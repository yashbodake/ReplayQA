# Findings Framework

> Status: **Production infrastructure (implemented). No detection logic.**
> Code: `src/discovery/models/finding.ts`, `src/discovery/detectors/`.
> Persists to: `artifacts/discovery/findings/<stateId>.json`.

This milestone implements the substrate that detectors will emit into — the
typed **Finding** model, the **Detector** interface, and the **DetectorManager**
that runs detectors and aggregates their output. It does NOT implement any
detection logic; a single `DummyDetector` exercises the pipeline so the whole
flow (capture state → run detectors → aggregate → persist) is observable today.

This document specifies the framework and — as required — how Findings will
later compose into the ReplayQA Application Model (RAM). It does NOT specify
or implement RAM itself.

---

## 1. The Finding model

A Finding is **one observation extracted from one State by one Detector**. It
is evidence-bearing and audit-friendly: every finding says *what* was found,
*where* (which state), *who* found it (which detector), *how sure* it is, and
*why* (the signals).

```ts
interface FindingBase {
  id: string;            // deterministic: hash(detectorId | stateId | key)
  detectorId: string;    // which detector produced it
  stateId: string;       // source State (links back to states/<id>.json)
  confidence: number;    // 0..1
  evidence: Evidence[];  // the signals that produced it
  metadata: FindingMetadata;  // { capturedAt }
}
```

The required milestone fields all map onto this base:

| Milestone requirement | Field |
|-----------------------|-------|
| unique id             | `id` |
| type                  | `type` (discriminator) |
| confidence            | `confidence` |
| evidence              | `evidence: Evidence[]` |
| source state id       | `stateId` |
| metadata              | `metadata: FindingMetadata` |

Two additional fields (`detectorId`, `payload`) carry, respectively, the
producing detector's identity and the type-specific structured data. They are
the bridge to the RAM composition in §4.

### Evidence

```ts
interface Evidence {
  kind: 'role' | 'tag' | 'attr' | 'text' | 'url' | 'network' | 'aria' | 'computed';
  value: string;
  weight: number;   // this signal's contribution to confidence
}
```

Evidence is what makes a finding auditable. A future reviewer (human or the RAM
Builder) can read `evidence` and see exactly which signals fired — a role, a
tag, a URL pattern, a network call — without re-running discovery.

### Strongly-typed categories

`Finding` is a **discriminated union** on `type`. Each category narrows the
`payload` to a strongly-typed shape, so consumers narrow with ordinary control
flow:

```ts
function describe(f: Finding): string {
  switch (f.type) {
    case 'form':           return `form: ${f.payload.fields.length} fields`;
    case 'table':          return `table: ${f.payload.rowCount} rows`;
    case 'authentication': return `auth: ${f.payload.flow}`;
    case 'search':         return `search: ${f.payload.mechanism}`;
    case 'navigation':     return `nav: ${f.payload.landmark}`;
  }
}
```

The five categories required by this milestone, with payloads aligned to the
documented detectors (`docs/discovery/04-detectors.md`):

| Category | `type` | Payload highlights |
|----------|--------|--------------------|
| `AuthenticationFinding` | `'authentication'` | `flow` (login/register/…), credential `fields`, submit, oauthProviders |
| `TableFinding` | `'table'` | `variant` (table/grid/list/cards), `columns`, `rowCount`, `pagination` |
| `FormFinding` | `'form'` | `variant` (create/edit/filter/generic), `container`, `fields`, submit/cancel |
| `SearchFinding` | `'search'` | `control`, `scope`, `mechanism` (client/query/server) |
| `NavigationFinding` | `'navigation'` | `landmark`, `items[]` |

**Extensibility.** Adding a category (future: `ModalFinding`, `ToastFinding`,
and eventually `CrudFinding`) is mechanical: add a payload interface, a
category interface extending `FindingBase`, a union member, and a `FindingType`
value. Nothing else in the framework — Detector interface, DetectorManager,
persistence — changes.

---

## 2. The Detector interface

```ts
interface Detector {
  readonly id: string;
  detect(state: State): Promise<Finding[]>;
}
```

Contract (enforced by review, aligned with `04-detectors.md` §1):

- **Pure observer.** A detector reads a `State` and returns findings. It MUST
  NOT navigate, click, fill, or import Playwright — the BrowserController
  remains the only Playwright-dependent module. This keeps detectors trivially
  unit-testable against fixture states.
- **Idempotent.** Running twice on the same `State` yields the same findings
  (deterministic ids guarantee this).
- **No side effects** beyond returning findings. Persistence, event emission,
  and thresholding are the DetectorManager's / RAM Builder's jobs — never the
  detector's.

The signature takes only `state`. When future detectors need tuning or logging,
this widens to `detect(state, ctx: DetectorContext)` — a backward-compatible
change.

---

## 3. The DetectorManager

```ts
class DetectorManager {
  constructor(options: { findingsDir: string; logger?: Logger });
  register(detector: Detector): void;
  get count(): number;
  runAll(state: State): Promise<Finding[]>;   // runs all detectors, persists, returns
}
```

Responsibilities:

1. **Registry.** Detectors are registered in order; `runAll` honours that order.
2. **Aggregation.** Findings from all detectors are concatenated into one list
   per state. (Correlation — e.g. a Form inside a Modal, a Login form vs a
   generic Form — is explicitly deferred to the RAM Builder; the manager
   produces raw aggregates.)
3. **Failure isolation.** A detector that throws is logged via the context
   logger and skipped. It never aborts the run or starves the other detectors.
4. **Persistence.** After running, the manager writes
   `artifacts/discovery/findings/<stateId>.json` — a single aggregate per
   state mirroring the `states/<stateId>.json` layout.

Detectors are run **only on new states**. Because detectors are idempotent, a
duplicate capture would produce identical findings; the orchestrator skips the
work (see `core/discover.ts` `captureNew`).

### DummyDetector

A placeholder that emits one constant `NavigationFinding` per state, so the
entire pipeline is observable before any real detector exists. It carries a
deterministic id (`hash('dummy' | stateId | 'sample')`), so re-runs are stable.
Real detectors replace or augment it without touching the framework.

### Verified end-to-end

`npm run discover -- https://phone-book-yrap.vercel.app` produces, additively:

```
artifacts/discovery/
├── discovery.json                       (unchanged — backward compatible)
├── states/991DEDB8.json                 (StateManager)
└── findings/991DEDB8.json               (DetectorManager — NEW)
```

with `findings/991DEDB8.json`:

```json
{
  "stateId": "991DEDB8",
  "count": 1,
  "findings": [
    {
      "id": "E16F6A24",
      "detectorId": "dummy",
      "type": "navigation",
      "stateId": "991DEDB8",
      "confidence": 0.5,
      "evidence": [{ "kind": "tag", "value": "dummy", "weight": 0.5 }],
      "metadata": { "capturedAt": "2026-07-21T09:24:01.346Z" },
      "payload": { "landmark": "primary-nav", "items": [] }
    }
  ]
}
```

The finding `id` is deterministic (verified: `E16F6A24` across runs) and the
`stateId` links the finding back to its source state — the join key the RAM
Builder will use.

---

## 4. How Findings compose into the RAM

This is specification only. **RAM is not implemented** (per the milestone
constraint). The composition path is the contract the Findings framework is
shaped for.

### 4.1 Findings are the RAM Builder's only input

The documented pipeline (`02-pipeline.md`) places the Detector Manager's
findings as the single input to the RAM Builder:

```
State → DetectorManager → Findings[] → RAM Builder → RAM (ram.json)
```

The RAM Builder consumes the persisted `findings/*.json` (and `states/*.json`)
and emits the versioned application model defined in `05-ram.md`. Findings are
upstream of RAM and never reference RAM types — the dependency is one-way.

### 4.2 Each finding category maps to a RAM object

A finding of category X is the raw material for a RAM object of the
corresponding kind. The mapping is direct because the finding payloads were
aligned to the documented detector payloads (which the RAM `Component.data`
mirrors — `05-ram.md` §3.2):

| Finding category | Becomes (in RAM) | Notes |
|------------------|------------------|-------|
| `FormFinding` | `Component { kind: 'form' }` + contributes to `Entity.fields` | `payload.fields` → `Entity.fields`; `payload.variant` tags create/edit |
| `TableFinding` | `Component { kind: 'table' }` + contributes to `Entity` | `payload.columns` → `Entity.fields`; implies a Read operation |
| `SearchFinding` | `Component { kind: 'search' }` | `payload.mechanism` feeds future flow postconditions |
| `NavigationFinding` | `Navigation.landmarks[].items` | Aggregated into the app-wide `Navigation` object |
| `AuthenticationFinding` | `AuthFlow` (+ a `Flow` with `kind:'auth'`) | `payload.flow` selects login/register; seeds the auth Flow |

### 4.3 Confidence + evidence drive promotion

Not every finding becomes a RAM object. The RAM Builder applies a promotion
threshold (`discovery.detectors.minConfidence`, default `0.5` in the design):
findings at or above the threshold are promoted into the model; below, they
are retained in `findings/*.json` for review but not promoted. Because every
finding carries `confidence` **and** the `evidence` that produced it, a
reviewer can always answer "why was this promoted (or not)?"

### 4.4 The RAM Builder correlates, detectors do not

Detectors emit independent findings; the RAM Builder resolves overlaps. For
example, the same DOM region may produce both a `FormFinding` (from a future
FormDetector) and an `AuthenticationFinding` (from a future LoginDetector).
The correlation rules in `04-detectors.md` §4 decide precedence (the auth
finding wins for semantics; the form survives as structural detail). The
DetectorManager intentionally does NOT do this — it only aggregates. This
keeps detectors pure and pushes semantic reconciliation into a single,
testable place (the future RAM Builder).

### 4.5 `stateId` is the join key

Every finding carries `stateId`, linking it to:

- the persisted `states/<stateId>.json` (the full State + materials), and
- the future state-graph (`graph.json`) — so the RAM Builder knows *which
  page* each finding lives on, which is what lets it place Components on
  Pages and later synthesize Flows (`09-flows.md`) that walk from page to
  page.

### 4.6 What this milestone enables next

With the Finding model fixed, the path to RAM is:

1. Implement real detectors (`LoginDetector`, `FormDetector`, …) that each
   `implement Detector` and emit the typed payloads already defined here.
2. Build the RAM Builder that reads `findings/*.json` + `states/*.json` and
   emits `ram.json` per `05-ram.md`.
3. Add correlation rules (overlaps, CRUD synthesis) inside the RAM Builder.

None of those steps require changing the Finding model, the Detector
interface, or the DetectorManager — they consume exactly what this milestone
produces.

---

## 5. Assumptions

1. **The five categories are sufficient for v1 CRUD scope.** Modal/Toast
   categories will be added the same way (§1 extensibility) when those
   detectors arrive. CRUD is intentionally absent — the milestone forbids it;
   it will be a *correlation* the RAM Builder derives from Form/Table/button
   findings, not a detector of its own (per `04-detectors.md` §6.4).

2. **Finding ids are 8-hex (32-bit), scoped per state.** A single state yields
   at most a handful of findings per detector, so collision risk is
   negligible. The id includes `detectorId + stateId + key`, so ids are unique
   across detectors and states within a run.

3. **`metadata` is generic and type-stable; `payload` is type-specific.** The
   milestone asks for "metadata"; it is interpreted as capture metadata common
   to every finding (`capturedAt`), while the strongly-typed per-category data
   lives on `payload` and is narrowed via the `type` discriminator.

4. **Persistence is per-state (`findings/<stateId>.json`), not per-finding.**
   This mirrors `states/<stateId>.json`, groups a page's findings together for
   easy review, and gives the RAM Builder one file to read per state.

5. **Detectors run only on new states.** Duplicate captures are skipped by the
   orchestrator (detectors are idempotent, so re-running would produce
   identical findings — wasted work).

6. **Detector failures are non-fatal.** The manager isolates them; a buggy
   detector never aborts discovery. This matches the production posture of the
   StateManager (best-effort persistence).

7. **Backward compatibility.** `npm run discover` is unchanged: identical
   console output, and `discovery.json` is byte-for-byte identical to the
   pre-findings output (verified by diff). `findings/` is purely additive, as
   `states/` was before it.
