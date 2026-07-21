# 09 — Flows

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`..`05-ram.md`.

This document is the **behavioral specification for Flows** — the first-class, ordered, reusable sequences introduced to the RAM in schema `1.1.0`. `05-ram.md` §3.2 defines the *persisted shape* of a Flow; this document defines its *semantics*: how Flows are synthesized, what each step kind means, how parameters and bindings carry data between steps, how Flows compose, what confidence/reliability mean, and how cleanup is expressed.

Flows are the unit the future **AI Planner** reasons about ("which flows should we test?") and the unit the future **Test Generator** expands into concrete runner code. Getting Flow semantics right is what makes the model actually usable for generation rather than merely descriptive.

---

## 1. What a Flow is — and is not

| A Flow **is** | A Flow **is not** |
|----------------|-------------------|
| An ordered, named sequence of steps achieving a user-visible goal | A test case (it carries intent, not runner code or assertions-as-code) |
| Parameterized and reusable across runs | Tied to one specific data record |
| Declarative (preconditions, postconditions, assertions express *what*, not *how*) | An imperative program (no loops, no arbitrary branching, no I/O) |
| Synthesized by the RAM Builder from discovered actions, crud actions, feedback, and the state graph | Emitted by a detector (detectors find components; the builder composes flows) |
| Composable (a step may invoke another Flow as a subflow) | Recursive at the persistence level (a Flow references subflows by id; cycles are a validation error) |
| Self-describing about its reversibility | Required to be reversible (a flow may have `reversible: false` and no cleanup) |

---

## 2. Flow kinds and when each is synthesized

| `kind` | Synthesized from | Example |
|--------|------------------|---------|
| `auth` | `AuthenticationDetected` finding + the observed login transition | "Login", "Register" |
| `crud` | A `CrudAction` + its triggering form/table + observed feedback + target page | "Create Contact", "Edit Contact", "Delete Contact" |
| `navigation` | A `Navigation` landmark traversal between distinct pages | "Open Settings", "Go to Contacts list" |
| `search` | A `SearchDetected` control + a safe probe + observed effect (client/query/server) | "Search Contacts by name" |
| `custom` | Anything produced by a future flow contributor (extension) that does not fit the above | App-specific workflows |

In v1 the RAM Builder synthesizes `auth`, `crud`, `navigation`, and `search` flows. `custom` is reserved: it lets a future contributor add flows via the extension mechanism (see `05-ram.md` §4) without changing the core `kind` enum.

A flow is **only promoted** to `flows[]` when its confidence is at or above `discovery.flows.minConfidence` (default `0.6`, higher than the per-detector threshold because synthesized flows aggregate several lower-level findings and therefore demand stronger evidence). Below-threshold flows are kept in `states/*.json` for review but not promoted.

---

## 3. Step taxonomy

Every `FlowStep` has a `kind`. The complete v1 set:

| `kind` | Fields used | Semantics | Runner-translation hint (for the future Test Generator) |
|--------|-------------|-----------|----------------------------------------------------------|
| `navigate` | `ref` (→ Action) or `locator`/`value` (URL) | Move the browser to a page/state. | `page.goto(...)` or click the referenced nav Action. |
| `action` | `ref` (→ Action.id) | Perform a previously discovered Action (the canonical way to interact). | Re-emit the Action's trigger via its `Locator`. |
| `fill` | `locator`, `value` (literal or `${param}`) | Set the value of an input. | `locator.fill(value)`. |
| `assert` | `assertion` | Declare an expectation about state (visible/hidden/text/count/url/network). | Translated to a runner-specific assertion; **never stored as `expect(...)` code**. |
| `wait` | `wait` ({ for, ms?, locator? }) | Block until a condition holds, with a cap. | `page.waitFor...`. |
| `observe` | `locator` | Read a value/attribute from the DOM *without* acting (used to populate a Binding). | `locator.textContent()` / `inputValue()`. |
| `subflow` | `ref` (→ Flow.id) | Invoke another Flow, inheriting or overriding its parameters. | Inline the subflow's steps (or call it as a fixture). |

### 3.1 Rules

- A step has exactly one `kind`. Mixing is a validation error.
- `action` and `subflow` steps MUST carry a `ref` that resolves to an existing `Action.id` / `Flow.id`. Dangling refs fail validation.
- `fill`/`assert`/`observe`/`wait` steps that target the DOM MUST carry a `locator`.
- Cycles via `subflow` are forbidden: `Flow.A.subflow → Flow.B.subflow → Flow.A` is a validation error.
- Step `id`s MUST be unique within their Flow (they are referenced by `Binding.from` and `onFailure`).

### 3.2 Failure handling

`onFailure` per step, with the policy:

| Policy | Meaning |
|--------|---------|
| `abort` (default) | Stop the flow; the run records the failure against this flow. |
| `continue` | Proceed to the next step regardless (use for non-critical observations). |
| `recover:<stepId>` | Jump to a later step (the named recovery step) and resume from there. The recovery step MUST exist and MUST be later in the order (no backward jumps — that would reintroduce loops). |

This is deliberately limited. Sophisticated retry/backoff is the Test Generator's concern, not the model's.

---

## 4. Parameters, bindings, and data flow

Flows are templates. Concrete values are supplied at *plan time* (by the AI Planner) or *runtime* (by the Test Generator / runner). The model only describes the shape.

### 4.1 Parameters

A `Parameter` declares a named input:

```
Parameter { name, type, required, default?, source? }
```

- `name` is namespaced by entity when applicable (`contact.name`, not just `name`).
- `default` is the **probe value** used when no override is supplied. It MUST come from the disposable-probe corpus (`06-exploration.md` §7.3) — never real-looking data.
- `source` indicates who is expected to supply a non-default value:
  - `config` — from `discovery.flows.parameters.<flowId>.<name>` in config.
  - `generated` — synthesized by the AI Planner (e.g. a unique email).
  - `runtime` — only known at test execution time (rare; e.g. a captcha token, which usually aborts the flow).

### 4.2 Parameter references (`${...}`)

Inside a `fill` step's `value`, a parameter is referenced as `${param.name}`:

```
{ "kind": "fill", "locator": {...}, "value": "${contact.name}" }
```

Resolution rule: at plan time, `${contact.name}` is replaced by the supplied value, or by `Parameter.default` if none was supplied. Unresolved required parameters with no default are a planning error — the flow is not runnable as-is.

### 4.3 Bindings (outputs)

A `Binding` exposes a value produced *during* execution so callers (sibling steps, subflows, or sibling flows in a run) can use it:

```
Binding { name, from, scope }
```

- `from` is either a `stepId` (the value the step produced — typically an `observe` step) or a `locator` (read on demand).
- `scope`:
  - `flow` — visible only to later steps in the same Flow.
  - `run` — visible to any Flow invoked later in the same plan (this is what lets a `create` flow expose `createdContactId` to a later `delete` flow for teardown).

Bindings are the backbone of **compositional** tests: "create → edit → delete" is three flows stitched together by bindings, not one giant flow.

### 4.4 Worked data-flow example

A Create flow produces `createdContactId` (scope `run`). The plan then invokes the Delete flow, passing `contactId: ${createdContactId}` as its parameter. The Delete flow's first `action` step references `action-delete-contact`, which the model already bound to that id via the table's per-row action locator. No flow needs to know how the id was obtained — only that it is in scope.

---

## 5. Preconditions and postconditions

Both are **declarative predicates** about state. They are not executed by Discovery; they are claims the model makes and the Test Generator turns into setup/teardown and assertions.

### 5.1 Precondition

Declares what must be true *before* the flow runs. The Test Generator uses this to emit setup (e.g. ensure logged in, ensure on the right page, ensure the list is non-empty for an edit).

```
Precondition { requiresAuth?, requiredPageId?, requiredStateId?, dataConstraints? }
```

`dataConstraints` is a small, intentionally limited vocabulary mapping a model ref to a constraint:

```
{ "entity:contact": "non-empty" | "empty" | "any" }
```

Anything more expressive is the AI Planner's job (the Planner can read the whole RAM and reason; the model only states the obvious gate).

### 5.2 Postcondition

Declares what is expected to be true *after* the flow runs.

```
Postcondition {
  expectedPageId?,
  expectedFeedback?    [ { variant, messagePattern? } ]      // toasts/banners
  expectedDataDelta?   { "entity:contact": "+1" | "-1" | "0" }
  expectedNetwork?     [ { method, urlTemplate, statusRange } ]
}
```

- `expectedFeedback` ties back to `ToastDetector` findings — the future Test Generator can assert "a `success` toast appeared" without hard-coding its text.
- `expectedDataDelta` is the heart of CRUD coverage: after Create, +1 row; after Delete, −1 row.
- `expectedNetwork` lets the model express "this flow should have POSTed to `/api/contacts` with 2xx" — the contract between UI behavior and the API mapping extension (`05-ram.md` §4.3.1).

### 5.3 Assertions (in-step)

`assert` steps carry an `Assertion` for inline checks that are not the terminal postcondition (e.g. "the form's submit button is now disabled", "the row count increased by one mid-flow"). Same declarative vocabulary:

```
Assertion { kind, target, op, value? }
```

| `kind` | `target` | typical `op` |
|--------|----------|--------------|
| `visible` | locator | `equals`/`exists` |
| `hidden` | locator | `equals`/`exists` |
| `text` | locator | `equals`/`contains`/`matches` |
| `count` | table/list id | `gte`/`lte`/`equals` |
| `url` | urlTemplate | `equals`/`matches` |
| `network` | method+urlTemplate | `exists` |

---

## 6. Composition

### 6.1 Subflows

A step of `kind: "subflow"` with `ref: "<flowId>"` invokes another Flow. Semantics:

- Parameter resolution cascades: any parameter the subflow declares that the parent does not override falls back to the subflow's own `default`.
- Bindings the subflow produces at `scope: "run"` become available to the parent's later steps and to the rest of the plan.
- Bindings the subflow produces at `scope: "flow"` are NOT visible to the parent (encapsulation).
- `onFailure` on a subflow step applies to the subflow as a whole (the subflow's own `onFailure` policies apply within it first).

### 6.2 Plan-time stitching (no new object)

A "plan" (Create → Edit → Delete) is **not** a RAM object. It is an artifact the future AI Planner emits by referencing multiple Flow ids and a binding map. This keeps the RAM honest about its scope: the model describes reusable building blocks, not how to chain them into suites. That chaining lives one layer up.

### 6.3 Cleanup / teardown

A reversible flow declares `reversible: true` and a `cleanupFlowId` pointing at the Flow that undoes it. The Test Generator uses this to emit `afterEach`/`afterAll` teardown so generated tests leave no residue. Properties:

- `cleanupFlowId` MUST resolve to an existing Flow.
- The cleanup flow SHOULD be the operational inverse (create ↔ delete; create-with-defaults ↔ delete). The builder validates structural inverse-ness only loosely (the pair must reference the same `entityId`); semantic inverse-ness is the contributor's responsibility.
- A cycle of cleanups (`A.cleanup → B.cleanup → A.cleanup`) is a validation error.
- `destructive` flows (delete) are themselves valid cleanup targets and are typically `reversible: false` (deleting is the cleanup; it has no further cleanup of its own).

---

## 7. Confidence and reliability

Two distinct, independent numbers on every Flow:

| Field | Meaning | How it is computed (v1) |
|-------|---------|-------------------------|
| `confidence` | How sure the model is that **this flow exists and is correctly described**. | Aggregate of the confidences of the findings/steps the flow was synthesized from (min, mean, or weighted — configurable; default weighted mean favoring action/feedback evidence). |
| `reliability` | How often the flow **succeeds when executed**, for flows that were actually performed during discovery. | `successes / attempts` for flows Discovery itself exercised (auth, safe create/search). Absent (`undefined`) for flows that were only *synthesized* from structure and never run (e.g. delete). |

The distinction matters: a flow can be `confidence: 0.9` (we're sure the app has a Create Contact feature shaped like this) and `reliability: undefined` (we never actually ran it). The AI Planner uses `confidence` to decide what to plan; the Test Generator uses `reliability` to decide whether to add retries.

---

## 8. Synthesis: how the RAM Builder builds a Flow

The builder runs after detectors and after the state graph is closed. For each candidate flow it:

1. **Identifies the trigger** — a `CrudAction` (for `crud`), an `AuthenticationDetected` finding (for `auth`), a `Navigation` traversal (for `navigation`), or a `SearchDetected` finding (for `search`).
2. **Sequences the steps** by walking the state graph from the trigger's `fromPageId` through the actions and forms involved:
   - `navigate` to the entry page (precondition page),
   - `action` to open the form/modal,
   - `fill` per field (from the bound Form's `fields`), each `value` set to `${param.<entity>.<field>}`,
   - `action` to submit,
   - `assert`/observe the effect (row delta, toast).
3. **Resolves parameters** from the Form's field definitions.
4. **Resolves postcondition** from observed feedback (`ToastDetector`) and observed data delta (the targeted re-capture from `06-exploration.md` §4).
5. **Sets `produces`** when the flow creates or selects an entity (binding extracted from the URL or table row after the action).
6. **Links cleanup** by pairing create ↔ delete flows on the same entity.
7. **Scores** `confidence` (and `reliability` if the flow was exercised).
8. **Promotes** to `flows[]` iff `confidence ≥ minConfidence`; otherwise records it in `states/*.json` for review.

This synthesis is **deterministic**: two runs of the same app produce the same set of flows with the same ids and step signatures, preserving the model-diff property from `05-ram.md` §5.2.

---

## 9. Example: a full "Create Contact" flow (annotated)

```json
{
  "id": "flow-contact-create",
  "kind": "crud",
  "name": "Create Contact",
  "entityId": "entity-contact",
  "operation": "create",
  "parameters": [
    { "name": "contact.name",  "type": "text",  "required": true,  "default": "__replayqa_probe__", "source": "config" },
    { "name": "contact.phone", "type": "text",  "required": true,  "default": "555-0100",           "source": "config" },
    { "name": "contact.email", "type": "email", "required": false, "default": "probe@example.com",  "source": "generated" }
  ],
  "precondition": { "requiresAuth": true, "requiredPageId": "page-contacts-list", "dataConstraints": { "entity:contact": "any" } },
  "steps": [
    { "id": "s1", "kind": "action", "ref": "action-open-add-modal", "description": "open the Add Contact form" },
    { "id": "s2", "kind": "fill",   "locator": { "primary": { "role": "textbox", "name": "Name" } },  "value": "${contact.name}" },
    { "id": "s3", "kind": "fill",   "locator": { "primary": { "role": "textbox", "name": "Phone" } }, "value": "${contact.phone}" },
    { "id": "s4", "kind": "fill",   "locator": { "primary": { "role": "textbox", "name": "Email" } }, "value": "${contact.email}", "onFailure": "continue" },
    { "id": "s5", "kind": "action", "ref": "action-submit-contact-form" },
    { "id": "s6", "kind": "assert", "assertion": { "kind": "count", "target": "table-contacts", "op": "gte", "value": 1 } },
    { "id": "s7", "kind": "observe","locator": { "primary": { "role": "row", "name": "__replayqa_probe__" } }, "description": "capture the created row" }
  ],
  "postcondition": {
    "expectedPageId": "page-contacts-list",
    "expectedFeedback": [ { "variant": "success" } ],
    "expectedDataDelta": { "entity:contact": "+1" },
    "expectedNetwork": [ { "method": "POST", "urlTemplate": "/api/contacts", "statusRange": [200, 299] } ]
  },
  "produces": [ { "name": "createdContactId", "from": "s7", "scope": "run" } ],
  "confidence": 0.82,
  "reliability": 0.95,
  "reversible": true,
  "cleanupFlowId": "flow-contact-delete",
  "source": "synthesized"
}
```

What this single object gives the future Test Generator, with **zero re-discovery**:

- The exact ordered steps (open modal → fill 3 fields → submit → assert row → observe id).
- Parameter defaults that are safe and greppable.
- A declarative postcondition it can turn into assertions (toast variant, +1 row, POST to `/api/contacts`).
- A produced binding (`createdContactId`) it can pass to the Delete flow for teardown.
- A confidence/reliability pair it can use to gate retries.
- The cleanup flow to emit as `afterEach`.

That is the entire reason Flows exist as a first-class RAM object.

---

## 10. Validation rules (summary)

The RAM Builder enforces these before a Flow is promoted; `ajv` enforces the structural ones via the schema (`05-ram.md` §6).

| Rule | Class |
|------|-------|
| `steps` is non-empty and ordered. | structural |
| Every step `id` is unique within its Flow. | structural |
| Every `action`/`subflow` `ref` resolves to an existing Action/Flow id. | referential |
| No subflow cycle (A→B→A). | referential |
| Every `${param}` reference resolves to a declared `Parameter`. | referential |
| Every `Binding.from` stepId exists in the same Flow (or is a locator). | referential |
| `cleanupFlowId`, if present, resolves and is not part of a cleanup cycle. | referential |
| A `recover:<stepId>` `onFailure` target exists and is later in step order. | semantic |
| A `crud` Flow has both `entityId` and `operation`. | semantic |
| `confidence ∈ [0,1]`; `reliability ∈ [0,1]` or absent. | structural |
| Auth flows referenced by `authFlow.flowId` exist and have `kind=auth`. | semantic |

A Flow that fails a structural rule fails validation (the run fails). A Flow that fails a *referential* or *semantic* rule is dropped (not promoted) and logged, but does not fail the run — the model is still valid without it.

---

## 11. Extension hook: custom flow contributors

A future module (e.g. an `ApiFlowContributor` that turns `extensions.api` endpoints into API-level flows, or an app-specific contributor loaded via config) may add Flows. The contract:

1. Flows it produces MUST conform to the shapes in `05-ram.md` §3.2 and pass §10 validation.
2. It MUST declare `source: "imported"` (so consumers can distinguish synthesized vs imported).
3. It MAY use `kind: "custom"`.
4. It MUST not duplicate an existing Flow id (the Builder de-duplicates by id; last-writer-wins is rejected in favor of first-writer-wins, with a warning).

This keeps the Flow surface open for extension without permitting the kind of unstructured sprawl that would make the model unparseable.

---

## 12. Relationship to the rest of the RAM

| RAM object | Relationship to Flow |
|------------|----------------------|
| `Action` | Referenced by `action` steps via `ref`. |
| `CrudAction` | Seeds `crud` flows; `operation`/`entityId` mirror it. |
| `Entity` / `Field` | Seed flow `parameters` (one parameter per form field). |
| `Component` (Form/Table) | Provide locators and field shapes the steps use. |
| `Page` / `StateRef` | Provide `precondition.requiredPageId` and `postcondition.expectedPageId`. |
| `ToastDetector` findings | Populate `postcondition.expectedFeedback`. |
| `extensions.api` | `postcondition.expectedNetwork` binds to endpoint templates defined there. |
| `extensions.transitions` | A flow's steps correspond to transitions in the graph; guards there can refine a flow's `precondition`. |
| `authFlow` | A projection of the `kind=auth` Flow (`authFlow.flowId`). |

Flows are the **integrating** object of the RAM: they are where pages, entities, components, actions, feedback, API mappings, and transitions all meet in one runnable narrative. That is why they are first-class, and why their semantics deserve a document of their own.
