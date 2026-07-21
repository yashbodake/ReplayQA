# State Fingerprint Laboratory — Report

> Status: **Engineering experiment (Milestone 1).** Evidence, not assumptions.
> Lab code: `src/discovery/state-lab/` (intentionally **not** wired into the production pipeline).
> Reproduce: `npm run fingerprint -- <url>` and `npm run fingerprint:lab -- [url]`.

This report answers one question for ReplayQA Discovery v1:

> **"Has ReplayQA reached a genuinely new application state?"**

Five fingerprint strategies (A–E) were implemented, run against a controlled local fixture and the live PhoneBook app, and compared on their ability to (a) detect real structural changes and (b) ignore data-only changes.

---

## 1. Executive summary

- **Strategy A (URL only)** is insufficient. It cannot see modals, dialogs, tabs, or SPA view-toggles that don't change the URL — exactly the cases the architecture calls out (`06-exploration.md` §1).
- **Strategies B (DOM tree) and C (a11y role tree)** detect modals and ignore search/data, **but miss SPA view-toggles** between tag-identical forms (e.g. PhoneBook's login ↔ register). Root cause: the sibling-collapse normalization that makes them data-tolerant *also* collapses structurally-distinct but tag-identical elements.
- **Strategy D (interactive surface + components)** and **Strategy E (refined hybrid)** are the only ones that detect every real change while ignoring data.
- **Recommendation: Strategy E (refined hybrid)** — `URL + a11y role tree + DOM tag tree + interactive surface + component flags + navigation signature`, all with sibling-collapse normalization. It is the only strategy that passes every experiment with zero false positives and zero false negatives.

The single most important experimental finding: **a reliable fingerprint must include the interactive surface (`role|name`)**, not just structure. Field identity is what distinguishes two forms that look identical at the tag level.

---

## 2. The five strategies

All strategies hash a canonical string with SHA-256 → 8 uppercase hex chars. They share one `collectMaterials(page)` call (a single `page.evaluate`, ≈ 4 ms) that gathers, with **sibling-collapse normalization** and **text/class/id stripping** already applied:

| Material | What it is |
|----------|------------|
| `url` | canonical URL (origin + pathname + sorted query + hash) |
| `domTagTree` | depth-first `tag[role]` tree of visible elements, collapsed |
| `a11yRoleTree` | depth-first ARIA `role[level]` tree (names dropped), collapsed |
| `interactive` | deduped, sorted set of `role\|name` for visible interactive elements |
| `components` | presence flags: `form:N\|table:N\|modal:N\|search:N\|nav:N` |
| `navSignature` | deduped, sorted labels of items inside nav landmarks |

> **Note on Strategy C:** Playwright's `page.accessibility.snapshot()` was removed from the typed API in 1.61. The role tree is therefore derived directly from the DOM (explicit `role` attr, else role inferred from tag, e.g. `a→link`, `input[type=email]→textbox`, `dialog→dialog`). This is deterministic and dependency-free.

| ID | Name | Canonical = hash(…) |
|----|------|---------------------|
| **A** | Canonical URL | `url` |
| **B** | URL + DOM structure | `url` + `domTagTree` |
| **C** | URL + Accessibility tree | `url` + `a11yRoleTree` |
| **D** | URL + Interactive + Components | `url` + `interactive` + `components` |
| **E** | Hybrid (refined) | `url` + `a11yRoleTree` + `domTagTree` + `interactive` + `components` + `navSignature` |

**Why "refined" on E?** The originally proposed E omitted the interactive surface. Experiments (§4) proved that omission makes E blind to the login↔register case, so the interactive surface was added. This is documented as a finding, not hidden.

---

## 3. Experimental setup

### 3.1 Controlled fixture (`src/discovery/state-lab/fixture/sample-app.html`)

A small CRUD-like SPA with nav (hash routing), a contacts list, a search box (client-side filter, **no URL change**), and an Add-Contact modal (`role="dialog"`, `hidden` until opened). Gives deterministic control over every state transition.

### 3.2 Live target

PhoneBook (`https://phone-book-yrap.vercel.app/`), login page. PhoneBook toggles between **Sign in** and **Sign up** views on the **same URL** `/` — the canonical hard case for URL-based fingerprinting.

### 3.3 Method

For each step: perform the action → stabilize (`networkidle` + 450 ms quiet window) → collect materials → compute all five fingerprints. A strategy "CHANGE" mark means its hash differs from the **baseline**; "·" means identical.

- `expect: change` → "·" is a **false negative**.
- `expect: same` → "CHANGE" is a **false positive**.
- `expect: return` → "CHANGE" is a **no-return** (didn't return to baseline).

---

## 4. Results

### 4.1 Controlled fixture

```
Step               Expect    A         B         C         D         E
-------------------------------------------------------------------------------
baseline           same      662FF2E1  6392A201  84C70906  215C3E24  4E2D07CA
reload             same      ·         ·         ·         ·         ·
open modal         change    ·         CHANGE    CHANGE    CHANGE    CHANGE
close modal        return    ·         ·         ·         ·         ·
search "Bob"       same      ·         ·         ·         ·         ·
clear search       return    ·         ·         ·         ·         ·
nav to #home       change    CHANGE    CHANGE    CHANGE    CHANGE    CHANGE
nav back to #list  return    ·         ·         ·         ·         ·
```

**Reading.** Only A fails (misses the modal — URL unchanged). B, C, D, E all detect the modal, all ignore the search filter, all detect the hash-route change, all return cleanly. The collapse+dedup normalization makes every structural strategy immune to the data-filter false positive.

### 4.2 Live PhoneBook (login ↔ register SPA toggle)

```
Step                   Expect    A         B         C         D         E
-----------------------------------------------------------------------------------
baseline               same      EF2AF858  7ECE693F  FA784944  CCAB4EFC  991DEDB8
reload                 same      ·         ·         ·         ·         ·
toggle login→register  change    ·         ·         ·         CHANGE    CHANGE
toggle register→login  return    ·         ·         ·         ·         ·
```

**Reading.** A, B, and C all **miss** the login↔register toggle. Only D and E detect it. This is the decisive finding of the milestone (analyzed in §5).

### 4.3 Determinism

Reload produced identical fingerprints across all strategies on both the fixture and the live app — every strategy is deterministic given a settled page.

### 4.4 Performance

Measured on the PhoneBook login page (10 iterations, warm):

| Operation | Cost |
|-----------|------|
| `collectMaterials` (the single shared `page.evaluate`) | **≈ 3.9 ms** |
| per-strategy SHA-256 hash (over ~1 KB canonical) | **≈ 3.9 µs** |

All five strategies share the same `collectMaterials` cost; the per-strategy hashing is ~1000× smaller and therefore negligible. **There is no meaningful performance difference between strategies.** Choosing E costs nothing over choosing A.

---

## 5. Key findings

### 5.1 URL alone is not enough (confirmed)

PhoneBook's login and register views share the URL `/`. A registers them as the same state. Any modal, dialog, tab, or in-page view toggle that doesn't touch the URL is invisible to A. This empirically confirms the premise in `06-exploration.md` §1.

### 5.2 The collapse trade-off (the central finding)

Sibling-collapse normalization is **required** to keep data-count changes (search filtering, pagination, record add/delete) from registering as new states. Without it, hiding 3 of 4 list items changes the DOM tree → false positive (verified by inspection of the fixture's `<li>` repetition).

But collapse has a side effect: **it also collapses structurally-distinct elements that happen to share the same tag sequence.** PhoneBook's login form (`username, password, button`) and register form (`username, email, password, confirm-password, button`) both collapse to `form > input, button` because every `<input>` reduces to the same `input` token and consecutive identical tokens collapse.

Direct evidence — material dump at login vs register on the live app:

```
url:         SAME
components:  SAME
navSignature: SAME
domTagTree:  SAME        ← despite the forms being structurally different
a11yRoleTree: SAME       ← same reason; all inputs infer to role "textbox"
interactive: DIFFERS     ← loginUsername vs registerUsername; "Sign In" vs "Create Account"
```

This is why B and C (pure structural trees) miss the toggle, and why **the interactive surface is the indispensable signal** — it carries `role|name`, and the names (`loginUsername` vs `registerUsername`, `Sign In` vs `Create Account`) are what distinguish the two forms.

### 5.3 The originally-proposed Strategy E was insufficient

The brief's Strategy E (`URL + a11y + DOM + components + nav`, no interactive) behaves like B and C on the live app — it misses the login↔register toggle. Adding the interactive surface (→ the "refined" E) fixed it. This is reported transparently rather than papered over: **the experimental evidence changed the design.**

### 5.4 Capture timing matters

With a 150 ms post-action quiet window, the live app produced spurious "no-return" results on the round-trip toggle (the toggle-back hadn't fully settled). Raising the quiet window to 450 ms eliminated it — a direct material dump confirmed `interactive`, `domTagTree`, and `a11yRoleTree` were byte-identical after the round-trip. This empirically motivates the **quiet-window capture discipline** specified in `06-exploration.md` §8: the State Manager must wait for stabilization before fingerprinting, or it will fingerprint mid-transition states.

### 5.5 Search/filter correctly ignored by all structural strategies

The fixture's search hides list items via `display:none`. Because (a) hidden elements are excluded from the trees, (b) the interactive surface is deduped (4 "Edit" buttons → 1 representative, 1 visible "Edit" → 1 representative), and (c) the visible list collapses to one representative `<li>`, search produces no false positive on B/C/D/E. This holds for the common SPA filtering pattern (hide non-matches).

---

## 6. Per-strategy analysis

### Strategy A — Canonical URL
- **Advantages:** Cheapest conceptually; trivially correct for full-page navigations and SPA route changes that update the URL.
- **Disadvantages:** Blind to every URL-preserving change.
- **False positives:** None observed.
- **False negatives:** **Modal open** (fixture), **login↔register toggle** (live). Any dialog, tab, drawer, or in-page view switch.
- **Performance:** Negligible (URL string only).
- **Verdict:** Insufficient on its own. Useful only as one input to a hybrid.

### Strategy B — URL + DOM structure
- **Advantages:** Detects modals and structural changes the URL misses; immune to search/data thanks to collapse.
- **Disadvantages:** DOM is the noisiest signal source (framework hydration, generated wrappers, SVG icons can churn between loads — not observed here, but a known risk on larger apps). Critically, **tag-only trees lose field identity**, so structurally different forms with the same tag shape collapse together.
- **False positives:** None observed on the fixture; the reload-stability test was clean.
- **False negatives:** **login↔register** (tag-identical forms collapse together).
- **Performance:** ≈ 4 ms (shared evaluate).
- **Verdict:** Better than A, but the field-identity blind spot is disqualifying for CRUD apps where forms are the primary content.

### Strategy C — URL + Accessibility role tree
- **Advantages:** More semantic and typically more stable than raw DOM (roles change less than classes/attributes).
- **Disadvantages:** Same field-identity blind spot as B — every text input reduces to role `textbox`, so forms with different fields collapse together. Also depends on the role-inference heuristic being correct (a mislabeled component is invisible).
- **False positives:** None observed.
- **False negatives:** **login↔register**.
- **Performance:** ≈ 4 ms (shared evaluate).
- **Verdict:** No better than B in practice here; the a11y tree's theoretical stability advantage didn't materialize because the discriminating signal (field identity) lives in `name`, which C deliberately drops.

### Strategy D — URL + Interactive surface + Components
- **Advantages:** The interactive surface (`role|name`) is the **only** signal that distinguished login from register. Deduping makes it count-invariant (data-tolerant). Component flags (`modal:0→1`) cleanly detect dialog open/close.
- **Disadvantages:** Coarse — a purely structural change that doesn't add, remove, or relabel an interactive element (e.g. rearranging two non-interactive regions) is invisible. Can be over-sensitive to transient interactive elements (toasts, loaders) if present.
- **False positives:** None observed.
- **False negatives:** None in this experiment, but the coarseness risk (above) is real on richer apps.
- **Performance:** ≈ 4 ms.
- **Verdict:** Strong. The minimum viable strategy if a single signal must be chosen. But it lacks defense-in-depth.

### Strategy E — Hybrid (refined)
- **Advantages:** Combines every signal, so each one's blind spot is covered by another. Detects modals (components + DOM + a11y), SPA view-toggles (interactive), navigations (URL), and nav-structure changes (navSignature). Immune to data (collapse + dedup everywhere).
- **Disadvantages:** Most material to collect (but cost is identical to the others, since all materials are gathered in one evaluate regardless). Larger canonical string (~1 KB) — irrelevant for hashing, marginally more to store if raw canonical is persisted.
- **False positives:** None observed.
- **False negatives:** None observed.
- **Performance:** ≈ 4 ms (identical to A–D).
- **Verdict:** The only strategy with a clean sheet across both the controlled fixture and the live app.

---

## 7. Comparison summary

|  | Modal (URL-unchanged) | Search / data filter | SPA view-toggle (login↔register) | Route change | Determinism (reload) | Cost |
|---|---|---|---|---|---|---|
| **A** URL | ❌ miss | ✓ stable | ❌ miss | ✓ | ✓ | ~0 |
| **B** DOM | ✓ | ✓ | ❌ miss | ✓ | ✓ | ~4 ms |
| **C** a11y | ✓ | ✓ | ❌ miss | ✓ | ✓ | ~4 ms |
| **D** Interactive+Comp | ✓ | ✓ | ✓ | ✓ | ✓ | ~4 ms |
| **E** Hybrid (refined) | ✓ | ✓ | ✓ | ✓ | ✓ | ~4 ms |

---

## 8. Recommendation for ReplayQA Discovery v1

**Adopt Strategy E (refined hybrid)** as the State Manager's `stateId` algorithm.

```
stateId = SHA-256(
    canonicalUrl
  + collapsedA11yRoleTree      // structure (semantic)
  + collapsedDomTagTree         // structure (raw)
  + dedupedInteractiveSurface   // field identity — the decisive signal
  + componentFlags              // modal/form/table/search/nav presence
  + navSignature                // nav skeleton
).slice(0, 8)
```

with these rules, all validated by the experiments above:

1. **Strip data** — ignore text content, classes, ids, inline styles, attribute values except `role`/`aria-*` used for inference.
2. **Collapse consecutive identical sibling subtrees** in both the DOM and a11y trees — this is what makes the fingerprint immune to record-count and search filtering.
3. **Dedupe the interactive surface** (it's a set of `role|name`, not a list) — same immunity, plus it's what distinguishes tag-identical forms.
4. **Include `name` on the interactive surface only** (not in the trees) — this preserves field identity where it matters without letting data-bearing text (list contents) leak into the structural trees.
5. **Fingerprint only after a quiet window** — wait for `networkidle` + ~450 ms of DOM stability, or the fingerprint will capture mid-transition states.

### Why E over D

D passed every experiment too, but D alone is coarse: a structural change that doesn't touch an interactive element (layout rearrangement, a new non-interactive region, a changed heading hierarchy) would be invisible to D. E includes the tree signals that catch those, at zero additional runtime cost. E is strictly more discriminating than D for the same price.

### Why not collapse even more aggressively

One could imagine collapsing the interactive surface too (e.g., dropping `name`, deduping by role only). The login↔register result shows exactly why that fails: without `name`, D degenerates into C and loses the toggle. `name` on interactive elements is load-bearing and must stay.

### Known limitations to carry forward

- **Attribute-level state flags** (`aria-pressed`, `aria-expanded`) are not captured. A pure toggle that flips only such a flag is invisible to all five strategies. Acceptable for v1 (a tab-toggle is rarely a "new application state"), but worth revisiting if tabs prove important.
- **Transient elements** (spinners, toasts) will change `interactive`/`components`. The State Manager should either wait them out (quiet window) or exclude known-transient regions before fingerprinting.
- **Role inference is a heuristic.** Components with non-standard markup may be mis-roled. The production implementation should prefer explicit `role` attributes and fall back to tag-based inference only when absent (as the lab already does).

---

## 9. How this folds into the production State Manager

The lab is **not** imported by the production pipeline (per the milestone constraints). When the State Manager is built (`03-modules.md` §3.3), the winning algorithm moves into it as follows:

| Lab artifact | Production home |
|--------------|-----------------|
| `collectMaterials(page)` | `BrowserController.currentMaterials()` — a new observation method alongside `currentSnapshot()` |
| `strategies[E]` | `StateManager.computeStateId(materials)` |
| collapse + dedup rules | baked into the State Manager's serializers |
| quiet-window discipline | the State Manager's capture step (`06-exploration.md` §8) |

The `State.id` placeholder introduced in Milestone 0.5 (`src/discovery/models/state.ts`) becomes `stateId = computeStateId(materials)`, and the `visited` set in `core/discover.ts` switches from `pathKey(url)` (URL-based dedup) to `stateId` (structure-based dedup) — the single concrete behavior change that the rest of the architecture has been preparing for.

---

## 10. Reproducibility

```bash
# One-shot fingerprints for a URL (the example CLI from the brief):
npm run fingerprint -- https://phone-book-yrap.vercel.app

# Full experiment suite (controlled fixture + optional live URL):
npm run fingerprint:lab
npm run fingerprint:lab -- https://phone-book-yrap.vercel.app
```

All hashes in the tables above are real outputs from those commands. Re-running against the same app version produces structurally equivalent fingerprints (the determinism guarantee the State Manager will rely on).
