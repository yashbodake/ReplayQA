# 06 — Exploration Strategy

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`..`03-modules.md`.

This document specifies **how the Discovery Engine explores a target application**: how candidate destinations are discovered, how pages are revisited, how duplicates are detected, how infinite loops are avoided, when discovery finishes, and how destructive actions are kept out of the loop. It also records the principal **build-vs-buy** decision of the engine — whether to adopt a generic crawler (Crawlee) or implement a state-aware explorer.

The unit of exploration is the **application State**, not the URL. This is the single most important idea in the document and the reason most of the machinery below exists.

---

## 1. Why state, not URL

CRUD apps in 2026 are overwhelmingly **single-page applications** (Vue, React, Svelte, …). In an SPA:

- The **same URL can host many states**. `/contacts` with 0 rows, with 5 rows, with the "Add" modal open, with a search filter applied — all share one URL.
- The **same state can be reached from many URLs**. A "Dashboard" sidebar button, a breadcrumb link, and a deep link can all converge on identical DOM.
- **Many meaningful transitions never change the URL at all.** Opening a modal, submitting a search, paginating, toggling a tab — all are state changes the URL is blind to.

A URL-keyed crawler therefore both **over-explores** (hammering the same URL through every tab/modal permutation it can find) and **under-explores** (missing modal/form flows that never touch the URL bar). It also cannot dedupe meaningfully.

The Discovery Engine keys exploration on the **State** (URL + DOM fingerprint + visible interactive surface + network fingerprint — see `03-modules.md` §3.3). This gives:

- Stable identity for SPA screens.
- Accurate deduplication regardless of how a screen was reached.
- The ability to recognize modal/tab/filter transitions as first-class exploration steps.

---

## 2. The exploration model, in one diagram

```
                    ┌──────────────────────────────────────────────┐
                    │                 FRONTIER                      │
                    │   queue of (fromState, candidateAction, cost) │
                    └────────────────────┬─────────────────────────┘
                                         │  pop next (BFS, depth-limited)
                                         ▼
        ┌─────────────────────┐   action performed by Browser Controller
        │  safety classifier  │───────────────────────────┐
        │  (read/write/       │   refused if destructive  │
        │   reversible/       │   or cross-origin         │
        │   destructive)      │                           ▼
        └──────────┬──────────┘                    (action skipped,
                   │ allowed                        frontier advances)
                   ▼
        ┌─────────────────────┐
        │   observe + capture │ ──▶ State Manager ──▶ stateId
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐    new? ──▶ detectors ──▶ findings ──▶ RAM Builder
        │   isDuplicate()?    │                                     │
        └──────────┬──────────┘                                     │
                   │ duplicate                                       │ (findings also
                   ▼                                                  │  suggest more
        record edge (no re-exploration)                              │  candidate actions)
                   │                                                  │
                   ▼                                                  ▼
        frontier += outgoing candidate actions ◀────────────────── enqueue
                   │
                   ▼  (loop until frontier empty OR any budget hit)
```

---

## 3. How candidate destinations are discovered

After a State is captured, the Navigation Explorer enumerates **candidate outgoing actions** from multiple sources. Each candidate carries a stable `actionId`, a `locator`, a `label`, a `safety` class, and a cheap `destinationHint` used for pre-filtering (§5).

### 3.1 Sources of candidate actions

| Source | What it captures | Notes |
|--------|------------------|-------|
| **Anchors** | `<a href>` within origin | Canonicalized; fragment-only `#` anchors ignored unless they toggle a tab. |
| **Nav landmarks** | Items from `NavigationDetector` findings | Primary/sidebar/footer links. |
| **Buttons & toggles** | `<button>`, `[role=button]`, `[role=tab]`, `[role=menuitem]` | Labels matched against verb dictionary; SPA-route buttons included. |
| **Form submit buttons** | `candidateAction` emitted by `FormDetector` | Submitting create/edit forms (write-reversible when safe inputs exist). |
| **Per-row actions** | `rowActions` from `TableDetector` | Edit buttons (write-reversible); Delete buttons (`destructive` — never executed). |
| **Search controls** | `candidateAction` from `SearchDetector` | Typing a probe value is `read` (§7). |
| **Pagination** | `pagination.locator` from `TableDetector` | Next-page / load-more; treated as `read`. |
| **SPA route observations** | URL changes observed *without* an explicit click | Recorded as edges so the graph stays coherent; not re-clicked. |

