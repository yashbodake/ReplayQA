# ReplayQA v0.3 — Interactive Discovery Report

> Status: **Discovery-only milestone.**
> Code: `src/discovery/probes/` + controller additions + `core/discover.ts`.
> NOT modified (per constraints): AI Reasoning, QA Planning, Test Generation,
> the Reliability Pipeline.
> Persisted: `artifacts/discovery/graph.json` (transition graph + skipped actions).

## The question this milestone answers

Four prior evaluations independently identified the same bottleneck: ReplayQA
did not observe interactive states, so the AI / planner / generator could not
reason about forms behind buttons. This milestone adds an **Action Probe**
system to Discovery and measures whether the *unchanged* downstream improves
purely from richer observations.

## What was built (Discovery only)

```
src/discovery/probes/                 NEW
├── types.ts          ProbeCandidate, TransitionGraph, SkippedAction
├── vocabulary.ts     safety policy — PROBE_PATTERNS / DESTRUCTIVE_PATTERNS + classifyAction()
├── graph.ts          TransitionGraphBuilder (nodes / edges / skipped → graph.json)
└── runner.ts         runProbes(): enumerate → classify → click → capture → record → return-to-base

src/discovery/browser/controller.ts  + currentActions(), pressEscape(), reload()
src/discovery/browser/selector.ts    + ActionCandidate type
src/discovery/core/discover.ts       probes run from every captured base state; graph persisted
```

**How a probe works** (per the spec): enumerate visible action buttons →
classify under the safety policy → for each *safe* one, click → wait for the UI
to stabilize → capture the new State (fingerprinted + deduped by the existing
StateManager) → record the transition edge → return to the base state (Escape /
Close button, then reload/goto as a hard reset) → repeat.

**Safety policy** (`vocabulary.ts`, fully auditable in `graph.json`):
- **Never probed (destructive):** delete, remove, archive, reset, purge,
  logout/sign out, pay/payment, purchase/buy, confirm purchase, destroy, drop,
  clear, empty, revoke, deactivate, disable, terminate, unsubscribe, decline,
  reject, cancel, submit, save.
- **Probed (open / expand):** add, create, new, edit, modify, details, view,
  show, expand, configure, open, manage, more, settings, preferences, profile,
  register, sign up, inspect.
- **Skipped (conservative):** anything not matching either list — recorded with
  the reason "not a recognized open/expand action".

## Measured evidence

Run against the CRUD fixture (the only target where execution can fully
succeed). All downstream systems were the **exact same code** as v0.2.

### 1. States & observations

