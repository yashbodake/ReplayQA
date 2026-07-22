# ReplayQA Architecture

> The definitive technical reference for the ReplayQA Discovery Engine.
> For the full architecture specification, see [`docs/discovery/`](discovery/).

## System Overview

ReplayQA is an autonomous QA discovery engine that explores web applications, understands their structure and behavior using AI, and generates working Playwright tests — all from structured observations, never from raw HTML or screenshots.

```
URL + Credentials
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│                    DISCOVERY ENGINE                       │
│                                                          │
│  BrowserController ──▶ Playwright (sole boundary)        │
│       │                                                  │
│       ▼                                                  │
│  StateManager ──▶ Strategy-E fingerprint + dedup         │
│       │                                                  │
│       ▼                                                  │
│  Action Probes ──▶ buttons, links, inputs, tabs, cards   │
│       │                  (safety policy enforced)        │
│       ▼                                                  │
│  DetectorManager ──▶ typed Findings                     │
│       │                                                  │
│       ▼                                                  │
│  Flow Graph ──▶ transitions + changes + journeys         │
└──────────────────────┬───────────────────────────────────┘
                       │  structured JSON observations
                       ▼
┌──────────────────────────────────────────────────────────┐
│                    AI PIPELINE                            │
│                                                          │
│  Reasoning ──▶ "What is this app?"                       │
│       │          entities, capabilities, blind spots     │
│       ▼                                                  │
│  Planning ──▶ "What should we test?"                    │
│       │          prioritized scenarios, risk, coverage   │
│       ▼                                                  │
│  Approval Gate ──▶ [Y/n]                                 │
│       │                                                  │
│       ▼                                                  │
│  Generation ──▶ "Write the test"                        │
│       │          Playwright test (one scenario)          │
│       ▼                                                  │
│  Reliability Loop ──▶ validate → execute → repair        │
│                                                          │
└──────────────────────┬───────────────────────────────────┘
                       │  passing test
                       ▼
┌──────────────────────────────────────────────────────────┐
│                    EXECUTION + REPORT                     │
│                                                          │
│  Video · Trace · Screenshots · Console · Network · HTML  │
└──────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. BrowserController is the sole Playwright boundary

Only `src/discovery/browser/controller.ts` imports Playwright. Every other module — state manager, probes, detectors, reasoning, planning — is browser-agnostic and unit-testable against fixture data.

```
CLI → core → {state, probes, detectors, flow} → browser → Playwright
```

A grep for `playwright` outside `src/discovery/browser/` is a build violation.

### 2. State identity is structural, not URL-based

URLs are insufficient for SPAs (modals don't change URLs; the same URL can host many states). ReplayQA uses **Strategy E** — a SHA-256 hash of:

```
canonical URL + collapsed a11y role tree + collapsed DOM tag tree
             + deduped interactive surface + component flags + nav signature
