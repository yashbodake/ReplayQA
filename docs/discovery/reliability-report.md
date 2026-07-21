# ReplayQA v0.2 — Reliable Test Generation Report

> Status: **Reliability milestone.**
> Code: `src/discovery/run/reliability/`. Orchestrator wired in
> `src/discovery/run/orchestrator.ts`.
> Metrics: `artifacts/discovery/reliability-metrics.json`.
> Reproduce: `CEREBRAS_API_KEY=… npm run reliability -- [artifactsDir] [--iterations N] [--reset]`

## What this milestone built

The MVP's "generate → execute → maybe repair once" was promoted to a first-class
**Generation Reliability Pipeline**:

```
generate → static-validate → execute → diagnose → repair → execute → … (until pass or maxRepairAttempts)
```

| Component | File | Role |
|-----------|------|------|
| Static validator | `reliability/static-validate.ts` | Deterministic checks + safe auto-fixes (no LLM) before execution |
| Failure diagnostics | `reliability/diagnose.ts` | Normalizes Playwright output + collector logs into a structured `RepairDiagnostics` (no raw logs to the model) |
| Repair engine | `reliability/repair.ts` | LLM repair with scenario + diagnostics + validation findings + full history; returns a required structured explanation |
| Reliability loop | `reliability/loop.ts` | `generateUntilPass()` — the configurable generate→validate→execute→diagnose→repair loop |
| Metrics | `reliability/metrics.ts` | First-pass rate, repair rate, avg attempts, failure categories — persisted across runs |
| HTML report | `reliability/report.ts` | Timeline + metrics + final code in one self-contained document |
| Benchmark | `reliability/benchmark.ts` | `npm run reliability` — runs the loop N times for statistical evidence |

Constraints respected: Discovery, StateManager, BrowserController, AI Reasoning,
and QA Planning were **not modified**. The orchestrator now calls the loop
instead of the MVP's single retry, and records a `RunRecord` per run.

## How the evidence was collected

`npm run reliability` isolates the generation-reliability question: it reuses
existing artifacts (discovery / reasoning / plan), picks the QA plan's
top-priority scenarios, and runs the full loop once per iteration, recording a
`RunRecord` for each. The benchmark was run against the CRUD fixture's
artifacts (the only target where execution can fully succeed). The aggregate
below is computed over **5 recorded runs** (cycling through the plan's top
scenarios), persisted in `reliability-metrics.json`.

## Measured results

Per-run detail:

```
 • Create a new contact with a valid name    | pass: true  | 1st: false | attempts: 4 | repairs: 3 | detFixed: 0
 • Attempt to create a contact with an empty | pass: false | 1st: false | attempts: 4 | repairs: 3 | detFixed: 0
 • Create a new contact with a valid name    | pass: true  | 1st: false | attempts: 2 | repairs: 1 | detFixed: 0
 • Attempt to create a contact with an empty | pass: false | 1st: false | attempts: 4 | repairs: 3 | detFixed: 0
 • Edit an existing contact with a new valid | pass: false | 1st: false | attempts: 4 | repairs: 3 | detFixed: 0
```

Aggregate (5 runs):

| Metric | Value |
|--------|-------|
| Passed | 2 / 5 (40%) |
| First-pass success rate | **0%** |
| Repair success rate (of runs needing repair) | **40%** |
| Avg attempts | 3.60 |
| Avg / median repairs used | 2.60 / 3 |
| Deterministic fixes applied | 0 |
| Failure categories | expect-failed ×12, timeout ×2, api-misuse ×1, other ×1 |

## Final evaluation (the four required questions, from the metrics)

### 1. What percentage of failures were prevented by static validation?

**0% in this sample** (`deterministicallyFixed = 0` across all 5 runs).

This is not because the validator is inert — it is because the failure mode in
this sample shifted *away* from what it can deterministically fix. The
validator's auto-fix wraps bare single-line assertion calls in `expect(...)`
(the exact mistake the MVP fought: `locator.toBeVisible()`). In these 5 runs
the model's single-line Playwright API happened to be correct, so the auto-fix
never triggered.

There is one caveat exposed by the data: one run recorded an `api-misuse`
failure (a `TypeError: … is not a function`) that reached execution — a
**multi-line** assertion the single-line auto-fix does not cover. So the
validator has a real gap (multi-line assertions), and at least one failure in
this sample would have been prevented by extending it.

### 2. What percentage required LLM repair?

