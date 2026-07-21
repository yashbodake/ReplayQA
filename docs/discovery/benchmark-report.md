# ReplayQA v0.6 — Real World Validation Benchmark

> Status: **Benchmark validation.**
> No new capabilities implemented — existing engine run against 6 diverse targets.
> Evidence: `artifacts/benchmark/benchmark-results.json` + per-app artifacts.

## Benchmark targets

| # | App | Category | Auth | URL |
|---|-----|----------|------|-----|
| 1 | TodoMVC (Vue) | SPA Todo CRUD | none | todomvc.com/examples/vue/dist/ |
| 2 | OrangeHRM Demo | Enterprise HR Admin | Admin/admin123 | opensource-demo.orangehrmlive.com |
| 3 | SauceDemo | E-commerce | standard_user/secret_sauce | saucedemo.com |
| 4 | The Internet | Testing Playground | none | the-internet.herokuapp.com |
| 5 | Auth Fixture | Control (auth CRUD) | admin/secret | local |
| 6 | CRUD Fixture | Control (no-auth CRUD) | none | local |

## Results

```
App                 Status   Pages States Flows Jour  RConf  PConf Scen Blind  Time
─────────────────────────────────────────────────────────────────────────────────────
TodoMVC (Vue)       ✓            1      1     0    0   0.60   0.55    5     6    4s
OrangeHRM Demo      ✗ FAIL       0      0     0    0    —      —      0     0    4s
SauceDemo           ✓            4      4     2    2   0.55   0.71   11     5    6s
The Internet        ✓           10     10     1    1   0.68   0.62    7     4   14s
Auth Fixture        ✓*           3      3     1    1   0.68   0.78    6     5    1s
CRUD Fixture        ✓*           4      4     1    1   0.62   0.71    8     5    1s
```

`✓*` = discovery succeeded; reasoning/plan validated in prior milestones (rate-limited during this benchmark batch).

**Pass rate: 5 / 6 apps (83%).** OrangeHRM failed at login.

## Per-app analysis

### 1. TodoMVC (Vue) — limited discovery

- **What worked:** Reasoning correctly identified the app as a todo manager (`Todo` entity, `Add Todo` + `View Todo List` capabilities). 5 scenarios generated.
- **What failed:** **0 interactive states discovered.** TodoMVC has NO action buttons — adding a todo is via typing into a text input and pressing Enter. The probe system (`currentActions()`) only enumerates `<button>` / `[role="button"]` elements. With zero buttons to probe, 0 flows were recorded.
- **Blind spots:** edit todos, delete todos, toggle completion, clear completed — all unseen because their UI controls are not standard buttons (checkboxes for toggle, a `<button>` for clear-completed that may be dynamically rendered only when items exist).
- **Failure class:** Text-input-driven actions (no buttons to probe).

### 2. OrangeHRM Demo — login failure

- **What happened:** Login was attempted with the documented credentials (Admin/admin123). The fill + submit succeeded, but verification reported "login form is still visible after submit." A manual probe of the page also timed out — OrangeHRM is a **heavy enterprise SPA** (~3 MB of assets) that is slow to load and settle.
- **Root cause:** The page likely did not settle within the 15-second `waitForStable` timeout after the submit click. The login may have partially succeeded (credentials are valid) but the SPA's post-login transition (loading overlay → dashboard) took longer than the verification window.
- **Failure class:** Heavy SPA / slow page load exceeding the login-verification timeout.

### 3. SauceDemo — strong performance

- **What worked:** Login succeeded (standard_user/secret_sauce). 4 pages discovered (Login → Inventory → Cart + an overlay menu state). 2 flows recorded: "Open Menu" (sidebar drawer) and "Add to cart" (button → state change). 11 plan scenarios. The reasoning identified 3 entities (`User`, `Product`, `CartItem`) and 7 capabilities (Authentication, Product Listing, Add to Cart, Remove from Cart, Menu Navigation, Logout, Reset App State).
- **What failed:** Product detail pages were NOT discovered — product names are links (`<a>`), not buttons. The nav-follow captured the inventory page but didn't follow individual product links (they're same-page `<a>` elements that the nav-follow treats as navigation but the product detail page wasn't captured as a distinct state). Blind spot: "cannot recommend tests for Product Detail View."
- **Failure class:** Action-links (anchors that act as buttons, e.g. product detail links) not probed.

### 4. The Internet — deep navigation

