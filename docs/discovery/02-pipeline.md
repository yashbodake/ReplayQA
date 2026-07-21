# 02 — Discovery Pipeline

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`.

This document describes the **end-to-end pipeline** of a single Discovery run: the stages, what flows between them, where Playwright fits, and where the future AI/Test-Generator layers will attach. It is intentionally stage-oriented; the *internal* module boundaries are detailed in `03-modules.md`.

---

## 1. Pipeline at a glance

```
                         Operator (CLI / config)
                                  │
                                  ▼
                        ┌───────────────────┐
                        │   Run Orchestrator │   owns budgets, lifecycle, run-id
                        └─────────┬─────────┘
                                  │  DiscoveryConfig
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                        DISCOVERY LOOP                        │
   │                                                              │
   │   ┌──────────────┐    state      ┌────────────────────┐      │
   │   │  Browser     │──────────────▶│  State Manager     │      │
   │   │  Controller  │◀────actions───│  (capture + dedup) │      │
   │   └──────┬───────┘               └─────────┬──────────┘      │
   │          │ drives Playwright               │ State           │
   │          │                                 ▼                 │
   │          │                       ┌────────────────────┐      │
   │          │                       │ Detector Manager   │      │
   │          │                       │ (Login, Table,     │      │
   │          │                       │  Form, CRUD, …)    │      │
   │          │                       └─────────┬──────────┘      │
   │          │                                 │ Findings        │
   │          │                                 ▼                 │
   │          │                       ┌────────────────────┐      │
   │          │                       │ Navigation         │      │
   │          │                       │ Explorer           │      │
   │          │                       │ (frontier, edges)  │      │
   │          │                       └─────────┬──────────┘      │
   │          │                                 │ next actions     │
   │          ▼                                 │                  │
   │   ┌──────────────┐  ◀─────────────────────┘                  │
   │   │ RAM Builder  │  Findings + State-graph stream in         │
   │   └──────┬───────┘                                           │
   │          │                                                   │
   │          │  (Event Bus ties every box above together)        │
   │          ▼                                                   │
   │   ┌──────────────┐                                           │
   │   │   Reporter   │                                           │
   │   └──────────────┘                                           │
   └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  on termination
                    ┌─────────────────────────────┐
                    │  Outputs (artifacts/discovery/<run-id>/) │
                    │   ram.json, graph.json,    │
                    │   discovery-report.html,   │
                    │   states/, events.jsonl    │
                    └─────────────┬───────────────┘
                                  │
                                  ▼
                    ╔══════════════════════════════╗
                    ║   FUTURE (not this design)   ║
                    ║   AI Planner  →  Tests       ║
                    ╚══════════════════════════════╝
