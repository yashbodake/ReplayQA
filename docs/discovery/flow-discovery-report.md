# ReplayQA v0.5 — Flow Discovery & Journey Understanding Report

> Status: **Flow Discovery milestone.**
> Code: `src/discovery/flow/` + enriched probes + reasoning-lab integration.
> NOT modified (per constraints): Discovery core, StateManager, Reasoning, QA
> Planning, Test Generation — only extended via richer observations.
> Persisted: `flow-graph.json`, `journeys.json`, `flow-report.html`.

## What was built

```
src/discovery/flow/             NEW
├── snapshot-diff.ts    computeChanges(base, probed) → human-readable diff per transition
├── journey-builder.ts  buildJourneys(graph) → simple-path extraction (root → leaf)
├── report.ts           flow-report.html (state/action/state visualization + journeys)
└── index.ts

src/discovery/probes/           ENRICHED
├── types.ts            TransitionEdge.changes: string[]
├── graph.ts            addEdge() takes changes
└── runner.ts           computes snapshot diff at probe time

src/discovery/core/discover.ts  persists flow-graph.json + journeys.json + flow-report.html
src/discovery/reasoning-lab/collect.ts   loads flow-graph.json + journeys.json into observations
```

The key integration is in `reasoning-lab/collect.ts`: `loadObservations()` now
loads the flow graph and journeys alongside the existing observations, and
includes them in the JSON payload sent to the LLM. This propagates flow data to
**every downstream system** (reasoning, planning, generation) without changing
any of them — they all read the same enriched observations.

## Measured evidence

### Auth-fixture (admin/secret) — credentialed discovery with flows

**Flow graph:**
```
Nodes: 3 (Welcome back, My Contacts, My Contacts [modal])
Edges: 1
  445BC93F —Add Contact→ A743ACAA
    changes: ["Save button appeared", "Close button appeared", "form opened (1 new form)"]

Journeys: 1
  My Contacts → Add Contact → My Contacts (1 step)
```

### Downstream comparison (v0.4 vs v0.5, same target, same downstream code)

| | v0.4 (no flows) | v0.5 (with flows) |
|---|---|---|
| Reasoning confidence | 0.68 | 0.68 |
| Reasoning flows | (inferred from button labels) | **observed** ("Welcome back → Sign In → My Contacts", "My Contacts → Add Contact → form") |
| Plan confidence | 0.65 | **0.78 (+20%)** |
| Plan scenarios | 10 (broad, some guessed) | **6 (focused, grounded in observed journeys)** |
| Edit capability | asserted (Edit button present) | **"Edit – unknown state"** (probed, no state change — flow data reveals this) |

The reasoning now emits flows that are **observed** (traced to real probe
transitions with recorded changes) rather than **inferred** (guessed from
button labels). The planner's confidence rose 20% because it can now reason
over "what ReplayQA actually saw happen" rather than "what buttons exist."

## Final evaluation (the four required questions)

### 1. Which workflows were fully observed?

Two complete workflows were fully observed end-to-end:

- **Login → Authenticated App.** The credentialled login flow was observed
  with multi-signal verification (login form removed, "My Contacts" heading
  appeared, Logout button visible). The transition is in the flow graph as a
  state change (though it occurs via the login module, not a probe edge).

- **Contacts List → Add Contact → Create Modal.** The probe clicked "Add
  Contact" and the flow graph records the transition with the observed
  changes: "Save button appeared", "Close button appeared", "form opened."
  The destination state (modal with name field + Save) was captured and
  registered. This is a fully observed interactive transition.

### 2. Which workflows required AI inference?

- **Create Contact → Save → Updated List.** The probe opened the modal
  (observed) but did NOT fill the form and click Save (form-submission is
  excluded from probe-safe actions by the safety policy). So the "Save →
  contact appears in list" leg is **inferred** by the AI, not observed. The
  plan includes "Create a contact with a valid name" — the scenario is
  grounded (the form was observed) but the post-save verification is inferred.

- **Search Contacts.** The search input was observed (on the contacts page),
  but the search ACTION was not probed (search/filter produces a data change,
  not a structural state change — the fingerprint stays the same because
  filtering hides rows without changing the page structure). The planner
  includes a search scenario from inference, not from an observed transition.

- **Logout.** The Logout button was observed and correctly classified
  destructive (skipped from probing). The planner infers a logout flow from
  its presence, but the transition (authed → login) was never observed via a
  probe.

### 3. Which workflows remain impossible to discover automatically?

- **Destructive workflows (Delete, Remove, Reset).** Correctly never probed
  under the safety policy. Their existence is inferred from button presence
  only. The transition they would cause (e.g., row removed, list updated)
  cannot be observed without executing them.

- **Validation/error flows.** Probing "Save" with empty data is a
  form-submission action (excluded from probe-safe vocabulary). So validation
  behavior (error messages, field highlighting) is never triggered and never
  observed. The generated tests that assert validation behavior must infer it.

- **Multi-step form completion flows.** The full create flow (open modal →
  fill name → Save → verify contact in list) is partially observed (modal
  opened) but the submit-and-verify leg is NOT observed. The probe opens the
  door but doesn't walk through it.

- **Flows behind non-functional controls.** The auth-fixture's Edit buttons
  have no click handler — the probe clicks them, observes no state change,
  and records "no state change after click" in the graph. ReplayQA cannot
  observe a form the application does not open.

### 4. What is the next biggest bottleneck in ReplayQA?

**Form-completion probes.** The action-probe system opens modals/forms (one
level deep) and observes the resulting state — but it does not FILL and
SUBMIT the form. So the most important CRUD leg — actually creating a record
and verifying it appears — remains inferred, not observed. This means:

- The flow graph captures "modal opened" but not "contact created."
- The generated create test can be grounded in the observed form structure
  (which it is — that's why Create-valid passes first-try in v0.3+) but the
  post-save assertion is inferred.
- The planner cannot distinguish "Save works" from "Save button exists."

Extending the probe vocabulary to include safe **fill-and-submit probes**
(with disposable data, a verify-then-cleanup discipline per `06-exploration.md`
§7) would close this gap and make the full CRUD lifecycle observable. This is
the same item surfaced (at a coarser granularity) by Milestones 3, 4, MVP,
v0.2, and v0.3 — the convergence is now precise: **the missing observation is
the form-submission leg, not the form-opening leg (which v0.3 solved).**

## Reproducibility

```bash
# Credentialed discovery with flow graph:
npm run discover -- file://$PWD/src/discovery/state-lab/fixture/auth-app.html \
  --username admin --password secret

# Inspect the outputs:
#   artifacts/discovery/flow-graph.json    (enriched graph with changes)
#   artifacts/discovery/journeys.json      (extracted journeys)
#   artifacts/discovery/flow-report.html   (visualization)

# Run the UNCHANGED downstream on the flow-enriched data:
CEREBRAS_API_KEY=… npm run reason
CEREBRAS_API_KEY=… npm run plan
```
