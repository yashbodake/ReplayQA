# AI Reasoning — Experiment Report

> Status: **Engineering experiment (Milestone 3).** Not production code.
> Code: `src/discovery/reasoning-lab/`. Outputs: `artifacts/discovery/reasoning.json`
> (+ secondary `artifacts/discovery-fixture/reasoning.json`).
> Reproduce: `CEREBRAS_API_KEY=… npm run reason`

## The question this milestone answers

> Can an LLM accurately understand a CRUD web application using **only**
> ReplayQA's structured observations?

## Setup

- **Provider/model:** Cerebras Inference, `gpt-oss-120b`, via the
  OpenAI-compatible `/v1/chat/completions` endpoint (JSON mode). Endpoint and
  model are env-configurable (`REASONING_BASE_URL`, `REASONING_MODEL`) so
  Olama Cloud or any compatible provider can drop in later.
- **Inputs sent to the LLM:** ONLY the JSON artifacts ReplayQA already
  produces — `discovery.json` (pages: title, buttons, links, forms, tables,
  inputs), per-state metadata, and `findings/*.json`. **No raw HTML, no
  screenshots, no Playwright objects, no DOM/a11y fingerprint trees** (those
  are intentionally stripped — the test is whether *semantic* observations
  suffice).
- **Prompt:** a system message fixing the output contract and stressing
  `missingInformation`, plus the observations JSON as the user message. No
  handcrafted explanation, no hidden assumptions.
- **Two runs**, to separate the two failure modes the architecture cares about:

| Run | Target | What ReplayQA had explored |
|-----|--------|----------------------------|
| A | Local CRUD fixture (rich) | Contacts list, Add-Contact modal (open), Home — 3 pages, 3 states, 3 findings |
| B | PhoneBook live (thin) | Login page only (registration backend was down, no creds) — 1 page, 1 state, 1 finding |

---

## Results

### Run A — rich CRUD fixture

```json
{
  "applicationType": "Simple contact management web application",
  "entities": ["Contact"],
  "capabilities": [
    "Create (Add Contact)", "Read (List Contacts)", "Update (Edit Contact)",
    "Search contacts", "Filter (Show Favourites)", "Navigation between Home and Contacts"
  ],
  "confidence": 0.78,
  "flows": [
    "Home → Contacts List",
    "Contacts List → Add Contact → Save",
    "Contacts List → Edit Contact → Save",
    "Contacts List → Show Favourites",
    "Contacts List → Search contacts"
  ],
  "missingInformation": [
    "I cannot determine whether contacts can be deleted because ReplayQA has not yet extracted a delete button or related actions.",
    "I cannot determine the structure and contents of the contacts list because ReplayQA has not yet extracted table data (headers, rows).",
    "I cannot determine authentication requirements because ReplayQA has not yet extracted a login page or auth mechanisms.",
    "I cannot determine the specific items in the primary navigation because ReplayQA has not yet extracted navigation item details.",
    "I cannot determine if there is a contact detail view page because ReplayQA has not yet extracted such a page."
  ]
}
```

### Run B — PhoneBook login-only (thin)

```json
{
  "applicationType": "Phone book web application with user authentication",
  "entities": ["User"],
  "capabilities": ["Authentication (login)", "User registration"],
  "confidence": 0.42,
  "flows": ["Landing page → Sign In", "Landing page → Sign up"],
  "missingInformation": [
    "I cannot determine additional business entities such as contacts because ReplayQA has not yet extracted pages that display or manage them.",
    "I cannot determine CRUD or search capabilities for contacts because ReplayQA has not explored any pages beyond the login screen.",
    "I cannot determine post-authentication user flows (e.g., dashboard, contact list, add/edit contact) because ReplayQA has not captured those states.",
    "I cannot determine whether pagination, settings, or other advanced features exist because no relevant pages were discovered."
  ]
}
```

---

## Evaluation

### 1. What the AI inferred correctly

**Run A (rich):**
- ✅ Application type — "contact management web application". Exactly right.
- ✅ Entity — `Contact`. Correct.
- ✅ Capabilities — it reconstructed **Create, Read, Update** from button labels
  (`Add Contact`, `Edit`) plus the list and the Save form. This is the most
  important result of the milestone: **the model inferred CRUD with no CRUD
  detector implemented** — purely from the structured button/form observations.
  Search and the favourites filter were also correctly identified.
- ✅ Flows — accurate journeys, including the modal open→save flow captured as
  a distinct state.
- ✅ Confidence 0.78 — appropriately high but not maximal; the model knew gaps
  remained.

**Run B (thin):**
- ✅ Identified the app as a phone book with authentication (from the URL host
  + the visible login form).
- ✅ The only entity it asserted was `User` — the auth entity. Correct
  restraint: it did **not** assert `Contact` as a known entity.
- ✅ Capabilities limited to what it could see (login, registration).
- ✅ Confidence dropped to **0.42** — the model correctly signalled low
  certainty because most of the app was unobserved.

### 2. What the AI inferred incorrectly (or not at all)

Genuinely incorrect claims were essentially absent across both runs. The
"misses" were all cases of the model **correctly declining to guess** and
moving the item into `missingInformation` instead:

