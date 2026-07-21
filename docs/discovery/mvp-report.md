# ReplayQA MVP — End-to-End Vertical Slice Report

> Status: **MVP integration milestone.**
> Entry point: `npm run replayqa -- <url> [--yes] [--headed]`
> Code: `src/discovery/run/`.

## What the MVP is

A single command that chains every previously-validated component into one
cohesive workflow:

```
discover → reason → plan → [review + approve] → generate ONE test → execute → report
```

Reused verbatim, no redesign: BrowserController, StateManager, the Findings
Framework (`DetectorManager`/`DummyDetector`), the reasoning lab, the QA
planning lab, the Playwright runner/collector fixtures, and the ReplayQA HTML
reporter. New code is only the orchestrator (`src/discovery/run/`) plus a
self-repair pass on the generator.

## The run that produced this report

Target: the local CRUD fixture (a real working contacts app — search, Add
Contact modal that actually persists a row, hash navigation). Run non-
interactively (`--yes`). The PhoneBook live app could not be used end-to-end
because its registration backend was unavailable, so no credentials could be
obtained to cross the login wall (see §"What prevented a production-quality
result").

The pipeline completed and **the generated test passed**:

```
✓ Discovering application
✓ Understanding application
✓ Generating QA plan
✓ Generating Playwright test
✓ Executing
✓ Recording video
  ✓  1 [chromium] › tests/replayqa-generated.spec.ts:3:5
                          › TC-001 - Navigate to Contacts List from Home page (1.1s)
  1 passed (1.9s)
✓ Creating report
✓ Test passed
Done. HTML report: /home/yash/Documents/Projects/ReplayQA/reports/index.html
```

### Deliverables produced (all present on disk)

| Artifact | Path |
|----------|------|
| Discovery output | `artifacts/discovery/discovery.json` |
| Captured states | `artifacts/discovery/states/<stateId>.json` (3 unique) |
| Detector findings | `artifacts/discovery/findings/<stateId>.json` (3) |
| AI reasoning | `artifacts/discovery/reasoning.json` (+ `.raw.txt`) |
| QA plan | `artifacts/discovery/test-plan.json` + `test-plan.md` (+ `.raw.txt`) |
| Generated test | `tests/replayqa-generated.spec.ts` (+ `generated-test.raw.txt`) |
| Execution artifacts | `artifacts/test-output/…/video.webm`, `trace.zip`, `test-finished-1.png` |
| Console + network logs | `artifacts/logs/chromium/replayqa-generated_spec_ts_…/{console,network}.json` |
| Final HTML report | `reports/index.html` (self-contained dashboard) |

The generated test (the one that passed):

```ts
import { test, expect } from '../src/runner/index.js';

test('TC-001 - Navigate to Contacts List from Home page', async ({ page }) => {
  await page.goto('file:///.../sample-app.html');
  await page.getByRole('link', { name: 'Contacts' }).click();
  await expect(page).toHaveURL(/#list/);
  await expect(page.getByRole('button', { name: 'Add Contact' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show Favourites' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search contacts' }).first()).toBeVisible();
});
```

A clean, idiomatic Playwright test: correct runner import (so it inherits the
console/network collectors), robust role-based locators, `.first()` for
strict-mode safety, a URL assertion, and presence checks grounded in the
observed controls.

---

## Final evaluation (the four required questions)

### 1. Which stage worked best?

**Discovery → Reasoning → Planning.** All three ran first-try, in-process, and
produced correct, coherent output with no iteration:

- Discovery captured 3 unique states (Home, Contacts list, and the state
  reached via the Contacts nav link), fingerprinted them, persisted them, and
  ran the detector pipeline — exactly the components built and validated in
  earlier milestones.
- Reasoning correctly identified "Simple contact management web application",
  the `Contact` entity, and the Create/Read/Update/Search capabilities.
- Planning produced a prioritized plan and **correctly demoted Create** to a
  blind spot ("I cannot recommend tests for creating a contact because
  ReplayQA has not observed any form fields or submission mechanisms") and
  selected the highest-priority *testable* scenario (navigation).

The integration of these three stages is the MVP's strongest property: they
compose exactly as the architecture specified, with no glue surprises.

### 2. Which stage is currently the weakest?

**Test generation.** It took four generation attempts before the produced test
passed, each failing on a different small Playwright mistake:

| Attempt | Failure | Root cause |
|---------|---------|------------|
| 1 | `getByRole('button', { name: 'Edit' })` matched 4 elements | Strict-mode violation — generator didn't know one label can repeat per row. |
| 2 | `locator.first().toBeVisible()` | Wrong API — called an assertion method on a locator instead of via `expect()`. |
| 3 | `toHaveCount(1)` but 4 Edit buttons exist | Hardcoded a count it couldn't have observed. |
| 4 | `getByText('Home')` matched 2 elements (nav link + heading) | Strict-mode on a text locator. |
| **5 (final)** | **passed** | After strict-mode + assertion-style prompt guidance and a self-repair loop. |

The generator eventually converged, but only because of (a) increasingly
specific prompt engineering and (b) the self-repair pass that feeds the
captured Playwright error back for one retry. Without those, the first-pass
success rate was 0%. Discovery, reasoning, and planning needed no such help.

### 3. What prevented a production-quality result?

Three concrete things, observed directly in this run:

1. **Discovery does not explore interactive states.** The Add-Contact *modal*
   was never opened during discovery (the explorer follows nav links, not
   action buttons), so the create-form's fields were never observed. As a
   direct consequence the planner demoted Create — the most important scenario
   for a CRUD app — to a blind spot and selected navigation instead. **The MVP
   generated a navigation test for a CRUD app because that was the best it
   could actually observe.** This is the single biggest quality ceiling.

2. **No list/row observations.** The contacts list is `<ul>/<li>`, not a
   `<table>`; only `<table>` is collected, and there is no `ListDetector`. So
   the generator had no row-level data (item count, per-row actions, sample
   field values) and kept guessing counts wrong. This is the same gap flagged
   by Milestones 3 and 4 — the three milestones converge on it.

3. **Generator brittleness.** Even with good observations, the LLM makes
   small Playwright-specific mistakes (strict mode, assertion API, hardcoded
   counts). One self-repair retry recovered them here, but a production system
   needs either a stronger generation prompt with worked examples, a multi-
   retry repair loop with execution feedback, or static validation of the
   generated code before execution.

4. **Credentialled exploration was unavailable on the live target.** PhoneBook
   requires registration to obtain credentials; its registration backend was
   down for the entire MVP window, so the only end-to-end *passing* run is
   against the local fixture. A real gated app would have produced only a
   login-scoped plan (confidence ~0.32, as in Milestone 4) and a login test
   that could not be executed without credentials.

### 4. What should the next milestone be (based on this evidence)?

**Interactive-state exploration — a "probe" step in Discovery.** This single
change unblocks the largest quality ceiling observed in the MVP:

- Discovery currently follows only navigation links. It should additionally
  perform a bounded set of safe *action probes* (click primary action buttons
  like "Add Contact" to reveal the form, then capture that state) so the
  create/edit forms — their fields, validation, submit labels — become
  observations the planner and generator can use.
- This is exactly what `06-exploration.md` §3.1 calls "candidate actions from
  FormDetector/TableDetector" and §7 calls "write-reversible probes". The
  architecture already specifies it; the MVP proved it is the missing piece.

Ranked follow-ups, all directly evidenced by this run:

1. **Action-probe exploration** (above) — turns Create/Edit from blind spots
   into observed scenarios, which is what lets the generator write real CRUD
   tests instead of navigation tests.
2. **A `ListDetector`** (cards/rows, not just `<table>`) — gives the generator
   row counts and per-row actions so it stops hardcoding wrong counts.
3. **A generation validation/repair loop** as a first-class stage (not a
   one-shot retry): execute → on failure, feed the structured error back →
   regenerate → repeat up to N times, with a final "could not stabilize"
   fallback. The MVP's repair pass already proved the technique works.
4. **Credentialled discovery on a stable target** — register/seed a demo
   account so the full CRUD pipeline can be demonstrated on a real gated app,
   not only the fixture.

---

## What the MVP proved

- **The vertical slice works as a product.** One command produces discovery
  artifacts, a reasoning summary, a reviewable QA plan, a generated Playwright
  test, full execution artifacts (video/trace/screenshot/console/network), and
  a self-contained HTML report — reusing every component built in the prior
  milestones with no redesign.
- **The review gate is real.** The plan summary + `[Y/n]` prompt fire before
  any code is generated or executed, and the confidence/blind-spots fields
  tell the reviewer *what the generated test will and will not cover*.
- **Error handling preserves work.** Every stage writes its artifacts as it
  completes; the iteration history above shows failed executions leaving
  video/trace/screenshot/console intact for diagnosis, exactly as required.
- **The architecture's self-awareness is intact.** The MVP did not paper over
  its gaps — when it couldn't observe the create form, it said so in the plan
  and picked a scenario it *could* support. That honesty is the property that
  makes the review gate trustworthy.

## What the MVP did NOT do (per constraints)

- Did not modify BrowserController, StateManager, Findings, Discovery,
  Reasoning, or QA Planning — only orchestrated them.
- Did not generate a test suite — exactly one Playwright test, for the single
  highest-priority *testable* scenario.
- Did not execute anything beyond the generated test.
- The API key is read from `CEREBRAS_API_KEY` and never persisted (verified).

## Reproducibility

```bash
# Interactive (asks [Y/n] before generating/executing the test):
CEREBRAS_API_KEY=… npm run replayqa -- <url>

# Non-interactive (auto-approve; useful for demos/CI):
CEREBRAS_API_KEY=… npm run replayqa -- <url> --yes

# Watch the browser:
CEREBRAS_API_KEY=… npm run replayqa -- <url> --yes --headed
```

Every run refreshes `artifacts/discovery/`, regenerates `tests/replayqa-generated.spec.ts`,
and rewrites `reports/index.html`.