### 3.2 SPA-aware considerations

- **Client-side routing** (Vue Router, React Router, …) is detected by URL/path changes that happen **without** a full document load. The Browser Controller distinguishes `navigate` (full load) from `spa-route` (history pushState) and records both as edges.
- **`target="_blank"` / `window.open`** are followed only if the opened URL is same-origin; otherwise dropped at the Browser Controller boundary.
- **Non-HTTP transitions** (modals, drawers, tabs, filters) are captured as actions that change State but not URL; their resulting State carries a different `domFingerprint` even though the URL is identical.

### 3.3 What is never a candidate

- Anything that would leave the configured origin.
- Anything classified `destructive` (Delete, Remove, Trash, Discard, …) — §7.
- `mailto:`, `tel:`, `javascript:` links.
- Download triggers (`Content-Disposition: attachment`).
- External/oauth redirect buttons that leave origin (recorded as OAuth entry points by `LoginDetector`, not crawled).

---

## 4. How pages are revisited

Revisiting is **deliberate and bounded**. Three revisit policies, each with a distinct reason:

| Policy | When | Why | Bound |
|--------|------|-----|-------|
| **No revisit** | Same `stateId` already seen, reached the same way | Re-exploration would be redundant | Hard skip |
| **State-equivalence revisit** | Same `routeSignature` + same `domFingerprint`, but reached from a new edge | We don't re-run detectors; we only **record the new edge** in `graph.json` | One edge insert, no re-capture |
| **Targeted re-capture** (optional) | A `write-reversible` action was performed elsewhere and we suspect it changed this state's data | To observe the *effect* of an action (e.g. after Create, the list now has +1 row) | At most once per action; gated by config `discovery.exploration.observeEffects` (default `true`) |

The third policy is what lets Discovery learn causal links ("clicking Create on the form resulted in a new row in the table") without re-running the whole detector suite. It is the mechanism behind `Action.feedback` and CRUD `targetPageId` resolution.

---

## 5. How duplicates are detected

Deduplication happens at **two layers**, cheap first:

### 5.1 Pre-filter (cheap, before actioning)

Each candidate carries a `destinationHint`:

```
destinationHint = {
   routeSignature?,     // if known from href
   urlCanonicalized?,
   domFingerprintHint?  // if the action is on-page (modal/tab) — heuristic from trigger label/role
}
```

The explorer computes `hintKey(destinationHint)` and drops the candidate if a State with a matching key already exists in the seen-set **and** the action is classified `read`. (Write actions are never dropped here — their effect must be observed.)

### 5.2 Authoritative dedup (after capture)

After the Browser Controller performs the action and the State Manager captures the resulting State, the real `stateId` is computed:

```
stateId = hash(
   canonicalUrl,
   routeSignature,
   domFingerprint,           // structural — ignores text/values
   a11ySignature,            // interactive-surface hash
   visibleComponentKinds     // {form, table, modal-open, …}
)
```

This is the identity of record. If it matches an existing state, the explorer records the edge and skips re-analysis.

### 5.3 What is intentionally *not* part of the identity

- **Text content** — i18n, A/B tests, and data values would make identity unstable.
- **Form values** — pre-filled vs blank edit forms are the same page.
- **Row count / record data** — `/contacts` with 3 vs 5 rows is the same page.
- **Transient UI** — toasts and spinners are excluded from the fingerprint (a quiet period is enforced before capture, §8).

### 5.4 What *is* part of the identity when it matters

- **Modal/drawer open state** — a modal open over `/contacts` is a different State from `/contacts` alone. Captured via `visibleComponentKinds`.
- **Active tab** — `/settings` with "Profile" tab active vs "Billing" tab active are different States.
- **Auth context** — a page reachable only when authenticated carries `requiresAuth` and is modeled distinctly from its unauthenticated redirect.

---

## 6. How infinite loops are avoided

Loops are the dominant failure mode of autonomous exploration. Discovery uses **layered** defenses; any one of them is sufficient to terminate a runaway loop.

### 6.1 Identity-based termination (primary)