- Run A: did not claim Delete exists (the fixture has none) — flagged it
  missing. Did not invent table columns (ReplayQA reported `tables: []`) —
  flagged it missing.
- Run B: did not hallucinate contacts/CRUD as confirmed despite the URL hint
  "phone-book" — it explicitly said it *cannot determine* them because the
  pages weren't explored.

This is the strongest signal the experiment produced: **the prompt design +
structured inputs yielded a model that under-specifies rather than
hallucinates**, which is exactly the property a test-generation pipeline needs.

### 3. What information was missing

The model's `missingInformation` fields are the experiment's most valuable
output — they are a precise, prioritised list of what ReplayQA cannot yet
provide. Aggregated across both runs:

| Gap the model flagged | Root cause in ReplayQA |
|-----------------------|------------------------|
| Cannot confirm **Delete** | No destructive-action detector; row-level action buttons not captured as findings. |
| Cannot see **list/table contents** (headers, rows) | Lists are `<ul><li>`, not `<table>`; only `<table>` is collected as "tables". The contact cards/rows aren't lifted into a structured list finding. |
| Cannot determine **authentication** (Run A) / post-login pages (Run B) | Run A's fixture has no auth; Run B couldn't log in. Auth detection + credentialled exploration are gaps. |
| Cannot enumerate **navigation items** precisely | Nav items appear as link text but no dedicated NavigationFinding with structure (landmarks, targets). |
| Cannot confirm a **contact detail/edit page** | Discovery didn't open a detail view; per-row "Edit" target not followed. |
| Cannot tell if **pagination/settings** exist | Not explored; no detector for pagination controls. |

### 4. Which additional observations ReplayQA should extract next

Derived directly from §3, in priority order for the next milestones:

1. **A ListDetector (not just TableDetector).** CRUD apps frequently render
   entities as cards/rows (`<ul>/<li>`, repeated divs), not `<table>`. The
   model flagged this gap twice. The fingerprint lab already detects repeated
   sibling structure — reuse that to emit a `ListFinding` with item count and
   a sample row.
2. **Row-level action capture + a destructive-action signal.** The model
   correctly refused to assert Delete. Per-row buttons (Edit/Delete) should be
   captured on Table/List findings, and a verb-classification pass should tag
   destructive ones — even without executing them (`06-exploration.md` §7).
3. **Credentialled exploration.** Run B exposed the biggest gap: half the app
   is behind login. Registration/auth-flow support (or a supplied demo account)
   is required before reasoning can see CRUD on a real gated app.
4. **A real NavigationFinding.** Links are currently flat text on a page; a
   structured finding (`landmark`, `items[].target`) would let the model
   reason about the nav skeleton — and is already a documented finding type
   (`04-detectors.md`).
5. **A route/transition signal.** The model inferred flows from button labels
   alone; a future state-graph (`graph.json` — `06-exploration.md`) would let
   it state flows as *observed* rather than *inferred*, raising confidence
   and removing guesswork.

---

## What this proves about the architecture

1. **The observation model is sufficient for useful understanding.** Given
   nothing but ReplayQA's structured JSON, the model correctly identified the
   application type, its primary entity, its CRUD capabilities, and its main
   flows (Run A) — and correctly characterised a partially-observed app without
   hallucinating the unobserved parts (Run B).

2. **The Findings Framework is the right seam.** Today the only finding is the
   DummyDetector's placeholder, yet the model still reconstructed CRUD from
   `discovery.json`'s raw button/form observations. As real detectors
   (Form/List/Navigation/CRUD per `04-detectors.md`) land, the same prompt
   will receive typed findings instead of raw buttons — strictly more signal,
   no prompt redesign needed.

3. **`missingInformation` works as designed.** It reliably converts the
   architecture's current gaps into an actionable, prioritised extractor
   backlog (§4). This is the milestone's headline deliverable: evidence that
   the architecture is introspectable about its own limits.

4. **Confidence tracks reality.** 0.78 when the app was well-observed, 0.42
   when it was gated behind a login the engine couldn't cross — a useful
   signal for a future "is this model ready to generate tests?" gate.

## What was NOT done (per constraints)

- No LoginDetector, no RAM, no Playwright-test generation, no AI in the
  production pipeline.
- No new production abstractions: the reasoning module lives entirely in an
  isolated `reasoning-lab/` and reads only existing artifacts.
- No modification to the existing architecture (the only addition is the
  experimental `npm run reason` script and the lab folder).
- The API key is read from `CEREBRAS_API_KEY` and is never written to source
  or artifacts (verified).

## Reproducibility

```bash
# From existing PhoneBook artifacts (thin):
CEREBRAS_API_KEY=… npm run reason

# Against any other artifacts dir (e.g. the rich fixture set):
CEREBRAS_API_KEY=… npm run reason -- artifacts/discovery-fixture

# Switch provider/model (e.g. Olama Cloud later) without code changes:
REASONING_BASE_URL=https://olama-cloud…/v1 REASONING_MODEL=… CEREBRAS_API_KEY=… npm run reason
```

Raw model output is persisted alongside each `reasoning.json` as
`reasoning.raw.txt` for audit.
