# ReplayQA

**Autonomous QA Discovery — explore any web app, understand it, and generate tests.**

ReplayQA autonomously navigates web applications, discovers their structure and interactive states, uses AI to understand what the app does, generates a professional QA test plan, and produces working Playwright tests — all from a single command.

```
npm run replayqa -- https://www.saucedemo.com --username standard_user --password secret_sauce --yes

✓ Discovering application       → 9 pages, 10 flows discovered
✓ Understanding application     → "E-commerce demo" (0.78 confidence)
✓ Generating QA plan            → 11 scenarios
✓ Generating Playwright test    → TC-001: Login with valid credentials
✓ Executing                     → PASSED (first try)
Done.
```

---

## What ReplayQA Does

ReplayQA is **not** a test recorder. It is an **autonomous discovery engine** that:

1. **Explores** a web app by navigating pages, clicking buttons, opening modals, filling inputs, and switching tabs — safely (never clicks Delete, Logout, or other destructive actions).
2. **Fingerprints** every application state using a validated structural hash (not just URLs — it handles SPAs, modals, tabs, and search filters).
3. **Builds a flow graph** recording every transition: "State A —click 'Add Contact'→ State B (modal opened, form fields appeared)."
4. **Extracts journeys** — complete user workflows like "Login → Contacts → Add Contact → Save."
5. **AI Understanding** — feeds the structured observations to an LLM (Olama / Cerebras / any OpenAI-compatible API) which infers application type, entities, and capabilities.
6. **QA Planning** — generates a professional test plan with prioritized scenarios, edge cases, risk assessment, and honest blind spots.
7. **Test Generation** — writes a Playwright test for the highest-priority scenario, with static validation, execution diagnostics, and a self-repair loop.
8. **Reporting** — produces video, trace, screenshots, console/network logs, and an HTML dashboard.

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- An OpenAI-compatible LLM API key (Olama, Cerebras, OpenAI, etc.)

### Install

```bash
git clone https://github.com/yashbodake/ReplayQA.git
cd ReplayQA
npm install
npx playwright install chromium
```

### Configure

Create a `.env` file in the project root (gitignored — never committed):

```bash
# Olama Cloud (recommended — generous free tier)
CEREBRAS_API_KEY=your-olama-key
REASONING_BASE_URL=https://ollama.com/v1
REASONING_MODEL=gpt-oss:120b

# OR Cerebras:
# CEREBRAS_API_KEY=your-cerebras-key
# REASONING_BASE_URL=https://api.cerebras.ai/v1
# REASONING_MODEL=gpt-oss-120b

# OR any OpenAI-compatible provider:
# CEREBRAS_API_KEY=your-key
# REASONING_BASE_URL=https://api.your-provider.com/v1
# REASONING_MODEL=your-model
```

### Run

```bash
# Interactive mode (menu-driven — walks you through everything):
npm run replayqa

# One-shot full pipeline:
npm run replayqa -- https://todomvc.com/examples/vue/dist/ --yes

# With credentials:
npm run replayqa -- https://www.saucedemo.com \
  --username standard_user --password secret_sauce --yes

# Watch the browser:
npm run replayqa -- https://example.com --yes --headed
```

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run replayqa` | **Interactive CLI** — menu-driven access to everything |
| `npm run replayqa -- <url> [--yes]` | **Full pipeline** — discover → reason → plan → generate → execute |
| `npm run discover -- <url>` | **Discovery only** — explore the app, collect states/flows |
| `npm run reason` | **AI Reasoning** — understand the app from observations |
| `npm run plan` | **QA Planning** — generate a test plan |
| `npm run fingerprint -- <url>` | **State fingerprint** — inspect the 5 fingerprint strategies |
| `npm run fingerprint:lab` | **Fingerprint experiments** — validation suite |
| `npm run reliability` | **Reliability benchmark** — measure generation quality |
| `npm run replay` | **Interactive test selector** (original Playwright runner) |
| `npm test` | **Run existing Playwright tests** |
| `npm run build` | **Compile TypeScript** |
| `npm run typecheck` | **Type-check** without emitting |

---

## How It Works

```
                    User provides URL + optional credentials
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │     DISCOVERY        │
                         │  BrowserController   │    sole Playwright boundary
                         │  StateManager        │    Strategy-E fingerprint + dedup
                         │  Action Probes       │    buttons, links, inputs, tabs, cards
                         │  DetectorManager     │    typed findings
                         │  Flow Graph          │    state transitions + changes
                         └─────────┬───────────┘
                                   │  structured JSON observations
                                   ▼
                         ┌─────────────────────┐
                         │   AI REASONING       │    LLM infers: app type, entities,
                         │   (unchanged by      │    capabilities, flows, blind spots
                         │    probes)           │
                         └─────────┬───────────┘
                                   │  reasoning.json
                                   ▼
                         ┌─────────────────────┐
                         │   QA PLANNING        │    Senior-QA-style plan:
                         │   (unchanged)        │    scenarios, edge cases, risks
                         └─────────┬───────────┘
                                   │  test-plan.json + test-plan.md
                                   ▼
                         ┌─────────────────────┐
                         │  HUMAN APPROVAL      │    [Y/n] gate
                         └─────────┬───────────┘
                                   │  approved
                                   ▼
                         ┌─────────────────────┐
                         │  TEST GENERATION     │    LLM writes ONE Playwright test
                         │  + RELIABILITY LOOP  │    static validate → execute → diagnose
                         │                      │    → repair → repeat (up to 3x)
                         └─────────┬───────────┘
                                   │  passing test
                                   ▼
                         ┌─────────────────────┐
                         │  EXECUTION + REPORT  │    video, trace, screenshots,
                         │                      │    console/network logs, HTML dashboard
                         └─────────────────────┘