```

Validated experimentally across 5 strategies (see `docs/discovery/state-fingerprint-report.md`): 0 false positives, 0 false negatives. The sibling-collapse normalization makes it immune to data-count changes (search filtering, record add/delete).

### 3. Discovery improvements propagate without downstream changes

The reasoning, planning, and generation systems all read the same JSON observations. Richer Discovery (more pages, more probes, more flows) automatically produces better understanding, plans, and tests — verified across 7 milestones.

### 4. Safety by default

The Action Probe system never clicks destructive actions (Delete, Remove, Reset, Logout, payment). Every skipped action is recorded in the transition graph with its classification and reason. The safety policy is fully auditable in `graph.json`.

### 5. Credentials are never persisted

Credentials flow from CLI/env/config → `controller.fill()` only. They are never written to any artifact, log, or report. Verified by grep across all outputs after every credentialed run.

## Module Reference

### BrowserController (`browser/`)

The only Playwright-dependent module. Exposes observation and action primitives:

| Method | Purpose |
|--------|---------|
| `open()` / `close()` | lifecycle |
| `goto(url)` | navigation |
| `click(selector)` | action (returns false if not found) |
| `fill(selector, value)` | text input |
| `pressEnter(selector)` | keyboard |
| `pressEscape()` | dismiss overlays |
| `reload()` | hard reset |
| `waitForStable(ms)` | networkidle + quiet window |
| `currentUrl()` | page URL |
| `currentSnapshot()` | RawSnapshot (buttons, links, forms, tables, inputs, heading, hasPassword) |
| `currentMaterials()` | StateMaterials (fingerprint inputs: DOM tree, a11y tree, interactive, components, nav) |
| `currentNavLinks()` | same-origin navigable anchors |
| `currentActions()` | ALL interaction candidates (buttons, links, inputs, tabs, expanders, cards) |

**Selector type** (runner-agnostic — never Playwright-specific):
```typescript
type Selector = string | { role: string; name?: RegExp | string } | { placeholder: string } | { label: string };
```

### StateManager (`state/`)

Converts raw observations into fingerprinted, deduplicated States.

- `capture()` — gathers materials + snapshot, computes stateId, persists if new
- `computeStateId(materials)` — pure Strategy-E hash
- In-memory `seen` set for dedup
- States persisted to `states/<stateId>.json`

### Action Probes (`probes/`)

Generalized interaction discovery — safely explores interactive UI states.

**6 interaction types**, each with detection, safety, probe strategy, and rollback:

| Type | Detection | Safety | Probe |
|------|-----------|--------|-------|
| Button | `<button>`, `[role=button]` | vocabulary (destructive/probe/unknown) | click |
| Link | `<a>` same-origin, non-nav | destructive-only filter | click |
| Input | `<input type=text/search>`, `<textarea>` | sensitive filter + safe placeholder | type + Enter |
| Tab | `[role=tab]` (inactive) | always safe | click |
| Expander | `[aria-expanded]`, `[aria-controls]`, `<details>` | always safe | click |
| Card | clickable divs (cursor:pointer, onclick, .clickable) | non-destructive filter | click |

Rollback: soft-dismiss (Escape + Close button) + URL-drift recovery (goto base if URL changed). Never reloads (would reset SPA auth).

### Flow Discovery (`flow/`)

Builds on the transition graph:

- **Snapshot diff** — human-readable changes per transition ("Save button appeared", "form opened", "login form removed")
- **Journey builder** — extracts simple paths (root → leaf) as complete user workflows
- **Flow report** — HTML visualization of the state/action/state graph

### Findings Framework (`detectors/`)

Typed observation substrate for future detectors:

```typescript
interface Detector { detect(state: State): Promise<Finding[]> }
```

5 finding categories (discriminated union): `Authentication`, `Table`, `Form`, `Search`, `Navigation`. Each carries confidence, evidence, and a typed payload. The `DetectorManager` runs all detectors, isolates failures, and persists per-state findings.

### Login System (`login/`)

Credentialed exploration with multi-signal verification:

1. Detect login form (visible password field)
2. Fill username (first textbox) + password
3. Click submit (matches /sign in|log in|login|submit|continue/i)
4. **Poll for form removal** (up to 15s — handles slow SPA API calls)
5. **Verify** with 5 signals: URL changed, login form gone, logout visible, user menu visible, dashboard heading

Login is considered successful only when the form is gone AND ≥1 corroboration is observed. Failures produce a `LoginFailedError` with evidence and suggested causes.

### AI Pipeline

Three stages, all reading the same structured JSON observations:

**Reasoning** (`reasoning-lab/`) — asks the LLM "what is this app?" Produces:
- Application type, entities, capabilities, flows
- Confidence score
- Blind spots ("I cannot determine X because ReplayQA has not yet extracted Y")

**Planning** (`qa-planning-lab/`) — asks the LLM to act as a Senior QA Lead. Produces:
- Application summary, critical journeys, functional scenarios (with priority/purpose/preconditions/expected)
- Edge cases, risk assessment, coverage analysis
- Honest blind spots

**Generation** (`run/generate.ts`) — writes ONE Playwright test for the top scenario. Uses role/label-based locators, safe test data, and strict-mode-safe assertions.

### Reliability Pipeline (`run/reliability/`)

Transforms test generation from "generate → execute → maybe repair" into a first-class system:

```
Generate → Static Validate → Execute → Diagnose → Repair → Execute → ... (until pass or max)
```

- **Static validator** — deterministic checks + auto-fixes (e.g., wrap bare `.toBeVisible()` in `expect()`)
- **Diagnostics** — parses Playwright output into structured `RepairDiagnostics` (error type, locator, expected/received, code line, console errors, network failures)
- **Repair engine** — LLM receives scenario + diagnostics + history; must explain why/what/why-should-work
- **Metrics** — first-pass rate, repair rate, avg attempts, failure categories — persisted across runs

## Configuration

### `.env` (project root, gitignored)

```bash
CEREBRAS_API_KEY=your-key           # any OpenAI-compatible key
REASONING_BASE_URL=https://...      # provider endpoint
REASONING_MODEL=model-name          # model ID
```

### `replayqa.config.json`

```json
{
  "outputDir": "./artifacts",
  "artifacts": { ... },
  "playwright": { ... },
  "discovery": {
    "targetUrl": "...",
    "credentials": { "username": "${ENV}", "password": "${ENV}" }
  }
}
```

### Credential precedence

1. CLI flags (`--username` / `--password`) — highest
2. Environment (`REPLAYQA_DISCOVERY_USERNAME` / `_PASSWORD`)
3. Config file (`discovery.credentials` with `${ENV}` interpolation) — lowest

## Artifacts

Every run produces a rich set of artifacts under `artifacts/discovery/`:

| Artifact | Content |
|----------|---------|
| `discovery.json` | Discovered pages (title, buttons, links, forms, tables, inputs) |
| `states/*.json` | Per-state: full snapshot + fingerprint materials |
| `findings/*.json` | Per-state: detector findings |
| `flow-graph.json` | Transition graph (edges with observed changes + skipped actions) |
| `journeys.json` | Extracted user journeys |
| `reasoning.json` | AI understanding (app type, entities, capabilities, blind spots) |
| `test-plan.json` / `.md` | QA test plan (structured + human-reviewable) |
| `flow-report.html` | Flow visualization |
| `reliability-report.html` | Generation timeline + metrics |
| `reliability-metrics.json` | Persisted reliability data |

Execution artifacts (video, trace, screenshots, console/network logs) go to `artifacts/test-output/` and `artifacts/logs/`. The HTML dashboard is at `reports/index.html`.

## Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Browser automation | Playwright 1.61 | sole runtime dependency |
| Language | TypeScript 5.5 (strict) | NodeNext modules |
| Runtime | Node.js 18+ | built-in `fetch`, `crypto` |
| LLM | Any OpenAI-compatible | Olama, Cerebras, OpenAI, Ollama, vLLM |
| Test runner | Playwright Test | existing suite + generated tests |
| Dependencies | Playwright + devDeps | zero other runtime deps |

## Evolution Path

ReplayQA was built milestone-by-milestone, each validated with real evidence:

1. **Architecture** → specification (9 documents)
2. **PoC** → first working discovery
3. **Foundation** → BrowserController refactor
4. **Fingerprint** → 5-strategy lab → Strategy E
5. **State Manager** → production fingerprinting
6. **Findings** → typed framework
7. **AI Reasoning** → LLM understands the app
8. **QA Planning** → test plan generation
9. **MVP** → end-to-end pipeline
10. **v0.2** → reliable generation (static validate + repair loop)
11. **v0.3** → interactive discovery (action probes)
12. **v0.4** → credentialed exploration
13. **v0.5** → flow discovery + journeys
14. **v0.6** → real-world benchmark (6 apps)
15. **v0.7** → multi-type interaction discovery
16. **Interactive CLI** → unified menu

Each milestone produced an evaluation report in `docs/discovery/` with measured evidence.