```

The whole loop is **bounded**: every arrow that could repeat carries a budget check. The loop ends when the frontier is exhausted *or* any budget is hit (see `06-exploration.md` §"Termination").

---

## 2. Stage-by-stage

### 2.1 Run Orchestrator

**Role:** The single entry point. Owns the lifecycle of one discovery run.

- Resolves and validates `DiscoveryConfig` (merging `replayqa.config.json` → env → CLI flags).
- Generates a deterministic `run-id` (UTC timestamp + short hash of target URL).
- Creates the output directory `artifacts/discovery/<run-id>/`.
- Boots the Event Bus, Browser Controller, and all modules in dependency order.
- Enforces the global **wall-clock budget** and is the only component that can decide "stop now".
- Emits `DiscoveryStarted` on boot and `DiscoveryCompleted` / `DiscoveryFailed` on exit.
- On failure, guarantees partial outputs (whatever the RAM Builder has so far) are still flushed to disk.

**Inputs:** `DiscoveryConfig`.
**Outputs:** `run-id`, started/completed events, and a guarantee that all modules are torn down cleanly (browser closed, files flushed).

### 2.2 Browser Controller

**Role:** The **only** component permitted to drive Playwright. All other modules ask it for observations or request actions through a narrow interface.

- Launches a single `BrowserContext` (chromium by default; inherits ReplayQA launch options).
- Exposes observation primitives: `getCurrentUrl`, `getDomSnapshot`, `getA11ySnapshot`, `getTitle`, `getInteractiveElements`, `getNetworkLog`.
- Exposes action primitives: `navigate(url)`, `click(locator)`, `fill(locator, value)`, `waitForStable`.
- Enforces **same-origin** policy — refuses any action/redirect that would leave the configured origin.
- Enforces **per-action safety** — refuses classified-destructive actions (see `06-exploration.md` §"Action safety").
- Integrates with ReplayQA's existing collectors (console, network) so discovery runs benefit from the same artifacts the test runner already captures.
- Emits `PageVisited`, `NavigationPerformed`, `NetworkObserved` events.

**Why a single chokepoint:** It makes safety policies (origin, destructive-action filtering, budgets) enforceable in exactly one place, and keeps every other module browser-agnostic and unit-testable against fixture states.

> **Build vs. buy:** The Browser Controller is a *thin* wrapper over Playwright. There is no third-party library that would meaningfully improve this layer — Playwright is already the chosen automation engine and exposes everything we need (DOM, a11y tree, network, tracing). **Recommendation: build (thin).** See `03-modules.md` for the contract.

### 2.3 State Manager

**Role:** Turn raw Browser Controller observations into **States** — the canonical unit of exploration — and decide whether a state is *new* or a *duplicate* of one already seen.

- Captures a State on demand: URL (canonicalized), DOM structural fingerprint, a11y-tree excerpt, list of visible interactive elements with stable locators, current form values (read-only), network fingerprint.
- Produces a **stable `stateId`** by hashing the canonicalized representation.
- Maintains the **seen-state set** and answers `isDuplicate(state)`.
- Persists every captured State to `states/<state-id>.json` for debugging and diffing.
- Emits `StateCreated` (new state) or `StateRevisited` (duplicate).

> **Build vs. buy:** There are libraries for URL canonicalization (`normalize-url`) and DOM hashing, but the *combination* (URL + a11y fingerprint + visible-interaction signature) is discovery-specific. **Recommendation: build**, optionally adopting `normalize-url` as the one small dependency if the team prefers not to hand-roll URL edge cases. Trade-offs discussed in `03-modules.md` §"State Manager".

### 2.4 Detector Manager

**Role:** Run the detector suite against a State and collect **Findings**.

- Holds the registered detector set (Login, Table, Form, CRUD, Search, Navigation, Modal, Toast in v1; extensible).
- Runs detectors in declared priority order, in parallel where independent.
- Enforces detector contracts: pure, time-boxed, never navigate, never mutate.
- Aggregates findings, resolves overlaps (e.g. a `<form>` detected by both FormDetector and LoginDetector is *correlated*, not duplicated — the LoginDetector's finding wins for auth semantics).
- Emits one event per finding: `FormDetected`, `TableDetected`, `CrudDetected`, `AuthenticationDetected`, `ModalDetected`, `ToastDetected`, `SearchDetected`, `NavigationFound`.

Detector contracts and per-detector designs are the subject of `04-detectors.md`.

### 2.5 Navigation Explorer

**Role:** Decide *what to explore next*. Maintains the **frontier** and the **state-graph**.

- After a State is analyzed, the Explorer enumerates candidate outgoing actions: anchors, nav buttons, tab/button controls that change visible content, form submit buttons, pagination, and SPA route changes observed via network/URL activity.
- Classifies each candidate action by safety (read / write-but-reversible / destructive) and only enqueues safe ones for execution.
- De-duplicates candidate destinations against the seen-state set *before* enqueueing (cheap pre-filter) and again *after* execution (authoritative, via the State Manager).
- Picks the next action (BFS by default; depth-limited), returns it to the Orchestrator which routes it through the Browser Controller.
- Records the **edge** `(fromState --action--> toState)` into `graph.json`.

Full algorithm in `06-exploration.md`.

### 2.6 RAM Builder

**Role:** Assemble the **ReplayQA Application Model** from the stream of Findings and the state-graph.

- Maintains an in-progress model: `Application → Pages → Components`, `Entities → Fields`, `CRUD Actions`, `AuthFlow`, `Navigation`.
- Resolves cross-references (e.g. binds a Form to its Entity, a CRUD Action to its triggering Button and its target Table).
- Applies confidence scoring and *drops* low-confidence, low-evidence findings unless config requests them.
- Validates the final model against the RAM JSON Schema (see `05-ram.md`).
- Emits `RamUpdated` (incremental, for live progress) and produces the final `ram.json`.

### 2.7 Reporter

**Role:** Produce human-readable output. Reuses ReplayQA's existing HTML-generator conventions so the discovery report looks native.

- Subscribes to the Event Bus and renders a live (in-memory) view of progress.
- On `DiscoveryCompleted`, writes a **self-contained** `discovery-report.html`:
  - Run summary (target, budget, duration, pages discovered, entities, CRUD coverage).
  - Page/entity matrix.
  - Auth flow visualization.
  - Per-detector confidence breakdown.
  - Links to `ram.json`, `graph.json`, and `states/`.
- Never blocks the discovery loop; all heavy rendering happens at completion.

---

## 3. Data flow contracts between stages

Each arrow in §1 carries a well-defined payload. The shapes are specified fully in `05-ram.md` and `07-events.md`; the *flow* is summarized here.

```
Orchestrator ──DiscoveryConfig──▶ Browser Controller
Browser Controller ──RawSnapshot──▶ State Manager
State Manager ──State(stateId, …)──▶ Detector Manager
State Manager ──State(stateId, …)──▶ Navigation Explorer
Detector Manager ──Findings[]──▶ RAM Builder
Detector Manager ──Findings[]──▶ Navigation Explorer  (findings can suggest actions)
Navigation Explorer ──Action──▶ Orchestrator ──Action──▶ Browser Controller
RAM Builder ──RamUpdated(event)──▶ Reporter / Event Bus
```

Two important invariants:

1. **The Browser Controller never reads from the Event Bus to decide actions.** All action decisions originate in the Navigation Explorer and are routed by the Orchestrator. This guarantees a single decision path and makes budgets auditable.
2. **Detectors never produce actions directly.** A detector may *suggest* candidate actions as part of its findings (e.g. FormDetector lists the form's submit button as a candidate), but only the Navigation Explorer enqueues them. This preserves the "detectors are pure observers" principle from `01-overview.md` §9.

---

## 4. Where Playwright fits

Playwright is used in exactly three ways, all mediated by the Browser Controller:

| Use | Playwright API surface | Notes |
|-----|------------------------|-------|
| Page driving | `page.goto`, `page.click`, `page.fill`, `page.waitForLoadState('networkidle')` | Single context, single page tab. |
| Observation | `page.accessibility.snapshot()`, `page.content()`, `page.locator(...).all()`, `page.url`, `page.title()` | a11y snapshot is the primary signal source. |
| Network/console | `context.on('request'/'response')`, `page.on('console')` | Reuses ReplayQA's existing collectors where possible. |

Discovery deliberately uses **no** Playwright features that imply testing semantics — no `expect`, no `test()`, no test-runner fixtures. Discovery runs *outside* Playwright's test runner; it simply drives a browser.

> **Note on Playwright `codegen`:** Playwright ships a test-recorder (`npx playwright codegen`) that watches user actions and emits tests. It is **not** used by Discovery. `codegen` records *interactions a human performs*; Discovery *autonomously explores* and emits a *model*. The two approaches solve different problems. This is a deliberate architectural choice, not an oversight. See `04-detectors.md` §"Non-approaches".

---

## 5. Where the RAM fits (hand-off to the future)

The pipeline terminates at `ram.json`. Everything downstream of it is **future work** and is shown only to anchor the design:

```
ram.json
   │
   ▼