| | v0.2 (no probes) | v0.3 (with probes) |
|---|---|---|
| Discovered states | 3 (Home, Home#hash, Contacts list) | **4** — adds the **Add-Contact modal** |
| Create form observed | ✗ (never opened) | **✓** — `forms: [{ fields: ["name"], submit: "Save" }]` |
| Transition graph | — | persisted: `contacts —Add Contact→ modal`, plus skipped actions |

The 4th discovered page is the modal the Add-Contact button opens, with the
`name` field and `Save`/`Close` controls — the exact observation every prior
milestone said was missing.

### 2. Did ReplayQA now observe the targeted interactive components?

| Target | Observed? |
|--------|-----------|
| Create Contact form | **Yes** — opened via the "Add Contact" probe; `fields:[name]`, submit `Save`. |
| Edit Contact form | No — the fixture's `Edit` buttons have **no click handler**, so the probe correctly recorded "no state change after click". (The engine can't observe a form the app doesn't open.) |
| Validation messages | No — see "What remains impossible to observe". |
| Additional interactive components | Yes — the modal's Save/Close buttons and the form input are now in the page snapshot. |

### 3. Downstream improvement (reasoning + plan, UNCHANGED code)

| | v0.2 | v0.3 |
|---|---|---|
| Reasoning — `Create` capability | a **blind spot** ("cannot determine creating a contact … no form fields observed") | **asserted**: `Create (Add Contact)` listed as a capability |
| Reasoning confidence | 0.55 | **0.62** |
| QA plan confidence | ~0.65 | **0.71** |
| "Create form" blind spot | present | **gone** |
| Plan scenarios | demoted Create to a blind spot; picked Navigate | includes grounded **Create-valid** + **Create-empty** scenarios |

Crucially, the blind spot did not just vanish — it became **more precise**:
v0.2 said "I cannot see the create form at all"; v0.3 says "I see the create
form has a single `name` field; I cannot determine email/phone fields." That
is the engine trading a coarse gap for a specific, actionable one.

### 4. Generated-test quality (generator + reliability loop, UNCHANGED)

Reliability benchmark, 4 runs of the top scenarios, same generator + loop as
v0.2:

| Scenario | v0.2 | v0.3 |
|---|---|---|
| **Create a new contact with a valid name** | 0% first-pass; passed only after 1–3 repairs, or failed | **first-pass PASS, 0 repairs** |
| Create with empty name | failed (no validation feedback in the app) | failed (same — app limitation) |
| Edit / Edit-empty | failed (no functional edit form in the app) | failed (same) |

**The headline result:** the highest-priority, fully-observable scenario —
the exact one the MVP selects first — went from "needs 1–3 repairs or fails"
to **first-pass success**. The generated test is clean and grounded:

```ts
await page.goto('…/sample-app.html#list');
await page.getByRole('button', { name: 'Add Contact' }).first().click();
await nameInput.fill('Test User');
await page.getByRole('button', { name: 'Save' }).first().click();
await expect(page.getByText('Test User')).toBeVisible();
```

Every locator traces to an observation the probe captured.

Aggregate first-pass rate rose from **0% (v0.2, 5 runs)** to **25% (v0.3, 4
runs)** — modest in aggregate only because 3 of the 4 scenarios remain
unwinnable for reasons unrelated to generation (see below). For the
*observable* Create scenario, first-pass is **100%**.

## Final evaluation (the five required questions)

### 1. How many new states were discovered?

**One** new application state (3 → 4): the Add-Contact modal. Plus the
transition graph itself (`graph.json`), which is entirely new — it records
`contacts —Add Contact→ modal` and every action that was considered and
skipped (with reasons).

### 2. Which blind spots disappeared?

- **"Cannot determine/recommend tests for creating a contact" — GONE.** The
  reasoning now asserts `Create (Add Contact)` as a capability; the plan now
  emits grounded Create scenarios. This was the single blind spot called out
  by Milestones 3, 4, the MVP, and v0.2.
- The blind spot was replaced by a finer-grained one ("only a `name` field
  observed; cannot determine email/phone"), which is progress: the engine now
  knows precisely what it is missing instead of missing the whole form.

### 3. Which generated tests improved?

**"Create a new contact with a valid name"** — the highest-priority scenario.
It went from "needs 1–3 LLM repairs, sometimes fails" (v0.2, where the
generator had to *guess* the form structure) to **first-pass success, 0
repairs** (v0.3, where the generator writes against an *observed* `name` field
+ `Save` button). No change to the generator, the prompt, or the reliability
loop — the improvement is entirely from richer observations.

### 4. Which failures disappeared?

- The **create-form `expect-failed` / `timeout` failures** that came from the
  generator guessing a form that wasn't there — gone for the observable
  Create scenario (it passes first-try now).
- The reliability pipeline's repair loop is no longer needed for Create-valid
  (0 repairs vs 1–3 in v0.2).

### 5. What remains impossible to observe?

Honest limits exposed by the run:

1. **Forms the app doesn't actually open.** The fixture's `Edit` buttons have
   no click handler; the probe clicks them, observes no state change, and
   records "no state change after click" in `graph.json`. ReplayQA cannot
   observe a form the application does not open. (On a real app where Edit
   opens a form, the same probe WOULD capture it — verified by the Add-Contact
   success.)
2. **Validation feedback / error messages.** Probing "Save" with empty data is
   classified as a form-submission (non-probe) action under the safety policy,
   so the engine never triggers validation to observe its UI. Observing
   validation UX would require a bounded "fill-and-submit-probe" variant,
   deliberately scoped to disposable data — a future extension of the probe
   vocabulary.
3. **Destructive flows.** Correctly never probed (Delete/Remove/Reset/etc.).
   Their existence can only be *inferred* from button presence, not observed.
4. **Backend / API behavior.** Out of scope this milestone; network
   observations are a separate capability.

## What this proves

The bottleneck identified by four prior milestones was real and is now
removable **without touching the downstream**. By adding a safe, auditable
Action Probe system to Discovery alone:

- a previously invisible interactive state (the create form) became a
  first-class observation;
- the unchanged AI reasoner turned a blind spot into an asserted capability;
- the unchanged QA planner turned a demoted scenario into a grounded one; and
- the unchanged generator turned a 1–3-repair scenario into a first-pass pass.

That is the milestone's success criterion met: **downstream improvement driven
entirely by richer Discovery.**

## Reproducibility

```bash
# Discovery with probes (writes discovery.json, states/, findings/, graph.json):
npm run discover -- file://$PWD/src/discovery/state-lab/fixture/sample-app.html

# Then exercise the UNCHANGED downstream:
CEREBRAS_API_KEY=… npm run reason
CEREBRAS_API_KEY=… npm run plan
CEREBRAS_API_KEY=… npm run reliability -- artifacts/discovery --reset --iterations 4
```

Inspect the safety policy's decisions in `artifacts/discovery/graph.json`
(`edges` for successful probes, `skipped` for every action declined + why).