Because dedup is on `stateId` (§5.2) and the set of reachable states of a CRUD app is finite and small (typically tens, rarely hundreds), the frontier **monotonically shrinks** once the reachable state space is saturated. This is the primary guarantee: a same-state loop cannot refill the frontier.

### 6.2 Action-level guards

- **Per-state action cap** (`discovery.budgets.maxActionsPerState`, default `20`): a single State can contribute at most N candidate actions. Stops pathologically large nav menus from dominating.
- **Per-action re-issue cap**: the same `(fromState, actionKey)` pair is never enqueued twice.
- **Depth limit** (`discovery.budgets.maxDepth`, default `6`): BFS depth from the seed. Authenticated CRUD apps are shallow; six hops covers virtually all of them.

### 6.3 Global budgets (backstop)

| Budget | Default | Effect when hit |
|--------|---------|-----------------|
| `maxWallClockMs` | 5 min | Run stops; partial RAM flushed. |
| `maxStates` | 200 | Run stops; partial RAM flushed. |
| `maxActions` | 1000 | Run stops; partial RAM flushed. |
| `maxNetworkRequests` | 5000 | Browser Controller refuses new actions that would trigger network; frontier drains. |
| `perActionTimeoutMs` | 15000 | Action aborted, marked failed, frontier advances. |

Every budget has a non-trivial default and is configurable (§9). **Discovery never relies on a human to kill it.**

### 6.4 Liveness / stuck detection

- A **quiet-window** check before capturing a State: network idle + no DOM mutations for `stabilizationMs` (default `500ms`, capped by `perActionTimeoutMs`). Prevents capturing mid-transition states that would fragment identity.
- A **progress watchdog** in the Orchestrator: if no new state has been discovered for `stallMs` (default `60s`) while the frontier is non-empty, the run logs a warning and treats the frontier as exhausted.

### 6.5 Same-origin enforcement

The Browser Controller computes `new URL(target).origin` and refuses anything off-origin. This eliminates an entire class of "follow a link into the open web" runaway.

---

## 7. Action safety

Every candidate action is classified before it can be enqueued. The Browser Controller is the final enforcer — even if the explorer misclassifies, the controller refuses destructive work.

| Class | Examples | Treatment |
|-------|----------|-----------|
| `read` | Navigate, open page, paginate, type into search, switch tab, open a (non-mutating) modal | Allowed freely, subject to budgets. |
| `write-reversible` | Submit a create/edit form with **disposable** inputs; toggle a setting that has an obvious revert | Allowed only when (a) inputs are obviously non-sensitive (no payment/PII fields), (b) the entity has a detectable delete/reset path, and (c) config flag `allowReversibleProbes` is on (default `true`). |
| `destructive` | Delete, Remove, Trash, Discard, "Reset to defaults", any form whose only submit deletes | **Never executed.** Recorded as inferred actions from button presence / `DELETE` network observations triggered by the app's own UI. |

### 7.1 How destructive intent is inferred

A candidate is destructive if **any** of:

- Its label matches the destructive verb dictionary (`delete`, `remove`, `trash`, `discard`, `clear`, `reset`).
- It lives inside an `alertdialog` (confirm modal) — the whole dialog is treated as a destructive confirmation gate.
- The Browser Controller's network observation of an equivalent prior action was a `DELETE` method.

### 7.2 The "observe, don't perform" principle for destructive ops

Discovery learns that a Delete operation exists **without performing it**. It uses three converging signals:

1. A row-level button labeled `Delete` is present (TableDetector).
2. Clicking it opens an `alertdialog` with confirm/cancel (ModalDetector) — and clicking **Cancel** (safe) is sufficient to observe this.
3. A `DELETE /api/<entity>/:id` route appears in the app's OpenAPI/network surface when the app itself exercises it (e.g. seeded data, a demo mode), or is inferred from the PUT/GET/POST pattern already observed.

The CRUDDetector synthesizes these into a `delete` CrudAction with `observedVia` evidence and `destructive: true`. The future Test Generator — running in a disposable environment — is the component that actually performs deletes.

### 7.3 Probe input hygiene

When `write-reversible` probes fill form fields:

- Names are drawn from a fixed disposable corpus (e.g. `__replayqa_probe__`, `probe@example.com`) so they are greppable and cleanable.
- Numeric fields use sentinel values (e.g. `0`, `1`), never real-looking IDs.
- File inputs are **never** populated; they are recorded as required fields only.
- Any field whose label matches a sensitive dictionary (`card`, `cvv`, `ssn`, `password` aside from auth flows) aborts the probe; the form is recorded structurally, not by submission.

---

## 8. Capture discipline (quiet windows)

To keep `stateId` stable and toasts/toasts/spinners out of fingerprints:

1. **Perform action.**
2. **Wait for stabilization** — `page.waitForLoadState('networkidle')` + a `MutationObserver`-backed quiet window of `stabilizationMs`.
3. **Dismiss transient non-semantic UI** — spinners are waited out, not captured; toasts are captured separately by `ToastDetector` and excluded from the fingerprint.
4. **Capture State** only after the quiet window confirms no further DOM mutations.
5. **Record the edge** with timing metadata (time-to-stable, mutation count) for diagnostics.

This discipline is what makes two runs of the same app produce equivalent models (the determinism goal from `01-overview.md` §7.3).

---

## 9. Termination — when discovery finishes

Discovery terminates when **any** of the following becomes true. The reason is recorded in the report.

| Condition | Meaning | Outcome |
|-----------|---------|---------|
| **Frontier exhausted** | Every reachable, safe, in-budget state has been captured. | Clean success. |
| **Wall-clock budget hit** | `maxWallClockMs` elapsed. | Success (partial); flagged. |
| **State budget hit** | `maxStates` captured. | Success (partial); flagged. |
| **Action budget hit** | `maxActions` performed. | Success (partial); flagged. |
| **Network budget hit** | `maxNetworkRequests` observed. | Success (partial); flagged. |
| **Stall detected** | No new state for `stallMs`. | Success (partial); flagged with the stuck edge for review. |
| **Fatal error** | Unrecoverable exception in a core module. | Failure; partial outputs flushed; exit non-zero. |

Partial-success runs are **not** failures — the RAM is still valid (schema-validated) and useful. The report surfaces the termination reason and the unexplored frontier so the operator can raise budgets or fix the stall and re-run.

---

## 10. Authentication-aware exploration

Auth is a first-class concern because most CRUD apps are gated.

1. The seed URL is loaded; if `LoginDetector` fires and no credentials were supplied, Discovery explores only the unauthenticated surface and emits an `AuthFlow` with `resultStateIds.anonymous` set.
2. If credentials **are** supplied (`discovery.credentials`), the Orchestrator performs a **single, scripted login** using the detected form fields (not a free exploration step — login is a known operation), waits for the authenticated state, and resumes exploration from there.
3. States discovered post-login carry `requiresAuth: true`. The authenticated `BrowserContext` (cookies/storage) is reused for the remainder of the run.
4. Logout is **never** performed by Discovery (destructive to the session); its existence is recorded from button presence only.
5. Credentials are never written to any artifact. The `redactHeaders` util strips them from network logs; `run.log` redacts the login form's password field by default.

---

## 11. Resume and dry-run (v1.1+, sketched here for coherence)

Two operational modes are anticipated (not required for v1, but the design accommodates them):

- **Dry-run (`--dry-run`)**: the explorer plans the frontier and emits the candidate-action graph *without* performing any action. Useful for reviewing what Discovery *would* do before letting it touch a real app.
- **Resume (`--resume <run-id>`)**: reuses the seen-state set and graph from a prior run to continue exploration (e.g. after raising budgets). Requires that `states/`, `graph.json`, and `events.jsonl` from the prior run are intact.

Neither mode changes the core algorithm; both are Orchestrator-level toggles that read/write the same artifacts.

---

## 12. Build vs. buy: Crawlee (and generic crawlers)

The most credible "buy" candidate for this module is **Crawlee** (by Apify), a popular open-source crawling/scraping framework that wraps Playwright and provides:

- A request queue with dedup by URL unique key.
- Configurable BFS/DFS, `maxRequestsPerCrawl`, `maxConcurrency`, retry/error handling.
- `enqueueLinks()` helpers that auto-discover same-origin anchors.
- A persistence layer (default in-memory; filesystem or KeyValueStore available).

### 12.1 What Crawlee would give us for free

