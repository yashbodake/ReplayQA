# 01 — Discovery Engine Overview

> Status: **Architecture specification (no implementation).**
> Audience: Engineers who will implement the Discovery Engine.
> Owner: ReplayQA architecture.

---

## 1. What the Discovery Engine is

The **Discovery Engine** is a new ReplayQA subsystem that **autonomously explores a running web application, observes what it finds, and produces a structured, machine-readable description of that application called the ReplayQA Application Model (RAM).**

ReplayQA today is excellent at *replaying* tests and *collecting artifacts*. It has no understanding of the application under test. Discovery closes that gap. By turning a live website into a graph of pages, forms, tables, entities, and CRUD actions, Discovery gives every downstream feature — most importantly, AI-assisted Playwright test generation — a stable semantic foundation to reason against.

In one sentence:

> Discovery turns a website into a model. Everything else turns the model into tests.

```
            Live CRUD app (e.g. PhoneBook)
                        │
                        ▼
            ┌────────────────────────┐
            │    Discovery Engine    │   ← this document family
            └────────────────────────┘
                        │
                        ▼
            ReplayQA Application Model (RAM)
                        │
                        ▼
            future: AI Planner → Test Generator
```

Version 1 of Discovery targets **CRUD applications only**: PhoneBook, Todo, Student Management, Employee Management, Inventory, Notes, and similar. These applications share a small, well-understood vocabulary — lists, forms, create/edit/delete actions, search, login — which makes reliable automatic modeling achievable. Arbitrary websites (e-commerce, dashboards, editors, social) are explicitly out of scope for v1.

---

## 2. Why it exists

ReplayQA's roadmap calls for AI-assisted test generation. Generating good tests requires three things the framework does not currently possess:

1. **A map of the application** — what pages exist, how they connect, what entities they manage.
2. **A vocabulary of components** — where the forms are, where the tables are, what fields they contain, what buttons do.
3. **A catalog of behaviors** — the Create/Read/Update/Delete operations, the auth flow, the search/filter controls.

Hand-authoring this map for every target app defeats the purpose of an automated tool. The Discovery Engine builds it automatically, once per app, and persists it as an artifact that can be versioned, reviewed, and reused.

The RAM is deliberately decoupled from any AI provider or prompt strategy. It is a pure data contract. When the AI layer changes models or prompt approaches, the RAM remains valid.

---

## 3. Responsibilities

The Discovery Engine **owns** the following concerns end to end:

| # | Responsibility | Notes |
|---|----------------|-------|
| 1 | Driving a real browser against a target URL | Reuses Playwright, which is already a ReplayQA dependency. |
| 2 | Exploring the application graph | BFS-style traversal over application *states*, not just URLs (see `06-exploration.md`). |
| 3 | Capturing normalized application states | DOM + accessibility tree + network + form state fingerprints. |
| 4 | Detecting semantic components | Forms, tables, navigation, modals, toasts, search, auth flows (see `04-detectors.md`). |
| 5 | Inferring CRUD operations | Correlating buttons, forms, tables, and network calls into Create/Read/Update/Delete actions against identified entities. |
| 6 | Building and persisting the RAM | A versioned JSON document describing the app (see `05-ram.md`). |
| 7 | Producing a human-readable discovery report | Consistent with the existing ReplayQA HTML report style (see `08-folder-structure.md`). |
| 8 | Staying within declared resource budgets | Time budget, page budget, action budget, network budget. Discovery must always terminate. |

---

## 4. Non-responsibilities

To keep v1 tractable, the following are **explicitly out of scope**. Each row states where the concern *does* belong.

| Out of scope | Where it belongs |
|--------------|------------------|
| Writing or generating Playwright tests | Future **AI Planner** and **Test Generator** layers. |
| Authoring AI prompts | Future **AI Planner** layer. Discovery emits data, never prompts. |
| Executing destructive CRUD actions during exploration | The application's own users / the future Test Generator. Discovery performs only safe, reversible probe actions (see §6 Constraints). |
| Crawling arbitrary / non-CRUD websites | Out of scope entirely for v1. |
| Cross-origin crawling | Out of scope. Single origin per discovery run (see §6). |
| Visual / layout regression analysis | Out of scope. Discovery is semantic, not pixel-based. |
| Performance testing, load profiling | Out of scope. ReplayQA already collects network artifacts; performance analysis is a separate concern. |
| Authentication bypass / credential brute force | Out of scope. Discovery consumes credentials supplied by the operator; it does not guess them. |
| Replacing Playwright | Discovery is *built on* Playwright. It is not an alternative automation library. |

---

## 5. Inputs

A discovery run is parameterized by a small, well-defined set of inputs. These are described here as a contract; the configuration surface is specified in `08-folder-structure.md`.

