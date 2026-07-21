# State Manager

> Status: **Production module (implemented).**
> Implements: `src/discovery/state/`. Algorithm: the accepted Strategy E from
> `state-fingerprint-report.md`. Lab preserved at `src/discovery/state-lab/`.

This document describes the production StateManager: the State lifecycle, how
duplicate states are detected, how the lab stays usable for regression testing,
and the assumptions made during implementation.

---

## 1. What was built

| File | Role |
|------|------|
| `src/discovery/browser/materials.ts` | **Pure** materials extraction: `StateMaterials`, `ROLE_BY_TAG`, `extractMaterials` (the browser-side function), `canonicalUrl`. No Playwright import. |
| `src/discovery/browser/controller.ts` | `currentMaterials()` — the BrowserController observation that runs `extractMaterials` and canonicalizes the URL. |
| `src/discovery/state/fingerprint.ts` | **Pure** fingerprint: `fingerprintHash`, `buildStateCanonical` (Strategy E canonical string), `computeStateId`. |
| `src/discovery/state/manager.ts` | The `StateManager` class: `capture()`, `computeStateId()`, dedup, persistence. |
| `src/discovery/state/index.ts` | Barrel. |

Dependency direction is preserved strictly downward:

```
cli → core → state ──▶ browser ──▶ Playwright
                 └──▶ browser/materials (pure leaf, shared with lab)
```

`browser/materials.ts` is a **pure leaf** — it imports nothing from `state/` or
Playwright — so `browser/controller` importing it does not create a cycle with
`state/manager` (which imports `browser/controller`).

### Public API (exactly as required)

```ts
class StateManager {
  capture(): Promise<State>;              // capture current page → State (persist if new)
  computeStateId(materials): string;      // pure: Strategy-E fingerprint
  has(stateId): boolean;                  // already recorded this run?
  get uniqueCount(): number;              // unique states so far
  record(materials, snapshot): Promise<State>;  // capture from pre-gathered materials
}
```

---

## 2. The State lifecycle

A State moves through four stages. The `StateManager` owns steps 2–4; the
orchestrator (`core/discover.ts`) drives step 1.

```
   (1) Navigation               (2) Capture                (3) Fingerprint           (4) Persist
   ──────────────               ──────────                 ─────────────             ──────────
   orchestrator      ───▶  controller.currentMaterials  ──▶  computeStateId      ──▶  if NEW:
   controller.goto         controller.currentSnapshot         (Strategy E)             write
   controller.waitForStable       │                                                    artifacts/discovery/
                                  ▼                                                    states/<stateId>.json
                          State { id, url, metadata, snapshot, materials }
```

1. **Navigate + settle.** The orchestrator moves the browser and waits for the
   page to settle (`waitForStable` — `networkidle` plus, for hash-routed SPAs,
   a short quiet window; see §5).
2. **Capture.** `StateManager.capture()` calls the controller for two
   observations in one logical step:
   - `currentMaterials()` → `StateMaterials` (the fingerprint inputs), and
   - `currentSnapshot()` → `RawSnapshot` (the label-rich observation that
     becomes `discovery.json`).
3. **Fingerprint.** `computeStateId(materials)` hashes the Strategy-E canonical
   string to 8 uppercase hex chars. This becomes `State.id` — **the dedup key**,
   replacing the old `state:<url>` placeholder.
4. **Persist (if new).** If `state.id` is not in the in-memory `seen` set, the
   State is written to `states/<stateId>.json` and the id is recorded. If it is
   already known, **no file is written** — the State is returned unchanged.

The persisted file is the full State (id, url, metadata, snapshot, materials),
so the fingerprint is fully auditable from disk: anyone can re-run
`computeStateId(materials)` and confirm the id, or diff two states' materials
to see exactly why they differ.

---

## 3. How duplicate states are detected

Dedup is **stateId-based, not URL-based** — the change this milestone introduces.

```
   capture()
      │
      ▼
   computeStateId(materials)  ──▶  "4E2D07CA"
      │
      ▼
   seen.has("4E2D07CA")?
      ├── no  ──▶  seen.add(...)  ──▶  write states/4E2D07CA.json  ──▶  return State
      └── yes ──▶  (no write)                                      ──▶  return State
```

- The `StateManager` holds an in-memory `Set<string>` of stateIds seen in the
  current run. That set is the **authoritative dedup** for both persistence
  (one file per unique state) and the orchestrator's exploration dedup.
- The orchestrator keeps its own `exploredStates: Set<string>` to decide which
  captures make it into `discovery.json` and which get explored further. This
  is intentionally separate from the StateManager's concern (persistence):
  exploration policy belongs to the orchestrator; persistence belongs to the
  StateManager. Both key on the same `state.id`.
- A pre-navigation URL filter that the old code used (`if (visited.has(link.path))`)
  is **removed**. Whether a navigation produces a new state is now answered
  authoritatively *after* capture, by comparing `state.id`. This means the
  engine may navigate to a URL whose state it has already seen — that's correct
  and intended, because URL is no longer identity.

### Verified behaviour

Driven against the controlled fixture (`#list` ↔ `#home`, 4 captures):

```
captured ids: [ '4E2D07CA', '3FEB4217', '4E2D07CA', '3FEB4217' ]
s3 === s1 (dup detected)?  true
s4 === s2 (dup detected)?  true
uniqueCount:               2 (expect 2)
files on disk:             [ '3FEB4217.json', '4E2D07CA.json' ]
```

Four captures of two distinct pages → **two** state files. Duplicate captures
were detected and no duplicate file was written.