| Capability | Useful to us? |
|------------|---------------|
| Same-origin anchor enqueueing | Partially — misses SPA/modal/tab transitions. |
| URL-keyed dedup + unique-key override | Yes, but we need **state-keyed** dedup, which forces a custom unique-key function that essentially reimplements our `stateId`. |
| BFS/DFS + depth + count budgets | Yes — matches our needs at the loop level. |
| Retries, error isolation, session pool | Mostly yes, though we run a single authenticated session. |
| PlaywrightPool / browser rotation | No — we deliberately use one context for coherence. |

### 12.2 Why Crawlee is **not** adopted for v1

1. **Wrong dedup key.** Crawlee's mental model is "one logical page per URL". Our entire §1 argues that this is wrong for SPAs. Overriding the unique key with a `stateId` makes Crawlee a thin loop wrapper around our own identity logic — at which point we own the hard part anyway.
2. **Anchor-centric discovery.** `enqueueLinks()` finds `<a href>`s. It does not understand modal-open buttons, per-row Edit buttons, search probes, pagination as a state transition, or form-submit-as-navigation — all central to CRUD apps. We would still build all of that.
3. **Dependency footprint.** Crawlee pulls in `@crawlee/{core,playwright}`, `apify`, and a chain of supporting packages, plus its own storage abstractions. This directly conflicts with ReplayQA's "zero runtime dependencies — just Playwright" ethos (see `01-overview.md` §7.2). The Discovery Engine is the kind of code where every transitive dep is a supply-chain and bundle-size consideration.
4. **Scraping-oriented defaults.** Crawlee optimizes for data extraction throughput (concurrency, proxy rotation, anti-blocking). Our problem is the opposite: low-concurrency, deterministic, policy-bound, single-session. We would disable most of Crawlee's value to keep behavior correct.
5. **Control over safety.** Action-safety classification (§7) must live in our code regardless; interleaving it with Crawlee's request lifecycle is more complex than implementing a small, well-tested loop ourselves.

### 12.3 What we *do* borrow from Crawlee

Crawlee's design is excellent prior art. We adopt its **patterns** without adopting the package:

- **Request-queue with unique keys** → our frontier, keyed by `(fromStateId, actionKey)`.
- **`maxRequestsPerCrawl`** → our `maxActions` budget.
- **`maxCrawlDepth`** → our `maxDepth`.
- **Auto-retry with error isolation** → per-action try/catch that logs and advances the frontier instead of failing the run.
- **Request labeling** → our `candidateAction.safety` classification.

### 12.4 Recommendation

**Do not adopt Crawlee (or any generic web crawler) for v1.** Implement a focused, state-aware explorer as specified in this document. The hard problems — SPA state identity, action-safety policy, modal/tab/search as first-class transitions — are ours to solve regardless, and a generic crawler would add a large dependency surface for marginal loop-level convenience.

**Revisit if:** a future requirement asks for massively parallel, multi-site discovery (where Crawlee's concurrency + rotation would matter). That is explicitly out of scope for v1 (`01-overview.md` §7.1).

---

## 13. Pseudocode for the explorer loop

Conceptual only — not an implementation, not TypeScript:

```
function explore(seed, config):
    seedState = capture(navigate(seed))
    frontier.enqueue(seedState, depth=0)
    while frontier not empty and not budgetExceeded():
        (fromState, action, depth) = frontier.pop()
        if (fromState.id, action.key) in performed: continue
        if action.safety == "destructive":
            recordInferred(fromState, action); continue
        if action.crossOrigin: continue
        result = controller.perform(action)            # enforced by Browser Controller
        if result.failed:
            log(action, result.error); frontier.advance(); continue
        waitStabilization()
        state = capture(result)
        recordEdge(fromState, action, state)
        if state.id in seen:
            continue                                     # dedup: edge only
        seen.add(state.id)
        findings = detectors.run(state)
        ramBuilder.ingest(state, findings)
        if depth < config.maxDepth:
            for candidate in enumerateCandidates(state, findings):
                if preFilterDroppable(candidate, seen, config): continue
                frontier.enqueue(state, candidate, depth+1)
        if config.observeEffects:
            observeActionEffect(fromState, action, state)   # targeted re-capture
    terminate(reason = determineReason())
```

This loop is the heart of the Discovery Engine. Every paragraph above exists to make it correct, bounded, and deterministic.
