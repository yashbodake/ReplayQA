# ReplayQA Documentation Index

> Complete guide to all ReplayQA documentation.

## Start Here

| Document | For | Description |
|----------|-----|-------------|
| [**README.md**](../README.md) | Everyone | Project overview, quick start, commands, benchmarks |
| [**ARCHITECTURE.md**](../ARCHITECTURE.md) | Engineers | Definitive technical reference: modules, design principles, data flow |
| [This file](INDEX.md) | Navigation | Guide to every document in the project |

---

## Architecture Specification (`docs/discovery/`)

The original 9-document architecture spec, written before implementation and validated milestone-by-milestone.

### Design Documents

| # | Document | What it covers |
|---|----------|----------------|
| 01 | [overview.md](discovery/01-overview.md) | What the Discovery Engine is, responsibilities, inputs/outputs, constraints, glossary |
| 02 | [pipeline.md](discovery/02-pipeline.md) | End-to-end pipeline diagram, stage-by-stage, data flow contracts |
| 03 | [modules.md](discovery/03-modules.md) | Internal module breakdown (BrowserController, StateManager, Probes, Detectors, RAM Builder, Reporter) |
| 04 | [detectors.md](discovery/04-detectors.md) | Detector interface, correlation rules, 8 detector designs (Login, Table, Form, CRUD, Search, Navigation, Modal, Toast) |
| 05 | [ram.md](discovery/05-ram.md) | ReplayQA Application Model: objects, relationships, JSON Schema (v1.1 with Flows + blessed extensions) |
| 06 | [exploration.md](discovery/06-exploration.md) | Exploration algorithm (state-keyed BFS), dedup, loop avoidance, action safety, Crawlee evaluation |
| 07 | [events.md](discovery/07-events.md) | Event bus catalog, publishers/subscribers matrix, fact-vs-command discipline |
| 08 | [folder-structure.md](discovery/08-folder-structure.md) | File layout, config additions, CLI integration, dependency ledger |
| 09 | [flows.md](discovery/09-flows.md) | Flow semantics: step taxonomy, parameterization, composition, cleanup |

### Milestone Evaluation Reports

Each milestone produced an evidence-based evaluation report. These are the primary record of what was built, what worked, and what didn't.

| Milestone | Report | Key Finding |
|-----------|--------|-------------|
| State Fingerprint | [state-fingerprint-report.md](discovery/state-fingerprint-report.md) | Strategy E (hybrid) recommended — 0 false positives/negatives |
| State Manager | [state-manager.md](discovery/state-manager.md) | stateId-based dedup works; 4 captures → 2 unique states |
| Findings | [findings.md](discovery/findings.md) | Finding → RAM composition path; 5 categories defined |
| AI Reasoning | [ai-reasoning-report.md](discovery/ai-reasoning-report.md) | LLM infers CRUD from button labels — no CRUD detector needed |
| QA Planning | [qa-planning-report.md](discovery/qa-planning-report.md) | Plan confidence tracks observation quality (0.42 → 0.78) |
| MVP | [mvp-report.md](discovery/mvp-report.md) | Full pipeline works; generation is weakest stage |
| Reliability | [reliability-report.md](discovery/reliability-report.md) | Failures shifted from mechanical to semantic; observation is the bottleneck |
| Interactive Discovery | [interactive-discovery-report.md](discovery/interactive-discovery-report.md) | Action probes unlock modals/forms; Create-valid test passes first-try |
| Credentialed Discovery | [credentialed-discovery-report.md](discovery/credentialed-discovery-report.md) | Multi-signal login verification; credential hygiene verified |
| Flow Discovery | [flow-discovery-report.md](discovery/flow-discovery-report.md) | Flow data raises plan confidence +20%; observed vs inferred flows |
| Benchmark | [benchmark-report.md](discovery/benchmark-report.md) | 6 real apps tested; button-only probing is #1 bottleneck |
| Interaction Discovery | [interaction-discovery-report.md](discovery/interaction-discovery-report.md) | Multi-type probes: TodoMVC 1→5 pages, SauceDemo 4→9 pages |

---

## Quick Reference

### Commands

```bash
npm run replayqa                                    # interactive menu
npm run replayqa -- <url> [--yes] [--headed]        # full pipeline
npm run discover -- <url> [--username U --password P]  # discovery only
npm run reason                                      # AI reasoning
npm run plan                                        # QA planning
npm run fingerprint -- <url>                        # fingerprint analysis
npm run fingerprint:lab                             # fingerprint experiments
npm run reliability                                 # reliability benchmark
npm test                                            # existing test suite
```

### Configuration

```
.env                          API key + provider endpoint + model
replayqa.config.json          artifacts, playwright, discovery settings
```

### Key Source Modules

```
src/discovery/
├── browser/controller.ts     sole Playwright boundary
├── state/manager.ts          StateManager (capture, fingerprint, dedup)
├── state/fingerprint.ts      Strategy E (the project-standard algorithm)
├── probes/runner.ts          multi-type action probes
├── probes/vocabulary.ts      safety policy (destructive/probe/unknown)
├── flow/journey-builder.ts   journey extraction from transition graph
├── detectors/manager.ts      DetectorManager (runs + aggregates findings)
├── login/login.ts            generic login + multi-signal verification
├── core/discover.ts          runDiscovery() orchestrator
├── run/orchestrator.ts       full MVP pipeline
├── run/reliability/loop.ts   generate → validate → execute → repair loop
├── cli/interactive.ts        unified menu-driven CLI
└── models/                   pure data types (State, Finding, etc.)
```

### Artifact Layout

```
artifacts/discovery/          discovery + AI + reliability outputs
artifacts/test-output/        Playwright execution (video, trace, screenshots)
artifacts/logs/               console + network collector output
reports/index.html            HTML dashboard
tests/replayqa-generated.spec.ts   generated Playwright test
```
