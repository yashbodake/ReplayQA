# QA Planning Engine — Experiment Report

> Status: **Engineering experiment (Milestone 4).** Not production code.
> Code: `src/discovery/qa-planning-lab/`.
> Outputs: `artifacts/discovery/test-plan.{json,md}` (PhoneBook, thin) and
> `artifacts/discovery-fixture/test-plan.{json,md}` (CRUD fixture, rich).
> Reproduce: `CEREBRAS_API_KEY=… npm run plan [artifactsDir]`

## The question this milestone answers

> Can ReplayQA automatically produce a **professional QA Test Plan** from its
> understanding of an application — useful even if it never generates a line of
> Playwright code?

## Setup

- **Provider/model:** Cerebras Inference, `gpt-oss-120b`, OpenAI-compatible
  `/v1/chat/completions` (JSON mode). Base URL + model env-configurable.
- **Inputs (JSON only):** `discovery.json` (pages), `states/*.json`,
  `findings/*.json`, and — new this milestone — `reasoning.json` (the prior
  AI-reasoning pass). The planner therefore builds on ReplayQA's own
  understanding instead of re-deriving it. No raw HTML, screenshots, or
  Playwright objects.
- **Prompt:** casts the model as a Senior QA Lead; fixes a strict output
  contract (the 7-section `TestPlan` schema); stresses the `missingInformation`
  blind-spots discipline carried over from Milestone 3.
- **Outputs:** a structured `test-plan.json` **and** a review-ready
  `test-plan.md` (rendered by a deterministic renderer, not by the LLM).
- **Two runs**, to separate "well-observed app" from "partially-observed app":

| Run | Target | Observed pages | Resulting confidence |
|-----|--------|----------------|---------------------|
| A | CRUD fixture (rich) | Contacts list, Add-Contact modal, Home (3) | **0.65** |
| B | PhoneBook live (thin) | Login page only (1) | **0.32** |

---

## Headline result

**Yes.** Both plans are recognisably the work product of a senior QA engineer,
not a language-model stream-of-consciousness. Concretely:

- **Run A** produced 5 prioritised journeys and 8 functional scenarios, each
  with `Priority / Purpose / Preconditions / Expected Result`, **grounded in
  the specific buttons and forms ReplayQA observed** (Add Contact, Edit, Search
  contacts, Show Favourites, Home↔Contacts). It also produced scoped edge
  cases, a justified risk table, and 5 blind spots — and correctly refused to
  plan Delete tests (no delete button was observed).
- **Run B** produced 9 auth-focused scenarios (valid/invalid login, empty
  fields, SQL injection, sign-up navigation) and **did not fabricate a single
  post-login CRUD scenario**; every unobserved capability was parked in
  `unevaluatedAreas` / `missingInformation`.

The confidence score tracked observation quality (0.65 vs 0.32) — a usable
"how much of this plan can you trust?" signal.

---

## Final evaluation (the five required questions)

### 1. Did the generated test plan resemble what an experienced QA engineer would produce?

**Yes, closely.** The structure (summary → prioritised journeys → scenarios
with preconditions/expected → edge cases → risk → coverage → blind spots) is
the standard shape of a professional test plan. Specific senior-QA tells that
appeared without prompting:

- Journey prioritisation was defensible: Add Contact = critical (the app's
  reason to exist), Edit/Search = high, filter/navigation = medium.
