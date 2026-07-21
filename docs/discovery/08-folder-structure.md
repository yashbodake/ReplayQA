# 08 — Folder Structure, Config, and CLI Integration

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`..`07-events.md`.

This document specifies **where the Discovery Engine lives on disk**, **how its configuration extends `replayqa.config.json` additively**, and **how a new CLI command exposes it without disturbing any existing ReplayQA command**. No code is written here; the layout is a contract for the implementing team.

The governing principle, restated from `01-overview.md` §7.2: **the Discovery Engine is purely additive.** Nothing under the existing `src/` tree is renamed, moved, or has its behavior changed. A user who never invokes Discovery must see no difference in `npm test`, `npm run replay`, `npm run build`, or `npm run typecheck`.

---

## 1. Current repository layout (for reference, unchanged)

```
ReplayQA/
├── src/
│   ├── cli/                 existing: interactive selector, test discovery, run
│   ├── collectors/          existing: console + network collectors
│   ├── config/              existing: config loader + types + defaults
│   ├── reporter/            existing: Playwright reporter + HTML generator
│   ├── runner/              existing: test fixtures
│   ├── utils/               existing: path utils
│   └── index.ts             existing: public barrel
├── tests/                   existing: Playwright test suite (PhoneBook demo)
├── artifacts/               existing: per-run test artifacts
├── reports/                 existing: HTML dashboard output
├── ReplayQA-docs/           existing: internal one-line docs
├── docs/                    NEW root for richer external docs (this family)
├── playwright.config.ts     existing (unchanged)
├── replayqa.config.json     existing (additively extended — see §5)
├── package.json             existing (additively extended — see §6)
└── tsconfig.json            existing (unchanged)
```

Everything in the **existing** blocks stays as-is. Everything in the **NEW** blocks is added by this design.

---

## 2. New top-level layout

```
ReplayQA/
├── docs/
│   └── discovery/                       ← this document family (architecture spec)
│       ├── 01-overview.md
│       ├── 02-pipeline.md
│       ├── 03-modules.md
│       ├── 04-detectors.md
│       ├── 05-ram.md                   ← targets schema 1.1.0 (Flows + blessed extensions)
│       ├── 06-exploration.md
│       ├── 07-events.md
│       ├── 08-folder-structure.md
│       └── 09-flows.md                 ← Flow semantics (step taxonomy, params/bindings, composition)
│
├── src/
│   └── discovery/                       ← all Discovery Engine code lives here
│       ├── orchestrator/
│       ├── browser/
│       ├── state/
│       ├── navigation/
│       ├── detectors/
│       ├── ram/
│       ├── reporter/
│       ├── events/
│       ├── config/
│       └── utils/
│
├── artifacts/
│   └── discovery/                       ← discovery output root (created per run)
│       └── <run-id>/                    ← one directory per run
│
└── (everything else unchanged)
```

Three additions, all isolated:

1. `docs/discovery/` — architecture documents (already created by this phase).
2. `src/discovery/` — engine source (a single new top-level folder under `src/`).
3. `artifacts/discovery/` — runtime output (sibling to the existing `artifacts/test-output/` and `artifacts/logs/`).

No existing folder is touched.

---

## 3. `src/discovery/` internal layout

Mirrors the modules from `03-modules.md`. Each module folder follows the **existing ReplayQA convention** seen in `src/collectors/` and `src/config/`: a `index.ts` barrel, a `types.ts` for interfaces, and one or more implementation files. (Listing `.ts` filenames here is *folder design*, not implementation.)

```
src/discovery/
├── index.ts                          ← public barrel for the Discovery subsystem
│
├── orchestrator/
│   ├── index.ts
│   ├── types.ts                      ← DiscoveryResult, RunContext
│   ├── run.ts                        ← runDiscovery() entry point
│   └── budgets.ts                    ← budget counters + watchdog
│
├── browser/
│   ├── index.ts
│   ├── types.ts                      ← RawSnapshot, ActionResult, NavigationResult
│   ├── controller.ts                 ← the sole Playwright importer
│   ├── safety.ts                     ← origin + destructive-action enforcement
│   └── stabilization.ts              ← quiet-window detection
│
├── state/
│   ├── index.ts
│   ├── types.ts                      ← State, ElementRef, FormSnapshot
│   ├── capture.ts                    ← RawSnapshot → State
│   ├── identity.ts                   ← stateId hashing + dedup
│   └── persist.ts                    ← writes states/<state-id>.json
│
├── navigation/
│   ├── index.ts
│   ├── types.ts                      ← Action, Edge, FrontierEntry
│   ├── explorer.ts                   ← the BFS loop (06-exploration.md §13)
│   ├── candidates.ts                 ← enumerate candidate actions
│   ├── classify.ts                   ← action safety classifier
│   └── graph.ts                      ← state-graph writer (graph.json)
│
├── detectors/
│   ├── index.ts                      ← registry + manager barrel
│   ├── types.ts                      ← Detector, Finding, Evidence, DetectorContext
│   ├── manager.ts                    ← scheduling + correlation + timeouts
│   ├── verbs.ts                      ← CRUD synonym dictionary (shared)
│   ├── login/
│   │   ├── index.ts
│   │   └── login-detector.ts
│   ├── table/
│   │   ├── index.ts
│   │   └── table-detector.ts
│   ├── form/
│   │   ├── index.ts
│   │   └── form-detector.ts
│   ├── crud/
│   │   ├── index.ts
│   │   └── crud-detector.ts          ← consumes form/table/login/search findings
│   ├── search/
│   │   ├── index.ts
│   │   └── search-detector.ts
│   ├── navigation-detection/         ← named to avoid clashing with src/discovery/navigation/
│   │   ├── index.ts
│   │   └── navigation-detector.ts
│   ├── modal/
│   │   ├── index.ts
│   │   └── modal-detector.ts
│   └── toast/
│       ├── index.ts
│       └── toast-detector.ts
│
├── ram/
│   ├── index.ts
│   ├── types.ts                      ← ApplicationModel mirror of 05-ram.md §3 (incl. Flow family)
│   ├── builder.ts                    ← findings → model
│   ├── resolve.ts                    ← entity binding, CRUD correlation
│   ├── flows.ts                      ← Flow synthesis (parameterized sequences; 09-flows.md)
│   ├── extensions.ts                 ← populates blessed extensions (api, transitions)
│   ├── validate.ts                   ← ajv-based validation (core + extension sub-schemas)
│   ├── schema.json                   ← the RAM JSON Schema, versioned per 05-ram.md §6 (targets 1.1.0)
│   ├── extensions/
│   │   ├── api.schema.json           ← blessed sub-schema for extensions.api (05-ram.md §4.3.1)
│   │   └── transitions.schema.json   ← blessed sub-schema for extensions.transitions (§4.3.2)
│   └── persist.ts                    ← writes ram.json
│
├── reporter/
│   ├── index.ts
│   ├── types.ts
│   ├── html-report.ts                ← renders discovery-report.html
│   └── views/                        ← render fragments (summary, matrix, auth, …)
│
├── events/
│   ├── index.ts
│   ├── types.ts                      ← Event map (name → payload)
│   ├── bus.ts                        ← the in-process pub/sub
│   └── journal.ts                    ← events.jsonl append-only sink + replay()
│
├── config/
│   ├── index.ts
│   ├── types.ts                      ← DiscoveryConfig (full schema)
│   ├── defaults.ts                   ← budget + detector defaults
│   └── loader.ts                     ← merges file → env → CLI; reuses src/config/
│
└── utils/
    ├── index.ts
    ├── hash.ts                       ← hashCanonical (Node crypto)
    ├── url.ts                        ← canonicalizeUrl (adopts normalize-url; see §7)
    ├── locator.ts                    ← stableLocator
    ├── slug.ts
    ├── redact.ts                     ← header + secret redaction
    └── log.ts                        ← scoped logger → run.log