| Input | Required | Description |
|-------|----------|-------------|
| `targetUrl` | **Yes** | The seed URL of the application (typically the landing or login page). Must be same-origin for the whole run. |
| `credentials` | Conditional | Username/password (and optional 2FA token) when the app requires login. Required if `LoginDetector` fires and the operator wants post-auth pages discovered. |
| `scope` | No | URL/path allow- and deny-lists to constrain exploration (e.g. exclude `/admin`, `/settings/billing`). |
| `budgets` | No | Hard limits: max wall-clock time, max pages, max actions per page, max network requests. Always have safe defaults. |
| `detectors` | No | Which detectors to enable/disable and their tuning (e.g. confidence thresholds). |
| `browserOptions` | No | Playwright launch options (headless, viewport, locale, userAgent). Inherits ReplayQA defaults. |
| `outputDir` | No | Where to persist RAM + report. Defaults to `artifacts/discovery/<run-id>/`. |

Inputs are resolved through the existing `replayqa.config.json` loader (extended additively — see `08-folder-structure.md`), with CLI overrides.

---

## 6. Outputs

A successful discovery run produces three durable artifacts plus an event stream consumed at runtime.

```
artifacts/discovery/<run-id>/
├── ram.json                  ← primary output: ReplayQA Application Model
├── discovery-report.html     ← human-readable report (self-contained)
├── states/                   ← raw captured state snapshots (for debugging / diffing)
│   └── <state-id>.json
├── graph.json                ← the exploration state-graph (pages + transitions)
├── events.jsonl              ← the full event log from the run
└── run.log                   ← plain-text execution log
```

| Output | Purpose | Consumer |
|--------|---------|----------|
| **`ram.json`** | The machine-readable application model. Versioned, schema-validated. | Future AI Planner, Test Generator, and any tooling that wants to reason about the app. |
| **`discovery-report.html`** | A self-contained dashboard of what was discovered: pages, entities, CRUD matrix, auth flow, detector confidence. | Engineers and reviewers. |
| **`states/*.json`** | Raw per-state captures (DOM fingerprint, a11y snapshot excerpt, detected elements). | Debugging, regression diffing of the model across app versions. |
| **`graph.json`** | The state-transition graph with edges labeled by the action that caused them. | The AI Planner (for sequencing multi-step tests). |
| **`events.jsonl`** | Append-only structured log of every discovery event. | Observability, post-hoc analysis. |

The primary deliverable is **`ram.json`**. Everything else exists to make it trustworthy, debuggable, and reviewable.

---

## 7. Constraints

These constraints are non-negotiable for v1. They bound the problem and protect both the target application and the existing ReplayQA product.

### 7.1 Functional constraints

- **CRUD-only scope.** Only the six application archetypes listed in §1 (PhoneBook-style apps). No general websites.
- **Single origin.** Discovery will not follow links, redirects, or `window.open` targets that leave the configured origin. Same-origin is enforced at the Browser Controller boundary.
- **No destructive actions.** Discovery must not delete real records, submit real orders, or mutate persistent state irreversibly. Create/update probes are permitted only against clearly disposable inputs and only when a cleanup path is identifiable; otherwise they are inferred from structure rather than executed. See `06-exploration.md` §"Action safety".
- **Authentication is operator-supplied.** Discovery never invents credentials. If auth is required and none is provided, Discovery discovers only the unauthenticated surface and reports it.

### 7.2 Product constraints

- **No breaking changes to existing ReplayQA.** The Discovery Engine is purely additive. The existing CLI commands (`npm test`, `npm run replay`, `npm run build`, `npm run typecheck`) must continue to work unchanged. Discovery ships under a new command and a new config namespace. See `08-folder-structure.md`.
- **No new mandatory runtime dependencies that bloat the core.** ReplayQA's selling point includes "zero runtime dependencies — just Playwright". Any dependency recommendation from this design must be justified against that principle (see §9 and the build-vs-buy notes in `03-modules.md` and `04-detectors.md`).
- **Playwright is the only automation layer.** No Selenium, no Puppeteer, no direct CDP. Playwright already provides DOM access, accessibility tree, network interception, and tracing — Discovery builds on all of these.

### 7.3 Operational constraints

- **Discovery must always terminate.** Every run is bounded by explicit budgets (time, pages, actions, requests). Termination conditions are defined in `06-exploration.md`.
- **Discovery must be deterministic given the same app state and seed.** Stable element IDs, canonicalized URLs, and ordered exploration ensure that two runs against the same app version produce structurally equivalent RAMs (differences only where the app itself is non-deterministic).
- **Discovery must be safe to re-run.** Re-running against the same app produces a new `<run-id>` and never mutates prior outputs.

---

## 8. Position in the ReplayQA product