```

---

## Architecture

### Module Structure

```
src/discovery/
├── browser/              BrowserController — the ONLY Playwright module
│   ├── controller.ts     open, goto, click, fill, currentSnapshot, currentActions, currentNavLinks
│   ├── materials.ts      state-fingerprint extraction (DOM + a11y + interactive + components)
│   └── selector.ts       runner-agnostic Selector type (string | {role,name} | {placeholder} | {label})
│
├── state/                State Manager
│   ├── manager.ts        capture() → State (fingerprinted, deduped, persisted)
│   └── fingerprint.ts    Strategy E: SHA-256(url + a11y + DOM + interactive + components + nav)
│
├── probes/               Action Probe System (v0.7)
│   ├── runner.ts         probes buttons, links, inputs, tabs, expanders, cards
│   ├── vocabulary.ts     safety policy — never probes Delete/Logout/Reset/etc.
│   └── graph.ts          transition graph with observed changes per edge
│
├── flow/                 Flow Discovery (v0.5)
│   ├── snapshot-diff.ts  "Save button appeared", "form opened", etc.
│   ├── journey-builder.ts extracts simple paths (root → leaf) as journeys
│   └── report.ts         flow-report.html (state/action/state visualization)
│
├── detectors/            Findings Framework
│   ├── manager.ts        runs detectors, aggregates findings, isolates failures
│   ├── types.ts          Detector interface: detect(state) → Finding[]
│   └── dummy.ts          placeholder detector (exercises the pipeline)
│
├── login/                Credentialed Exploration (v0.4)
│   ├── login.ts          generic username/password form detection + submission
│   ├── verify.ts         multi-signal verification (form gone + URL/logout/heading)
│   └── failure.ts        LoginFailedError with evidence + suggested causes
│
├── core/                 Discovery Engine
│   ├── discover.ts       runDiscovery() — orchestrates the full exploration
│   ├── context.ts        DiscoveryContext (runId, config, logger, controller, stateManager)
│   └── phases.ts         progress phases (opening, login-start, discovering)
│
├── models/               Data shapes (pure types — no Playwright)
│   ├── state.ts          State { id (fingerprint), url, metadata, snapshot, materials }
│   ├── finding.ts        Finding (discriminated union: auth, table, form, search, navigation)
│   ├── snapshot.ts       RawSnapshot (DOM observation)
│   └── result.ts         DiscoveredPage, DiscoveryResult
│
├── collector/            State → Output transform
│   └── collect.ts        toDiscoveredPage(state) — the human-readable output shape
│
├── cli/                  CLI layer
│   ├── interactive.ts    unified menu-driven CLI
│   ├── run.ts            `npm run discover` entry point
│   ├── args.ts           flag parsing + layered credential resolver
│   └── env.ts            .env file loader (zero-dep)
│
├── run/                  MVP Pipeline + Reliability
│   ├── orchestrator.ts   full pipeline: discover → reason → plan → generate → execute
│   ├── generate.ts       LLM test generation + self-repair
│   ├── execute.ts        runs the generated test via Playwright
│   ├── summary.ts        review summary for the approval gate
│   ├── approval.ts       [Y/n] interactive prompt
│   └── reliability/      static validation, diagnostics, repair loop, metrics, HTML report
│
├── reasoning-lab/        AI Reasoning (experimental → production)
│   ├── collect.ts        loads artifacts → structured JSON payload
│   ├── prompt.ts         system prompt (no handcrafted explanation — tests the architecture)
│   └── llm.ts            OpenAI-compatible call (configurable base URL + model)
│
├── qa-planning-lab/      QA Planning (experimental → production)
│   ├── prompt.ts         Senior QA Lead system prompt
│   ├── llm.ts            generates TestPlan (JSON + Markdown)
│   └── markdown.ts       renders review-ready test-plan.md
│
├── state-lab/            State Fingerprint Laboratory (regression suite)
│   ├── strategies.ts     5 strategies (A-E), E delegates to production computeStateId
│   ├── experiment.ts     controlled fixture experiments
│   └── fixture/          sample-app.html (CRUD) + auth-app.html (authenticated CRUD)
│
└── index.ts              public barrel
```

### Key Design Principles

1. **BrowserController is the only Playwright module.** Everything else is browser-agnostic and unit-testable.
2. **Dependency direction flows downward:** CLI → core → {state, probes, detectors, flow} → browser → Playwright. No upward dependencies.
3. **State fingerprinting is structural, not URL-based.** Handles SPAs, modals, tabs, search — validated experimentally (see `docs/discovery/state-fingerprint-report.md`).
4. **The downstream never changes when Discovery improves.** Reasoning, planning, and generation read the same JSON observations — richer Discovery automatically produces better plans and tests.
5. **Credentials are never persisted.** They flow from CLI/env/config to `controller.fill()` only — verified by grep across all artifacts.
6. **Destructive actions are never probed.** Delete, Remove, Reset, Logout, payment — all classified and skipped with documented reasons.

---

## Configuration

### `.env` (project root, gitignored)

```bash
CEREBRAS_API_KEY=your-api-key
REASONING_BASE_URL=https://ollama.com/v1      # or https://api.cerebras.ai/v1
REASONING_MODEL=gpt-oss:120b                   # or gpt-oss-120b, glm-5.2, etc.
```

### `replayqa.config.json`

```json
{
  "outputDir": "./artifacts",
  "artifacts": { "videos": true, "screenshots": true, "traces": true, "consoleLogs": true, "networkLogs": true },
  "playwright": { "testDir": "./tests", "retries": 0, "workers": "auto" },
  "discovery": {
    "targetUrl": "https://phone-book-yrap.vercel.app/",
    "credentials": {
      "username": "${REPLAYQA_DISCOVERY_USERNAME}",
      "password": "${REPLAYQA_DISCOVERY_PASSWORD}"
    }
  }
}
```

### Credentials (3 sources, highest priority first)

1. **CLI flags:** `--username admin --password secret`
2. **Environment:** `REPLAYQA_DISCOVERY_USERNAME` / `REPLAYQA_DISCOVERY_PASSWORD`
3. **Config file:** `discovery.credentials` with `${ENV_VAR}` interpolation

---

## Outputs

```
artifacts/discovery/
├── discovery.json              discovered pages (title, buttons, links, forms, tables, inputs)
├── reasoning.json              AI understanding (app type, entities, capabilities, blind spots)
├── test-plan.json              structured QA plan
├── test-plan.md                human-reviewable QA plan
├── flow-graph.json             transition graph with observed changes per edge
├── journeys.json               extracted user journeys
├── flow-report.html            flow visualization (state → action → state)
├── reliability-report.html     generation timeline + metrics
├── reliability-metrics.json    persisted reliability data
├── states/                     one JSON per unique state (full snapshot + materials)
├── findings/                   one JSON per state (detector findings)