[future] AI Planner          reads RAM, picks behaviors worth testing,
   │                         produces a TestPlan (not in scope here)
   ▼
[future] Test Generator      reads RAM + TestPlan, emits Playwright specs
   │
   ▼
[existing] Playwright Runner (ReplayQA today)   executes the generated specs
   │
   ▼
[existing] ReplayQA Reporter                     collects artifacts, renders dashboard
```

Because the RAM is a stable, versioned contract (`05-ram.md` §"Versioning"), the AI Planner and Test Generator can be built, swapped, or upgraded independently of Discovery. This decoupling is the single most important structural property of the pipeline.

---

## 6. Runtime characteristics

| Property | v1 target | Rationale |
|----------|-----------|-----------|
| Concurrency | **Single browser, single tab, sequential actions.** Detectors run in parallel *within* a state. | CRUD semantics are order-sensitive (create before edit before delete). Sequential exploration makes the state-graph coherent and budgets predictable. |
| Determinism | Two runs against the same app version produce structurally equivalent RAMs. | Stable state IDs, ordered exploration, canonicalized URLs. |
| Failure mode | On any unrecoverable error, the run flushes partial RAM + report and exits non-zero. | Partial models are still useful; silent data loss is not acceptable. |
| Resource shape | One chromium process, bounded network, bounded disk writes. | Plays well in CI alongside existing ReplayQA runs. |
| Observability | Every stage emits events to the bus; full event log persisted as `events.jsonl`. | Debuggability of autonomous runs is a first-class concern. |

---

## 7. What this pipeline deliberately does *not* do

- **No test execution.** Discovery does not run Playwright's test runner.
- **No AI calls.** No LLM, no embeddings, no prompts. The model is built by deterministic detectors. (AI is a *consumer* of the RAM, not part of producing it.)
- **No visual screenshot diffing.** Screenshots may be captured as artifacts, but they are not used as a detection signal. Semantics come from DOM + a11y + network.
- **No cross-origin crawl.** Enforced by the Browser Controller.
- **No persistent mutation of the target app.** Enforced by action safety classification (see `06-exploration.md`).