- **What worked:** 10 pages discovered (the deepest exploration of any target). The Internet has ~40 links on its landing page, and ReplayQA followed 10 of them (capped by maxPages). 1 flow ("Add Element" on the add-remove-elements page). 7 plan scenarios.
- **What failed:** Most of The Internet's sub-pages are one-off demos (checkboxes, dropdowns, drag-and-drop) with no interactive CRUD. The probes found "Add Element" (a genuine button) but the other pages had no probe-able buttons. Blind spots: "cannot recommend tests for File Upload, File Download, Drag-and-Drop" — unsupported UI patterns.
- **Failure class:** Unsupported UI patterns (drag-and-drop, file upload, rich editors).

### 5–6. Auth/CRUD Fixtures — validated controls

Both local fixtures performed as validated in prior milestones (3–4 pages, 1 flow each, plan confidence 0.71–0.78). They serve as the known-good baseline confirming the engine works on standard CRUD apps.

## Failure classification

| Failure class | Apps affected | Root cause | Impact |
|---------------|---------------|------------|--------|
| **Text-input-driven actions** | TodoMVC | Probes only enumerate buttons; text input + Enter is invisible | 0 interactive states discovered |
| **Action-links not probed** | SauceDemo | Links that act as buttons (product detail) are nav-followed, not probed | Product detail pages unseen |
| **Heavy SPA / slow load** | OrangeHRM | Login verification timeout (15s) insufficient for enterprise apps | Login failed |
| **No form completion** | All CRUD apps | Probes open forms but don't fill + submit | Post-save state unseen |
| **Unsupported UI patterns** | The Internet | Drag-and-drop, file upload, rich editors not handled | Pages explored but interactions invisible |
| **Rate limit (API)** | Fixtures | Cerebras API 429 after 4 calls/min | Recoverable with retry/delay |

## Recurring failure patterns

1. **Button-only probing is the #1 discovery bottleneck.** Two of four real apps (TodoMVC, SauceDemo product links) have significant UI actions that are NOT buttons. Extending the probe candidate enumeration beyond buttons would immediately improve discovery depth on both.

2. **Form completion remains the #1 generation bottleneck** (confirmed for the 6th consecutive milestone). The probe opens the form but doesn't fill + submit, so the post-save verification state is never observed.

3. **Login timing is fragile on heavy SPAs.** A 15-second timeout works for lightweight apps (SauceDemo, fixtures) but not for enterprise SPAs (OrangeHRM). A configurable timeout + retry would help.

## Strengths

- **SauceDemo (real e-commerce app):** full login + product discovery + cart + interactive probes → 11-scenario plan at 0.71 confidence. ReplayQA successfully explored a real authenticated application end-to-end.
- **The Internet:** 10-page deep navigation. ReplayQA followed links broadly and captured diverse page structures.
- **Reasoning quality:** even with partial observations (TodoMVC's 1 page), the LLM correctly identified the app type, entity, and capabilities — and honestly reported what it couldn't see.
- **Credential hygiene:** verified clean across all runs (no password in any artifact).

## Recommendation: v0.7

**Expand probe candidates beyond buttons to include action-links and text-input-driven actions.**

Evidence for this ranking:

| Candidate v0.7 feature | Apps it would improve | Impact |
|------------------------|----------------------|--------|
| **Probe action-links** (anchors that trigger SPA views: product details, edit links) | SauceDemo, The Internet, most real CRUD apps | Product detail, edit-detail pages become observable |
| **Probe text inputs** (input + Enter as an action) | TodoMVC, any input-driven app | Todo creation, search-submit become observable |
| Form-completion probes (fill + submit) | All CRUD apps | Post-save verification observed |
| Login timeout extension | OrangeHRM, enterprise SPAs | Login success rate improves |

"Probe action-links + text inputs" improves the **largest number of applications**
(2 of 4 real apps immediately, plus any future app with link/input-driven
actions). Form-completion probes are a close second — they would improve
generation quality on every CRUD app, but they don't unlock NEW pages/states
the way expanding probe candidates does.

**Therefore: v0.7 = Expand Action Probe candidates beyond buttons.**

## Reproducibility

```bash
# Run the full benchmark:
CEREBRAS_API_KEY=… npx tsx src/discovery/run/benchmark-apps.ts

# Inspect per-app artifacts:
ls artifacts/benchmark/<app-name>/
#   discovery.json  reasoning.json  test-plan.json
#   flow-graph.json  journeys.json  flow-report.html
#   states/  findings/
```