artifacts/test-output/          Playwright execution artifacts
├── .../video.webm              browser recording
├── .../trace.zip               Playwright trace
└── .../test-finished-1.png     screenshot

artifacts/logs/                 console + network collector output

reports/index.html              self-contained HTML dashboard
tests/replayqa-generated.spec.ts   the generated Playwright test
```

---

## Milestones

| Version | Milestone | Key Result |
|---------|-----------|------------|
| Architecture | Discovery architecture spec | 9 documents covering pipeline, modules, RAM, exploration, events |
| PoC | First vertical slice | `replayqa discover` works, produces `discovery.json` |
| Foundation | BrowserController refactor | Sole Playwright boundary; downward dependencies |
| Fingerprint | State fingerprint lab | Strategy E validated (0 false positives, 0 false negatives) |
| State Manager | Production fingerprinting | stateId-based dedup; states/*.json persisted |
| Findings | Typed finding framework | 5 categories, DetectorManager, per-state persistence |
| Reasoning | AI understanding | LLM infers app type/entities/capabilities from JSON |
| QA Planning | Test plan generation | Senior-QA-style plan with blind spots |
| MVP | End-to-end pipeline | One command: discover → reason → plan → generate → execute |
| v0.2 | Reliable generation | Static validation, diagnostics, repair loop, metrics |
| v0.3 | Interactive discovery | Action probes open modals/forms safely |
| v0.4 | Credentialed exploration | Multi-signal login verification, credential hygiene |
| v0.5 | Flow discovery | Transition graph with changes, journey builder |
| v0.6 | Real-world benchmark | 6 apps tested (TodoMVC, SauceDemo, The Internet, OrangeHRM) |
| v0.7 | Interaction discovery | Buttons + links + inputs + tabs + expanders + cards |
| Interactive CLI | Unified menu | One command, menu-driven, session state |

---

## Benchmarked Applications

| App | Pages | Flows | Plan Confidence | Status |
|-----|-------|-------|-----------------|--------|
| **SauceDemo** (e-commerce) | 9 | 10 | 0.78 | Full pipeline, test passed |
| **TodoMVC** (Vue SPA) | 5 | 10 | 0.71 | Full pipeline, test passed first-try |
| **The Internet** (playground) | 11 | 9 | 0.62 | Discovery + reasoning |
| **PhoneBook** (CRUD) | 8 | 14 | — | Discovery with real credentials |
| **Auth/CRUD Fixtures** | 3–5 | 1–2 | 0.71–0.78 | Validated controls |

---

## Demo App — PhoneBook Pro

The test suite runs against [Phonebook Pro](https://phone-book-yrap.vercel.app/), a full-stack contact management app (Vue 3 + FastAPI + PostgreSQL).

**Source:** [github.com/yashbodake/PhoneBook](https://github.com/yashbodake/PhoneBook)

ReplayQA discovers 8/9 PhoneBook features: Login, Register, Add Contact, Search, Contact Details, Edit, Delete (visible), Logout.

---

## Documentation

All architecture and evaluation documents live in `docs/discovery/`:

| Document | Covers |
|----------|--------|
| [`01-overview.md`](docs/discovery/01-overview.md) | What the Discovery Engine is, inputs/outputs, constraints |
| [`02-pipeline.md`](docs/discovery/02-pipeline.md) | End-to-end pipeline and data flow |
| [`03-modules.md`](docs/discovery/03-modules.md) | Internal module breakdown with contracts |
| [`04-detectors.md`](docs/discovery/04-detectors.md) | Detector interface and per-detector designs |
| [`05-ram.md`](docs/discovery/05-ram.md) | ReplayQA Application Model (schema 1.1 with Flows) |
| [`06-exploration.md`](docs/discovery/06-exploration.md) | Exploration algorithm + Crawlee evaluation |
| [`07-events.md`](docs/discovery/07-events.md) | Event catalog and pub/sub topology |
| [`08-folder-structure.md`](docs/discovery/08-folder-structure.md) | File layout, config additions, CLI integration |
| [`09-flows.md`](docs/discovery/09-flows.md) | Flow semantics: step taxonomy, composition |
| [`state-fingerprint-report.md`](docs/discovery/state-fingerprint-report.md) | 5 strategies compared, Strategy E recommended |
| [`state-manager.md`](docs/discovery/state-manager.md) | State lifecycle, dedup, lab regression |
| [`findings.md`](docs/discovery/findings.md) | Finding → RAM composition |
| [`ai-reasoning-report.md`](docs/discovery/ai-reasoning-report.md) | AI understanding experiment |
| [`qa-planning-report.md`](docs/discovery/qa-planning-report.md) | QA plan evaluation |
| [`mvp-report.md`](docs/discovery/mvp-report.md) | MVP end-to-end evaluation |
| [`reliability-report.md`](docs/discovery/reliability-report.md) | Generation reliability metrics |
| [`interactive-discovery-report.md`](docs/discovery/interactive-discovery-report.md) | Action probe system |
| [`credentialed-discovery-report.md`](docs/discovery/credentialed-discovery-report.md) | Login + authenticated exploration |
| [`flow-discovery-report.md`](docs/discovery/flow-discovery-report.md) | Flow graph + journey builder |
| [`benchmark-report.md`](docs/discovery/benchmark-report.md) | 6-app real-world benchmark |
| [`interaction-discovery-report.md`](docs/discovery/interaction-discovery-report.md) | Multi-type interaction probes |

---

## Tech Stack

- **Playwright** — browser automation (sole dependency for browser interaction)
- **TypeScript** — strict mode, NodeNext modules
- **Node.js 18+** — CLI tooling, built-in `fetch`, `crypto`
- **Zero runtime dependencies** beyond Playwright (the `.env` loader, hash, URL canonicalization are all hand-rolled)
- **Any OpenAI-compatible LLM** — Olama Cloud, Cerebras, OpenAI, Ollama, vLLM, etc.

---

## License

MIT

---

<div align="center">

**Built by [Yash Bodake](https://github.com/yashbodake)**

*Discover. Understand. Test.*

</div>