```

### 3.1 Naming note: `navigation/` vs `navigation-detection/`

`src/discovery/navigation/` is the **Navigation Explorer** module (frontier, edges, action classification — `03-modules.md` §3.4). `src/discovery/detectors/navigation-detection/` is the **NavigationDetector** (a pure observer that maps nav landmarks — `04-detectors.md` §6.6). They are different concerns; the slightly awkward folder name on the detector side is intentional to prevent an import-path collision and to keep the explorer's namespace unambiguous.

### 3.2 Import-path discipline (enforced)

- `src/discovery/**` may import from `src/` shared utilities (`src/utils/`, `src/config/`, `src/collectors/` for reuse) and from its own subtree.
- `src/discovery/detectors/**` may **not** import `playwright`, `src/discovery/browser/**`, or anything browser-bound.
- `src/discovery/ram/**` and `src/discovery/reporter/**` may **not** import `playwright` or `src/discovery/browser/**`.
- Only `src/discovery/browser/**` imports `playwright`.

These rules can be enforced statically (e.g. an ESLint `no-restricted-imports` rule or a lightweight `scripts/check-discovery-imports.mjs` run in CI). The check is part of the implementation work, not this spec, but the rules are normative.

---

## 4. `artifacts/discovery/` output layout

One directory per run, named by `run-id` (`YYYYMMDD-HHMMSS-<short-hash>`):

```
artifacts/discovery/
└── <run-id>/
    ├── ram.json                       ← primary output (05-ram.md)
    ├── graph.json                     ← state-transition graph
    ├── discovery-report.html          ← self-contained HTML report
    ├── events.jsonl                   ← full event stream (07-events.md §8)
    ├── run.log                        ← plain-text execution log
    ├── config.snapshot.json           ← the resolved DiscoveryConfig for this run
    └── states/
        ├── <state-id>.json            ← raw captured states (for diff/debug)
        └── …
```

This mirrors the existing two-tier pattern (`artifacts/test-output/<test>/…` and `artifacts/logs/<browser>/<test>/…`) so operators familiar with ReplayQA's artifacts layout find discovery outputs in a natural place. The existing `replayqa.config.json:outputDir` (`"./artifacts"`) is respected; discovery writes under `<outputDir>/discovery/<run-id>/`.

---

## 5. Config additions (`replayqa.config.json`)

A new top-level `discovery` key is added. It is **optional** — its absence means Discovery is simply not configured, and existing ReplayQA behavior is unaffected. The existing loader (`src/config/`) is reused and extended to validate this key only when present.

### 5.1 Additive shape

```json
{
  "outputDir": "./artifacts",
  "artifacts":      { "…": "unchanged" },
  "playwright":     { "…": "unchanged" },

  "discovery": {
    "targetUrl":   "https://phone-book-yrap.vercel.app/",
    "credentials": { "username": "${DISCOVERY_USER}", "password": "${DISCOVERY_PASS}" },
    "scope":       { "allow": ["/**"], "deny": ["/admin/**", "/settings/billing"] },
    "budgets": {
      "maxWallClockMs":       300000,
      "maxStates":            200,
      "maxActions":           1000,
      "maxActionsPerState":   20,
      "maxDepth":             6,
      "maxNetworkRequests":   5000,
      "perActionTimeoutMs":   15000,
      "stabilizationMs":      500,
      "stallMs":              60000
    },
    "exploration": { "allowReversibleProbes": true, "observeEffects": true },
    "browserOptions": { "headless": true, "viewport": { "width": 1280, "height": 720 } },
    "detectors": {
      "enabled": ["login","table","form","crud","search","navigation","modal","toast"],
      "minConfidence": 0.5,
      "overrides": {
        "crud": { "minConfidence": 0.55 },
        "table": { "minConfidence": 0.5 }
      }
    },
    "flows": {
      "enabled": true,
      "minConfidence": 0.6,
      "synthesizeCleanup": true,
      "parameters": {
        "flow-contact-create": { "contact.name": "qa-smoke-contact" }
      }
    },
    "extensions": {
      "api":         { "populated": "automatic" },
      "transitions": { "populated": "automatic" }
    },
    "outputDir": "./artifacts/discovery"
  }
}
```

### 5.2 Field reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `targetUrl` | **yes** (when invoking discovery) | — | Seed URL; must be absolute. |
| `credentials` | no | none | `username`/`password`/optional `otp`. Supports `${ENV_VAR}` interpolation. Never written to artifacts. |
| `scope.allow` / `scope.deny` | no | `["/**"]` / `[]` | Glob path allow/deny lists. |
| `budgets.*` | no | see §5.1 | Hard limits; every loop path checks them. Defaults match `06-exploration.md` §6.3. |
| `exploration.allowReversibleProbes` | no | `true` | Whether write-reversible create/edit probes may run. |
| `exploration.observeEffects` | no | `true` | Whether to re-capture states to observe action effects. |
| `browserOptions.*` | no | inherits ReplayQA launchOptions | Passed to the Browser Controller. |
| `detectors.enabled` | no | all eight | Subset of detector ids to run. |
| `detectors.minConfidence` | no | `0.5` | Global promotion threshold. |
| `detectors.overrides.<id>.*` | no | — | Per-detector thresholds/tuning. |
| `flows.enabled` | no | `true` | Whether the RAM Builder synthesizes Flow objects (schema 1.1). When `false`, `ram.json` is emitted at `schemaVersion` 1.0.0 with no `flows` array. |
| `flows.minConfidence` | no | `0.6` | Promotion threshold for synthesized flows (higher than per-detector; Flows aggregate lower-level findings). |
| `flows.synthesizeCleanup` | no | `true` | Pair create ↔ delete flows on the same entity and set `cleanupFlowId`. |
| `flows.parameters.<flowId>.<param>` | no | — | Overrides for Parameter defaults (e.g. force a specific smoke-test value). |
| `extensions.api.populated` | no | `"automatic"` | Controls the `extensions.api` namespace: `"automatic"` (lift from observed network), `"off"` (omit). `"enriched"` is reserved for a future OpenAPI merge. |
| `extensions.transitions.populated` | no | `"automatic"` | Controls `extensions.transitions`: `"automatic"` (lift graph + detector guards), `"off"` (omit). |
| `outputDir` | no | `<root outputDir>/discovery` | Where run directories are written. |

### 5.3 Backwards compatibility

- The schema for `replayqa.config.json` gains `discovery` as an **optional** property. Existing files without it validate and load exactly as before.
- The existing `findConfigSync()` loader is extended to *also* surface `discovery` when present; it does not change how `artifacts` or `playwright` are resolved.
- Environment interpolation (`${VAR}`) is added for the `credentials` block only; it does not affect other config values.

---

## 6. CLI integration

A **new** command is added. Existing commands are untouched.

### 6.1 `package.json` scripts (additive)

```json
{
  "scripts": {
    "test":              "playwright test",
    "test:headed":       "playwright test --headed",
    "replay":            "npx tsx src/cli/run.ts",
    "build":             "tsc",
    "typecheck":         "tsc --noEmit",

    "discover":          "npx tsx src/discovery/cli/run.ts"
  }
}
```

Only the `discover` line is added. The other five scripts are byte-identical to today.

### 6.2 Discovery CLI entry point (layout only, not implementation)

```
src/discovery/cli/
├── index.ts
├── run.ts               ← parses argv, loads config, calls runDiscovery()
└── args.ts              ← CLI flag definitions (--target, --headless, --dry-run, --resume, …)
```

Note: `src/discovery/cli/` is deliberately separate from the existing `src/cli/` (which owns the test selector). They share no code paths and cannot interfere. The existing `src/cli/` is not modified.

### 6.3 Supported invocations

```
npm run discover                                 # uses replayqa.config.json → discovery.*
npm run discover -- --target https://x.example   # CLI overrides config
npm run discover -- --headless false             # watch the exploration
npm run discover -- --dry-run                    # plan only, perform no action (future: §11 of 06)
npm run discover -- --resume <run-id>            # continue a prior run      (future: §11 of 06)
npm run discover -- --scope-deny "/admin/**"
```

Exit codes:

- `0` — clean or partial success (RAM written and validated).
- `2` — usage / config error.
- `3` — run failed (fatal error; partial outputs flushed).

### 6.4 What does **not** change

| Existing command | Behavior | Changed? |
|------------------|----------|----------|
| `npm test` | Runs Playwright tests | No |
| `npm run replay` | Interactive test selector | No |
| `npm run test:headed` | Headed Playwright run | No |
| `npm run build` | `tsc` compile | No (but `src/discovery/**` is now included — see §6.5) |
| `npm run typecheck` | `tsc --noEmit` | No (same note) |

### 6.5 `tsconfig.json`

The existing `tsconfig.json` already uses `"include": ["src/**/*"]`, so `src/discovery/**` is automatically part of compilation and type-checking. **No change required.** The `rootDir: "./src"` and `outDir: "./dist"` settings mean discovery compiles to `dist/discovery/`, consistent with everything else.

