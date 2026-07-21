# 03 — Discovery Modules

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`, `02-pipeline.md`.

This document breaks the Discovery Engine into **internal modules** and specifies each one's responsibilities, inputs, outputs, and dependencies. Interface sketches are **language-neutral pseudocode** (not TypeScript, not an implementation). The detector modules themselves are specified in `04-detectors.md`; this document covers the surrounding engine.

---

## 1. Module map

```
src/discovery/
├── orchestrator/        Run Orchestrator — lifecycle, budgets, run-id
├── browser/             Browser Controller — sole Playwright driver
├── state/               State Manager — capture + dedup + stateId
├── navigation/          Navigation Explorer — frontier, edges, action safety
├── detectors/           Detector Manager + all detectors  (see 04-detectors.md)
├── ram/                 RAM Builder — assembles the application model
├── reporter/            Discovery Reporter — HTML report (reuses existing infra)
├── events/              Event Bus — typed pub/sub
├── config/              DiscoveryConfig — schema, loader, defaults
└── utils/               hashing, url canonicalization, locators, logging
```

Module dependency direction is strictly **downward and rightward** in the list above:

```
orchestrator
   │
   ├──▶ browser
   ├──▶ state ──▶ browser (read-only observations only via interface)
   ├──▶ navigation ──▶ state, detectors
   ├──▶ detectors ──▶ state, utils
   ├──▶ ram ──▶ (events only; never touches browser)
   ├──▶ reporter ──▶ (events only)
   └──▶ events, config, utils   (cross-cutting, depended on by all)