```
┌─────────────────────────────────────────────────────────────────┐
│                       ReplayQA product                          │
│                                                                 │
│   TODAY (shipped)                  NEW                          │
│   ────────────────                  ───                          │
│   CLI                              Discovery Engine ──┐         │
│   Playwright execution                                 │         │
│   Collectors (console/network)                         │         │
│   Reporter (HTML dashboard)                            ▼         │
│   Artifacts (video/screenshot/trace)              RAM (json)    │
│                                                       │          │
│   FUTURE (not in this design)                       │          │
│   ───────────────────────────────                   │          │
│   AI Planner ◄──────────────────────────────────────┘          │
│   Test Generator ◄────── uses RAM                                 │
│   Playwright execution (reused)                                  │
│   Reporter (reused for discovery report)                         │
└─────────────────────────────────────────────────────────────────┘
```

Discovery is the **first ReplayQA feature that understands applications rather than tests**. It reuses the existing Playwright execution layer and the existing reporter infrastructure (so the discovery report feels native to users already familiar with ReplayQA). It introduces exactly one new public-facing artifact format — the RAM — which becomes the contract between ReplayQA's exploration side and its future generation side.

---

## 9. Architectural posture and guiding principles

These principles govern every subsequent decision in this document family. When an engineer faces an ambiguous trade-off, they should default to these.

1. **Model, don't test.** Discovery describes the application. It never emits test code, prompts, or assertions. If a design tempts us to generate tests, push that into the future AI/Test-Generator layers.
2. **Explore states, not URLs.** A URL is a weak identity in a SPA. The unit of exploration is the *application state* (URL + DOM structure + visible interactive surface). See `06-exploration.md`.
3. **Prefer the accessibility tree over raw DOM.** The a11y tree is more stable across styling churn and carries semantic role information that maps directly to CRUD vocabulary. Raw DOM is a fallback signal.
4. **Detectors are pure observers.** A detector reads a state and emits findings; it does not navigate or mutate. The Browser Controller is the only component that touches the browser. This keeps detectors testable and side-effect-free.
5. **Bounded by default.** Every loop has a budget. Every action has a safety classification. Termination is never "we finished", it is always "we exhausted budget or saturated the frontier".
6. **Additive, not invasive.** Nothing in the existing `src/` tree changes to accommodate Discovery. New code lives under `src/discovery/`. New config lives under a new top-level key.
7. **Dependency-minimal.** Before adding any package, justify it against the zero-runtime-deps principle and document the trade-off. Several build-vs-buy decisions are recorded in this doc family.

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **Flow** | A named, ordered, parameterized sequence of steps achieving a user-visible goal (login, create contact, search). The unit the future AI Planner reasons about and the Test Generator expands into code. First-class RAM object since schema 1.1. See `09-flows.md`. |
| **RAM** | ReplayQA Application Model. The versioned JSON output describing the discovered app. |
| **State** | A normalized snapshot of the page at a moment in time: URL, DOM fingerprint, a11y excerpt, visible interactive elements, form values. The unit of exploration. |
| **Finding** | A structured observation emitted by a detector about a state (e.g. "this state contains a login form"). |
| **Detector** | A pure module that reads a State and emits Findings. |
| **Frontier** | The queue of not-yet-explored states. Drained by the Navigation Explorer. |
| **Entity** | A logical data type the app manages (e.g. `Contact`, `Todo`). Inferred from forms and tables. |
| **CRUD Action** | An operation (Create/Read/Update/Delete) bound to an Entity, with an entry point (button/link/form) and a target state. |
| **Blessed extension** | A named, versioned RAM extension namespace shipped with its own sub-schema (`extensions.api`, `extensions.transitions`). More structured than an arbitrary §4.1 extension. |
| **Run** | A single execution of the Discovery Engine against one target, producing one `<run-id>` output directory. |
| **Browser Controller** | The only component permitted to drive Playwright. |
| **Event Bus** | The in-process pub/sub used for loose coupling between modules. See `07-events.md`. |

---

## 11. Document map

| Document | Covers |
|----------|--------|
| `01-overview.md` | This document. What/why/inputs/outputs/constraints. |
| `02-pipeline.md` | End-to-end pipeline and data flow. |
| `03-modules.md` | Internal module breakdown with contracts. |
| `04-detectors.md` | Detector interface and per-detector designs. |
| `05-ram.md` | The RAM schema, objects, relationships, versioning. |
| `06-exploration.md` | Exploration algorithm: discovery, dedup, termination. |
| `07-events.md` | Event catalog and pub/sub topology. |
| `08-folder-structure.md` | File layout, config additions, CLI integration. |
| `09-flows.md` | Flow semantics: step taxonomy, parameters/bindings, composition, cleanup, synthesis. |

Read top to bottom on first pass. Each later document assumes the previous ones.