---

## 7. Dependency decisions (summary)

This is the consolidated build-vs-buy ledger for the whole engine, repeated from the per-module notes so it can be reviewed in one place.

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Browser automation | **Reuse Playwright** (already a dep) | Chosen engine; provides DOM, a11y, network, tracing. |
| Event bus | **Build** on Node `events.EventEmitter` | Volume is low; typing + file sink are small wrappers. |
| Config loading | **Reuse + extend** existing `src/config/` | Same mechanism, additive schema. |
| JSON Schema validation | **Adopt `ajv`** as devDependency | Standard, fast, draft-2020-12; used for config + RAM. |
| URL canonicalization | **Adopt `normalize-url`** (the one recommended runtime exception) | Small, focused, handles long URL edge-case tail. Hand-roll only if strict zero-deps is mandated. |
| Hashing / ids | **Build** on Node `crypto` | Built-in; deterministic. |
| CRUD verb matching | **Hand-roll** a synonym table | Tiny vocabulary; fuzzy lib adds nondeterminism for no gain. |
| HTML report | **Reuse** `src/reporter/html-generator.ts` conventions | Native look; no new dep. |
| Crawler framework (Crawlee) | **Do not adopt** for v1 | URL-keyed dedup wrong for SPAs; anchor-centric; heavy dep footprint; safety must be ours anyway. Borrow its patterns instead. See `06-exploration.md` §12. |
| Playwright `codegen` | **Do not use** | Records human interactions into tests; does not produce a model. Not an alternative to Discovery. |
| LLM in the loop | **Out of scope** | Detectors are deterministic. AI consumes the RAM later. |