```

Invariants:

- **`ram` and `reporter` never import `browser`.** They are pure consumers of events and findings. This makes them unit-testable with fixtures and guarantees the model never depends on a live browser.
- **Only `browser` imports Playwright.** A grep for `playwright` under `src/discovery/` outside the `browser/` folder is a build-time violation.
- **`events` depends on nothing** except `utils`. Everything else depends on `events`.

---

## 2. Cross-cutting modules

### 2.1 Event Bus (`events/`)

**Responsibilities**

- Provide a typed, in-process publish/subscribe channel.
- Preserve event ordering per publisher (no reordering within a single module's stream).
- Persist every event to `events.jsonl` (append-only) for post-hoc analysis.
- Support a replay mode that re-emits a recorded event log (used by `reporter` dry-runs and by tests).

**Inputs:** events from publishers.
**Outputs:** delivered events to subscribers; the `events.jsonl` artifact.

**Interface sketch (pseudocode)**

```
Bus.subscribe(eventName, handler)   → unsubscribe()
Bus.publish(event)                   → void   (synchronous, in-order)
Bus.flush()                          → void   (ensure events.jsonl is on disk)
```

> **Build vs. buy:** Node ships `EventEmitter`. The only additions we need are (a) typed event names/payloads and (b) an append-only file sink. Both are small wrappers. **Recommendation: build** on top of Node's `events`. A third-party event library (e.g. `mitt`, `eventemitter3`) would add a dependency for no functional gain. Trade-off: we hand-roll the typing and the file sink — both straightforward.

### 2.2 DiscoveryConfig (`config/`)

**Responsibilities**

- Declare the discovery configuration schema (additively extending `replayqa.config.json` under a new top-level `discovery` key — see `08-folder-structure.md`).
- Provide defaults for every budget and detector threshold (so a minimal run is `discovery: { targetUrl }`).
- Merge precedence: built-in defaults → config file → environment → CLI flags.
- Validate at boot and fail fast with actionable messages.

**Inputs:** `replayqa.config.json`, env vars, CLI args.
**Outputs:** a frozen `DiscoveryConfig` object consumed by every other module.

> **Build vs. buy:** ReplayQA already has a config loader (`src/config/`). Discovery reuses its *mechanism* (sync JSON + async TS/JS) and only adds its own *schema*. **Recommendation: reuse + extend**, no new dependency. For schema validation we recommend `ajv` as a **devDependency only** (see `05-ram.md` §"Validation"); config validation at boot can use the same instance.

### 2.3 Utils (`utils/`)

Small, pure, dependency-free helpers:

| Helper | Purpose |
|--------|---------|
| `hashCanonical(string)` | Stable SHA-256 → base64url short hash, used for `stateId`, `entityId`, etc. Uses Node `crypto`. |
| `canonicalizeUrl(url)` | Strip fragment, default-port normalization, sort query params, lowercase host, drop session/sensitive query keys. |
| `stableLocator(element)` | Produce a robust, human-readable locator string (a11y-role + name preferred; CSS fallback). Used by both RAM and future test generator. |
| `slugify(str)` | Safe, deterministic slugs for filenames and IDs. |
| `redactHeaders(headers)` | Strip `Authorization`, `Cookie`, `Set-Cookie` before persisting network artifacts. |
| `logger(scope)` | Scoped, leveled logger writing to `run.log` and stderr. |

> **Build vs. buy notes:**
> - **URL canonicalization:** the npm package `normalize-url` is mature (~600 LOC, no transitive deps) and handles edge cases we'd otherwise rediscover (IDN, default ports, duplicate slashes, tracked params). It conflicts mildly with the zero-runtime-deps principle. **Recommendation: adopt `normalize-url` as the single exception**, used only inside `utils/`. Trade-off: one small, well-scoped runtime dependency in exchange for not owning a long tail of URL edge cases. If the team prefers strict zero-deps, hand-rolling is acceptable but must include a dedicated test corpus.
> - **Hashing, slugify, redaction:** use Node built-ins (`crypto`) and small hand-rolled functions. No library.
> - **Fuzzy string matching** for CRUD verb heuristics ("Add" ≈ "Add new" ≈ "Create"): optionally `fuse.js`, but for the small CRUD verb dictionary a hand-rolled synonym table is simpler and deterministic. **Recommendation: hand-roll** (see `04-detectors.md`).

---

## 3. Core modules

### 3.1 Run Orchestrator (`orchestrator/`)

**Responsibilities**

- The single entry point invoked by the CLI.
- Boot all modules in dependency order, tear them down in reverse.
- Generate `run-id` and create the output directory.
- Hold the global wall-clock budget; the only entity permitted to force-stop the loop.
- Route the chosen `Action` from the Navigation Explorer to the Browser Controller (the single decision path described in `02-pipeline.md`).
- On error: ensure partial outputs (`ram.json` so far, `events.jsonl`) are flushed, then exit non-zero.

**Inputs:** `DiscoveryConfig`.
**Outputs:** exit code; the set of artifacts on disk; `DiscoveryStarted` / `DiscoveryCompleted` / `DiscoveryFailed` events.

**Dependencies:** every other module; the Event Bus.

**Interface sketch (pseudocode)**

```
runDiscovery(DiscoveryConfig) → DiscoveryResult {
   runId, outputsDir, ramPath, reportPath, stats, status
}
```

### 3.2 Browser Controller (`browser/`)

**Responsibilities**

- The **only** module that imports Playwright.
- Launch a single `BrowserContext` (chromium default; inherits ReplayQA `launchOptions`).
- Expose **observation** primitives (read-only): `url`, `title`, `domSnapshot`, `a11ySnapshot`, `interactiveElements`, `networkLog`, `formValues`.
- Expose **action** primitives (side-effecting): `navigate(url)`, `click(locator)`, `fill(locator, value)`, `selectOption`, `waitForStable(state)`.
- Enforce **same-origin** on every navigate/redirect.
- Enforce **action safety**: refuse actions classified `destructive` (see `06-exploration.md`).
- Enforce per-action timeouts and the global network budget.
- Cooperate with ReplayQA's existing `console-collector` and `network-collector` so a discovery run captures the same artifacts a test run does.

**Inputs:** action requests from the Orchestrator; observation requests from the State Manager.
**Outputs:** raw snapshots; `PageVisited`, `NavigationPerformed`, `NetworkObserved` events.

**Dependencies:** Playwright; ReplayQA collectors; `config`, `events`, `utils`.

**Interface sketch (pseudocode)** — deliberately narrow:

```
controller.observe()                      → RawSnapshot
controller.interactiveElements()          → ElementHandle[]
controller.navigate(url)                  → NavigationResult     // refuses cross-origin
controller.click(locator)                 → ActionResult
controller.fill(locator, value)           → ActionResult
controller.waitForStable(timeoutMs)       → boolean
controller.close()                        → void
```

> **Build vs. buy:** This is a thin facade. **Recommendation: build.** No third-party abstraction over Playwright would improve safety, origin enforcement, or budget integration — those are ReplayQA-specific policies that *must* live in our code. Wrapping Playwright ourselves also keeps the import surface to a single folder.

### 3.3 State Manager (`state/`)

**Responsibilities**

- Capture a `State` from a `RawSnapshot`.
- Produce a stable `stateId` (hash of canonical URL + a11y fingerprint + visible-interaction signature).
- Maintain the **seen-state set**; answer `isNew(state)` authoritatively.
- Persist each captured State to `states/<state-id>.json`.
- Emit `StateCreated` / `StateRevisited`.

**What goes into a State (conceptual)**

```
State {
  stateId:        string         // stable hash
  url:            string         // canonicalized
  routeSignature: string         // path template, e.g. "/contacts/:id/edit"
  domFingerprint: string         // structural hash, ignores text/values
  a11yExcerpt:    tree           // pruned a11y tree of interactive region
  title:          string
  interactive:    ElementRef[]   // locator + role + name + kind
  formContext:    FormSnapshot?  // present if a form is visible (read-only)
  networkFingerprint: string     // hash of recent XHR/fetch endpoints
  capturedAt:     timestamp
}
```

**Inputs:** `RawSnapshot` from Browser Controller.
**Outputs:** `State`; `states/*.json`; `StateCreated` / `StateRevisited` events.

**Dependencies:** `browser` (observation interface only); `events`, `utils`.

> **Build vs. buy:**
> - The a11y-tree fingerprint is discovery-specific (we want stability across text/value changes but sensitivity to structural change). No off-the-shelf library targets this exactly. **Recommendation: build** a small canonicalizer that walks Playwright's a11y snapshot, keeps role/name/level/hierarchy, and hashes the canonical form.
> - For URL canonicalization, see §2.3 — adopt `normalize-url` (the one recommended exception).
> - **Crawlee** (by Apify) provides request queues, dedup, and BFS/DFS over URLs and would overlap with both State Manager dedup and Navigation Explorer queueing. It is evaluated as a whole in `06-exploration.md` §"Build vs. buy: Crawlee"; the short version: Crawlee's URL-keyed dedup is insufficient for SPAs, where the same URL can host many states and the same state can be reached from many URLs. **Recommendation: do not adopt Crawlee for v1**; implement a state-keyed equivalent. Full trade-offs in `06-exploration.md`.

### 3.4 Navigation Explorer (`navigation/`)

**Responsibilities**

- Maintain the **frontier** (queue of not-yet-performed candidate actions).
- Maintain the **state-graph** (`graph.json`): nodes = states, edges = actions with labels and safety class.
- For each newly captured State, enumerate **candidate outgoing actions** (anchors, nav controls, tab buttons, pagination, form-open buttons, SPA route triggers).
- Classify each candidate's safety (`read`, `write-reversible`, `destructive`) and refuse to enqueue `destructive` ones.
- Pre-filter candidate destinations against the seen-state set using cheap heuristics (same `routeSignature` + similar `domFingerprint`) to avoid re-issuing known actions.
- Choose the next action by strategy (BFS, depth-limited, auth-aware ordering).
- Hand the chosen `Action` to the Orchestrator (never to the Browser Controller directly).

**Inputs:** `State`; `Findings` (detectors may declare candidate actions within their findings).
**Outputs:** next `Action` to perform (or "frontier exhausted"); `graph.json`; `NavigationFound`, `ActionEnqueued`, `ActionPerformed` events.

**Dependencies:** `state`; `detectors` (read findings); `events`, `utils`, `config`.

> **Build vs. buy:** See Crawlee evaluation in `06-exploration.md`. Short: **build**. Crawlee assumes anchor-driven navigation and is weak at SPA/JS-triggered transitions and modal flows, which are central to CRUD apps.

### 3.5 Detector Manager + Detectors (`detectors/`)

**Responsibilities (Manager)**

- Register, order, and time-box detectors.
- Run independent detectors in parallel within a state.
- Correlate overlapping findings (e.g. Login form vs. generic Form) per declared precedence.
- Forward findings to the RAM Builder and Navigation Explorer via events.

**Responsibilities (each Detector)**

- Pure: `(State, DetectorContext) → Finding[]`. No browser access, no navigation, no mutation.
- Declare its `id`, `priority`, `runCost` (cheap/expensive, for scheduling), and the `FindingType`s it emits.
- Be idempotent: running twice on the same State yields the same findings.

The Detector contract and every v1 detector (Login, Table, Form, CRUD, Search, Navigation, Modal, Toast) are specified in `04-detectors.md`.

**Dependencies:** `state`; `events`, `utils`, `config`. Detectors **never** depend on `browser`.

### 3.6 RAM Builder (`ram/`)

**Responsibilities**

- Subscribe to detector findings and state-graph updates.
- Assemble the in-progress `ApplicationModel` (entities, pages, components, CRUD actions, auth flow, navigation).
- Resolve cross-references: bind `Form` → `Entity`, `CRUDAction` → `(trigger, entity, targetState)`, `Table` → `Entity`, etc.
- Apply confidence scoring and prune low-evidence nodes (configurable threshold).
- Validate the model against the RAM JSON Schema (`05-ram.md`).
- Emit incremental `RamUpdated` events (for live reporting) and write the final `ram.json`.

**Inputs:** findings (events); state-graph updates.
**Outputs:** `ram.json`; `RamUpdated`, `RamFinalized` events.

**Dependencies:** `events`, `utils`, `config`. **Never** `browser`.

> **Build vs. buy (validation):** The model is JSON and we already have a JSON Schema (see `05-ram.md`). **Recommendation: adopt `ajv`** as the standard validator — it is the de-facto JSON Schema implementation for Node, supports draft-2020-12, and compiles schemas to fast validation functions. Marked as a **devDependency** used both at boot (config validation) and at finalize (RAM validation). If the team insists on strict zero-deps, validation can be deferred to a separate post-processing command, but this weakens the "trust the output" guarantee — not recommended.

### 3.7 Reporter (`reporter/`)

**Responsibilities**

- Subscribe to events; keep an in-memory view of progress.
- On `DiscoveryCompleted`, render a **self-contained** `discovery-report.html` consistent with the existing ReplayQA report aesthetic (dark-mode, embedded data, no external services).
- Include: run summary, page/entity matrix, CRUD coverage grid, auth-flow diagram, per-detector confidence, links to all artifacts.

**Inputs:** events (notably `RamUpdated`, `DiscoveryCompleted`).
**Outputs:** `discovery-report.html`.

**Dependencies:** the existing `src/reporter/html-generator.ts` (reused for styling/utilities); `events`, `utils`.

> **Build vs. buy:** Reuse the existing HTML generator's conventions. **Recommendation: reuse + build.** No new dependency.

---

## 4. Dependency graph (summary)

```
                    ┌─────────────┐
                    │ orchestrator│
                    └──────┬──────┘
        ┌──────────┬───────┼────────┬──────────┐
        ▼          ▼       ▼        ▼          ▼
     browser    state   navigation detectors   │
        │         │       ▲        ▲           │
        │         │       │        │           │
        └─playwright      └─ state ┘           │
                                                  │
   ram ◀── events ──▶ reporter                   │
   ram ◀── (findings via events)                 │
                                                  │
   all ◀── config, utils ────────────────────────┘
```

Rules of thumb for any future module:

1. If it needs the browser, it must be the Browser Controller or go *through* it.
2. If it mutates the model, it must be the RAM Builder.
3. If it decides what to do next, it must be the Navigation Explorer.
4. If it produces output for humans, it must be the Reporter.
5. Everything else is a detector (pure observer) or a util.

---

## 5. Extension points

The module boundaries above are designed so that the most common changes are localized:

| Change you want to make | Module touched | Everything else |
|------------------------|----------------|-----------------|
| Recognize a new component type (e.g. charts) | Add a detector under `detectors/` | Unchanged |
| Tune exploration aggressiveness | `config` + `navigation` | Unchanged |
| Support a new browser (e.g. firefox) | `browser` only | Unchanged |
| Add a new RAM top-level object | `ram` + `05-ram.md` schema | Unchanged |
| Change report look | `reporter` only | Unchanged |
| Swap the event transport (e.g. IPC) | `events` only | Unchanged |

This locality is the property that lets the team implement the engine incrementally and let multiple engineers work in parallel without constant merge conflicts.