- Scenarios carried concrete, falsifiable expected results ("contact is saved,
  the form closes, and the new contact appears in the list") rather than vague
  ones.
- The auth plan included **SQL-injection** and **Unicode/whitespace** cases —
  exactly the kind of security-minded edge case a senior engineer adds to a
  login form.
- Risk justifications were specific ("incorrect validation can lead to corrupt
  or incomplete data"), not boilerplate.

### 2. Which recommendations were genuinely useful?

- **The blind-spot discipline.** Every plan states precisely what it cannot
  test and *why* ("I cannot recommend tests for deleting contacts because
  ReplayQA has not yet observed a delete button"). This is the single most
  useful output — it converts the engine's limits into a concrete to-do list.
- **Scenario grounding.** Preconditions reference the actual observed UI
  ("Add Contact button is visible", "Edit button for a contact is clicked"),
  so a human can map each scenario to real locators.
- **Inferred validation rules.** Run A suggested "duplicate name when
  duplicates are not allowed" and "empty name" cases — sensible QA inferences
  about a create form that the observations implied but did not state.
- **Confidence-gated trust.** 0.32 on the gated app told the reviewer "most of
  the app is invisible; do not act on this plan as if it were complete."

### 3. Which recommendations were generic or repetitive?

Honestly, these:

- **Edge cases trend generic.** "Max length", "special characters",
  "whitespace-only", "very long string" appear for every input. These are
  *sensible defaults* but not app-specific — they would be sharper if
  ReplayQA captured actual validation attributes (`required`, `maxlength`,
  `pattern`).
- **One low-risk row was filler** ("UI presentation / styling or layout
  issues"). It isn't wrong, but it adds little.
- **Some preconditions repeat the obvious** ("Landing page is loaded" on every
  auth scenario). A template/dedup pass would tighten the document.
- The auth scenarios, while good, are the kind any QA engineer would produce
  for any login form — the highest *novelty* value came from the CRUD plan
  (Run A), where scenarios were tied to observed entity operations.

### 4. Which additional observations would significantly improve future QA plans?

Ranked by impact on plan quality:

1. **Credentialled exploration.** The biggest leap: seeing past the login wall
   turns a 0.32 plan into a 0.65+ plan. Registration/auth-flow support (or a
   supplied demo account) is the highest-leverage observation to add.
2. **A ListDetector** (cards/`<ul>`, not just `<table>`). Lets the model write
   data-grounded read/duplicate/ordering scenarios instead of flagging "list
   contents" as a blind spot.
3. **Field validation attributes** (`required`, `type=email`, `minlength`,
   `pattern`, `maxlength`). Would make edge cases app-specific instead of
   generic boilerplate — directly addressing §3.
4. **Destructive-action signal** (verb classification of buttons, without
   executing them). Unlocks Delete/Remove scenarios that today are all blind
   spots.
5. **Feedback observations** (toasts/banners after an action). Lets scenarios
   assert *specific* success messages instead of "a success message appears".
6. **A state-graph** (`graph.json`). Today flows are *inferred*; observed
   transitions would make flows and preconditions factual rather than guessed,
   and would let the planner state "this path was actually traversable".

Notably, items 1–6 are exactly the backlog surfaced by Milestone 3's reasoning
experiment — the two milestones converge on the same extractor roadmap, which
is strong evidence the architecture is internally consistent.

### 5. Should ReplayQA generate Playwright directly, or should QA Planning remain a mandatory intermediate step?

**QA Planning should remain a mandatory intermediate step.** Three reasons,
grounded in what this experiment actually showed:

- **The plan is the review gate.** This milestone's most valuable property is
  that the plan is *reviewable and overrideable* before any code is written.
  Generating Playwright directly would skip the exact checkpoint where a human
  confirms "yes, these are the right scenarios, priorities, and expected
  results." That checkpoint matters most when observations are partial (the
  0.32 plan) — precisely when unreviewed code generation would be most wrong.
- **Confidence + blind spots are the gate signal.** The plan explicitly tells
  you *when* it is safe to generate code: when confidence is high **and** the
  blind spots that matter for your scenarios have been addressed. Direct
  generation has no such signal — it would happily produce CRUD tests for an
  app whose CRUD layer was never observed.
- **The plan outlives the automation.** A QA engineer can act on `test-plan.md`
  *today* — manual testing, exploratory testing, cross-team review — even if
  Playwright generation is never built. That independence is the milestone's
  success criterion ("useful even if ReplayQA never generates Playwright
  code"), and it only holds if the plan is a first-class artifact rather than
  an intermediate string consumed by a code generator.

The recommended pipeline is therefore **layered**, not flat:

```
discover → reason → PLAN (human review gate) → [only then] generate → execute
                       ▲                                 ▲
                       confidence high?                  plan approved?
                       blind spots addressed?
```

Direct Playwright generation is appropriate as a *later* stage that consumes an
**approved** plan — not as a replacement for it.

---

## What was NOT done (per constraints)

- No Playwright code generated; nothing executed.
- No modification to BrowserController, StateManager, Findings, or Discovery.
- No new production abstractions: the planner lives entirely in an isolated
  `qa-planning-lab/` and reads only existing artifacts.
- The API key is read from `CEREBRAS_API_KEY` and is never written to source
  or artifacts (verified by grep).

## Reproducibility

```bash
# Plan from the existing PhoneBook artifacts (thin, gated app):
CEREBRAS_API_KEY=… npm run plan

# Plan from any other artifacts dir (e.g. the rich CRUD fixture):
CEREBRAS_API_KEY=… npm run plan -- artifacts/discovery-fixture

# Each run writes test-plan.json, test-plan.md, and test-plan.raw.txt (audit).
```

## Bottom line

The experiment validates the **core product idea**: ReplayQA's structured
observations are sufficient for an LLM — acting as a senior QA lead — to
produce a professional, prioritised, review-ready test plan that correctly
scopes its claims to what was actually observed and explicitly flags what was
not. The plan is useful as a standalone deliverable, and its confidence +
blind-spot fields give a future code-generation stage a safe, gated input.