**100% of runs required repair** (0% first-pass), and the repair loop
recovered **40% (2 / 5)** of them. The other 60% exhausted `maxRepairAttempts`
(3) without converging.

The two recovered runs were both the "Create a new contact with a valid name"
scenario — recovered in 1 and 3 repairs respectively. The three unrecovered
runs were "Create with an empty name" (×2) and "Edit" (×1): each asserts
behavior the application does not exhibit in any way ReplayQA observed (a
validation error message; a prefilled edit form), so no amount of repair can
make the assertion pass.

### 3. What are the three most common generation mistakes?

By category frequency across all 16 recorded failures:

1. **`expect-failed` — 12 / 16 (75%).** A semantic assertion mismatch: the
   test asserts something the app does not do (e.g. "a validation error is
   shown for an empty name" when the app silently rejects empties; "the edit
   form is prefilled" when no edit form was ever observed). This is **not a
   generation bug** — the test is well-formed Playwright; it is wrong about
   the app's behavior because ReplayQA never observed that behavior.
2. **`timeout` — 2 / 16.** A locator targeted an element that never appeared
   (the generator guessed a structure that wasn't there).
3. **`api-misuse` — 1 / 16.** A multi-line assertion called on a locator
   (slipped past the single-line static auto-fix).

The dominant MVP-era mechanical mistakes — bare `expect()`-wrapping,
hardcoded `toHaveCount(N)`, `getByText` strict-mode ambiguity — **did not
appear** in this sample. The generation prompt (carried over from the MVP's
final, tightened version) plus the static validator appear to have suppressed
them; the residual failures are now almost entirely semantic.

### 4. What should be improved next (based on this evidence)?

**Observe interactive states.** 75% of failures (the `expect-failed` bucket)
are not generation mistakes at all — they are tests asserting app behavior
ReplayQA never captured (validation feedback, edit-form prefill, modal form
fields). The reliability pipeline correctly *diagnoses* these (it reports
`expect-failed` with the exact expected/received mismatch) but cannot
*manufacture* the missing observations. Until Discovery opens forms/modals
and captures validation feedback, the planner will keep emitting scenarios
the generator cannot make pass.

Evidence-ranked follow-ups:

1. **Action-probe exploration in Discovery** (open the Add/Edit forms, capture
   their fields + validation behavior). This is the same #1 item flagged by
   Milestones 3, 4, and the MVP — four independent measurements now converge
   on it. It would convert the dominant `expect-failed` failures into
   passable, well-grounded scenarios.
2. **Extend the static validator to multi-line assertions.** Cheap, and would
   have prevented the one `api-misuse` failure observed here.
3. **A `ListDetector`** (rows/cards, not just `<table>`) so per-row actions
   and item counts are observed — removes the `timeout` failures where the
   generator guesses a list structure.

## What the milestone achieved (honestly)

- **The reliability infrastructure is in place and working**: deterministic
  static validation, structured failure diagnostics, an LLM repair engine with
  required explanations, a configurable loop, persisted metrics, and a
  timeline HTML report. Every attempt is now auditable.
- **The repair loop recovers real failures** — 40% of runs that needed repair
  eventually passed, including a Create flow that took the generator 3
  iterations to get right.
- **The failure mode shifted from mechanical to semantic.** The MVP's failures
  were Playwright API mistakes (expect-wrapping, strict-mode). After this
  milestone, those are gone from the sample; what remains is tests that are
  *correct Playwright* but *wrong about the app* — a fundamentally different
  and harder class that points squarely at observation completeness.

## What the milestone did NOT achieve

- **First-pass success rate did not improve over the MVP baseline (still 0%)**
  in this sample — but the *reason* changed: the MVP failed first-pass on
  mechanical mistakes; this sample fails first-pass on semantic mismatches
  against unobserved behavior. The mechanical class is now rare.
- **Deterministic prevention rate is 0%** — the validator's auto-fix rules
  did not match this sample's failure shape (and one multi-line case slipped
  through). The validator's value will rise once it covers multi-line
  assertions and once observations improve (so the validator sees richer
  inputs to check against).

## Reproducibility

```bash
# Fresh reliability measurement over N generation runs:
CEREBRAS_API_KEY=… npm run reliability -- artifacts/discovery-fixture --iterations 6 --reset

# Inspect persisted metrics + timeline:
#   artifacts/discovery/reliability-metrics.json
#   artifacts/discovery-fixture/reliability-report.html
```

Every run appends a `RunRecord`; aggregates recompute from the full history.