---

## 4. How the lab stays usable for regression testing

The experimental lab (`src/discovery/state-lab/`) is **preserved** and now
regression-tests the *exact shipped algorithm* rather than a copy of it. The
pure fingerprint primitives were moved into production; the lab imports them:

| Lab file | Now does |
|----------|----------|
| `state-lab/hash.ts` | re-exports `fingerprintHash` from `state/fingerprint.ts` |
| `state-lab/url.ts` | re-exports `canonicalUrl` from `browser/materials.ts` |
| `state-lab/materials.ts` | `collectMaterials(page)` adapter that runs the **production** `extractMaterials` + `ROLE_BY_TAG` |
| `state-lab/strategies.ts` | Strategies A–D kept as **comparison baselines**; Strategy E **delegates** to production `computeStateId` / `buildStateCanonical` |

There is **no second copy** of the fingerprint algorithm anywhere. If anyone
edits the production fingerprint, the lab's Strategy E reflects it
automatically, and the experiment runner surfaces the behaviour change.

### Regression commands (unchanged)

```bash
# One-shot: print all 5 strategy fingerprints for a URL.
# Strategy E === the production stateId.
npm run fingerprint -- https://phone-book-yrap.vercel.app

# Full experiment suite (controlled fixture + optional live URL).
# Verifies E still detects modals/SPA-toggles and still ignores search/data.
npm run fingerprint:lab
npm run fingerprint:lab -- https://phone-book-yrap.vercel.app
```

### Parity proof

For the PhoneBook login page, the production-persisted `states/<id>.json` and
the lab's Strategy E agree exactly:

```
state file id (production):  991DEDB8
lab Strategy E (regression): 991DEDB8   ✓
```

The lab's fixture experiment reproduces the result table in
`state-fingerprint-report.md` byte-for-byte (baseline E = `4E2D07CA`, A misses
the modal, B/C miss the login↔register toggle, D/E clean).

---

## 5. Assumptions made

1. **Strategy E is the project standard**, accepted from
   `state-fingerprint-report.md`. Its canonicalization (sibling-collapse for
   trees, dedup for the interactive surface, names on interactive elements
   only, DOM-inferred roles) is implemented verbatim; none of its rules were
   re-litigated here.

2. **8-hex (32-bit) stateId is sufficient.** A single app's reachable state
   space is in the tens to low hundreds, so collision risk is negligible.
   State files are namespaced under a per-run `artifacts/discovery/states/`
   directory, so cross-app collisions are not a concern either.

3. **`capture()` performs two `page.evaluate` round-trips** — one for
   `currentMaterials()` (fingerprint) and one for `currentSnapshot()` (output).
   They serve different purposes (materials are deduped/structural; the
   snapshot is label-rich for humans) and are kept separate for clarity.
   Combined cost is ~8 ms per capture. Folding them into one evaluate is a
   future optimization, not a correctness issue.

4. **The caller is responsible for the quiet window.** The fingerprint is only
   stable on a settled page. The orchestrator calls `waitForStable()`
   (`networkidle`) before each capture. For SPAs whose view transitions finish
   slightly after `networkidle` (e.g. hash-routed apps), the caller must add a
   short quiet window — this is the capture discipline from
   `06-exploration.md` §8, empirically validated in the fingerprint report.
   The StateManager itself does not wait; it fingerprints whatever it is handed.

5. **Persistence is best-effort.** A write failure is logged via the
   `DiscoveryContext` logger and does not abort the run — the in-memory `seen`
   set remains the authoritative dedup. Similarly, a pre-existing file with
   the same id (from a prior run writing into the same dir) is never
   overwritten.

6. **Hash-routed SPA navigation is an exploration concern, not a StateManager
   concern.** The production orchestrator follows nav links via
   `controller.goto(absoluteHref)`, which works for history-routed apps like
   PhoneBook. For hash-routed apps, a `goto` to a same-URL-different-hash
   location does not always trigger a navigation — handling that (SPA-route
   detection, click-vs-goto) belongs to the future Navigation Explorer
   (`06-exploration.md` §3.2), not to the StateManager. The StateManager
   fingerprints whatever page it is given; the dedup itself is correct, as the
   fixture regression (which uses `click` for hash navigation) proves.

7. **Backward compatibility.** `npm run discover -- <url>` works exactly as
   before: identical console output, and `discovery.json` is byte-for-byte
   identical to the pre-StateManager output for the same input (verified by
   diff for the PhoneBook login page). The `states/` directory is purely
   additive. The CLI is unchanged.

---

## 6. What the StateManager deliberately does NOT do (yet)

Per the milestone boundary and the architecture's staged plan:

- **No state-graph / edges.** Capturing a State does not record which action
  led from one state to another. That is the Navigation Explorer's job
  (`06-exploration.md`); `graph.json` comes later.
- **No route signature.** `StateMetadata` carries `url` + `capturedAt` only.
  The `/:id/edit`-style route template arrives with the RAM work.
- **No re-capture scheduling.** The StateManager captures when asked; it does
  not decide *when* to re-capture after an action (that is the orchestrator's
  "observe effects" concern).
- **No detectors / RAM / Event Bus / AI.** Out of scope for this milestone by
  explicit constraint.

The StateManager is the load-bearing dedup primitive the rest of the
architecture was prepared for. With it in place, `State.id` is a real
fingerprint and `exploredStates` keys on structure, not URL — the single
concrete behaviour change everything downstream (Exploration, Detectors, RAM)
will build on.