Net new runtime dependency proposed: **`normalize-url`** (one). Net new devDependency proposed: **`ajv`** (one). Everything else is reuse or hand-rolled. This preserves ReplayQA's minimal-dependency ethos while admitting the two libraries that materially improve correctness (URL edge cases, schema validation).

---

## 8. Build, typecheck, and CI implications

- `npm run build` now also compiles `src/discovery/**` → `dist/discovery/**`. No config change needed (existing `include`).
- `npm run typecheck` covers discovery code automatically.
- CI pipelines that run `npm ci && npm run build && npm test` require **no changes** to keep doing what they do today. A Discovery CI job is a *new*, optional addition:

```
- npm ci
- npm run typecheck
- npm run discover -- --target $SEED_URL --headless true
- upload artifacts/discovery/<latest>/
```

No existing job is altered.

---

## 9. Rollout checklist (for the implementing team)

When the team begins implementation, this is the order in which the pieces become runnable, smallest-blame-first:

1. `events/`, `config/`, `utils/` — foundations; unit-testable in isolation.
2. `browser/` controller + `state/` capture + identity — can drive a real browser and produce `states/*.json` with dedup.
3. `detectors/` (Navigation, Modal, Toast, Search first; then Form, Table, Login; then CRUD) — each testable against captured-state fixtures.
4. `navigation/` explorer — wires the loop; produces `graph.json`.
5. `ram/` builder + core schema + validation — produces a **1.0.0** `ram.json` (no flows, no blessed extensions).
6. `ram/flows.ts` + `ram/extensions.ts` + the two extension sub-schemas — promotes the same model to **1.1.0**: synthesizes Flows, lifts `extensions.api` / `extensions.transitions`. This step is purely additive on top of step 5 and can land later in the same milestone.
7. `reporter/` — produces `discovery-report.html` (including a Flows view and a CRUD/flow coverage panel).
8. `orchestrator/` + `cli/` — end-to-end `npm run discover`.

Each step is independently demoable and independently testable, which is the property that lets the team ship Discovery incrementally rather than as a big-bang feature. Step 6 in particular is designed to be **feature-flagged** (`discovery.flows.enabled`, default `true`): turning it off regresses cleanly to a 1.0.0 model, which is how operators can isolate whether a problem is in core modeling or in Flow synthesis.

---

## 10. Summary

- **One new top-level source folder:** `src/discovery/`.
- **One new docs folder:** `docs/discovery/` (this family, 9 documents — `09-flows.md` was added with the RAM 1.1 enhancement).
- **One new output folder:** `artifacts/discovery/<run-id>/`.
- **One new CLI command:** `npm run discover`.
- **One new config key:** `discovery` (optional, additive; gains `flows` and `extensions` sub-keys in 1.1).
- **One new runtime dep:** `normalize-url` (recommended exception).
- **One new devDep:** `ajv` (validates core schema **and** the two blessed extension sub-schemas).
- **Zero** changes to existing commands, existing config semantics, or existing test behavior.

Discovery is added the way a good extension should be added: visibly, locally, and reversibly.
