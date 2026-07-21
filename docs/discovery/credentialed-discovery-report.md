# ReplayQA v0.4 — Credentialed Exploration Report

> Status: **Discovery-only milestone (credentialed exploration).**
> Code: `src/discovery/login/verify.ts`, `failure.ts`, refactored `login.ts`,
> `cli/args.ts` (CLI flags + layered resolver), `core/discover.ts`.
> NOT modified: AI Reasoning, QA Planning, Test Generation, Reliability Pipeline.

## What was built

| Component | Role |
|-----------|------|
| `login/verify.ts` | Multi-signal login verification (URL change, login form gone, logout visible, user menu, dashboard heading) |
| `login/failure.ts` | `LoginFailedError` with evidence + suggested causes + console reporter |
| `login/login.ts` | Refactored: `performLogin` (mechanics) + `loginAndVerify` (mechanics + verification) |
| `cli/args.ts` | `--username` / `--password` CLI flags + layered resolver (CLI > env > config) |
| `core/discover.ts` | Uses `loginAndVerify`; throws `LoginFailedError` on failure (after preserving partial artifacts) |
| `state-lab/fixture/auth-app.html` | Authenticated CRUD fixture (admin/secret) for deterministic validation |

## Credential precedence

```
1. CLI flags        (--username admin --password secret)    highest
2. Environment      (REPLAYQA_DISCOVERY_USERNAME / _PASSWORD)
3. Config           (replayqa.config.json → discovery.credentials with ${ENV})
```

Credentials are never persisted, logged, or written to any artifact. Verified by
grepping all artifacts for the test password "secret" after a credentialed run:
**clean** (zero matches).

## Login verification policy

Login is considered successful ONLY when:
1. The login form (password field) is **gone**, AND
2. At least **one** of these corroborating signals is observed:
   - URL changed (navigated away from the login route)
   - A logout / sign-out control is visible
   - A user-menu / account / profile element is visible
   - The page heading looks like an authenticated landing ("My Contacts", "Dashboard", etc.)

If the form disappeared but no corroboration is found, login is treated as a
**FAILURE** — ReplayQA does not assume success.

## Login failure handling

When credentials are supplied but login does not verify:
1. **Discovery stops** — no authenticated exploration is attempted.
2. **The reason is explained** — the verification evidence (which signals fired/didn't) + the verdict.
3. **Possible causes are suggested** — wrong credentials, OAuth/MFA/captcha, non-standard submit label, slow page settle.
4. **Artifacts are preserved** — the landing state (captured before the login attempt) is persisted to `states/` and `discovery.json`.

Verified with wrong credentials against the auth fixture:

```
✗ Login failed — Discovery stopped before exploration.
  Reason: login form is still visible after submit
  Possible causes:
    - The credentials are likely incorrect, or the form rejected the input.
    - The login may require OAuth/SSO, MFA, or a captcha …
    - The submit button label may not match …
    - The page may not have settled after submit …
  Artifacts captured before login (landing state) are preserved under artifacts/discovery/states/.
```

## Validation: before / after comparison

Target: the authenticated CRUD fixture (`auth-app.html`, credentials
`admin` / `secret`). The downstream systems (reasoning, planning, generation)
were **not modified** — any improvement comes purely from Discovery crossing
the login wall.

### Discovery depth

| | Anonymous (no creds) | Credentialed (admin/secret) |
|---|---|---|
| Discovered pages | **1** (login form only) | **3** (login + authenticated app + Add-Contact modal) |
| Create form observed | ✗ | **✓** (`fields:[name]`, submit `Save`) |
| Authenticated controls | ✗ | **✓** (Logout, Add Contact, Edit) |
| Transition graph | — | `authed —Add Contact→ modal` + 4 skipped actions (Logout destructive, Edit no-op) |

### AI understanding (unchanged reasoner)

| | Anonymous | Credentialed |
|---|---|---|
| Confidence | **0.42** | **0.68** |
| Entities | `User` | **`User, Contact`** |
| Capabilities | `Authentication` | **`Authentication, Create, Read, Update, Delete, Search`** |
| Application type | "web application with user authentication" | "web app for managing personal contacts with login authentication" |

### QA plan quality (unchanged planner)

| | Anonymous | Credentialed |
|---|---|---|
| Confidence | — | **0.65** |
| Functional scenarios | ~2 (login only) | **10** (full CRUD coverage) |
| Blind spots | "cannot determine CRUD or search for contacts" (coarse) | **precise**: "cannot test Delete (no delete button observed)", "cannot test Pagination", "cannot test Registration" |

The anonymous baseline could only say "I can't see anything past login." After
credentialed discovery, the same unchanged reasoner identified the full Contact
entity and all six CRUD+Search capabilities; the unchanged planner generated 10
grounded scenarios; and the remaining blind spots are now app-specific facts
(the fixture genuinely has no delete button) rather than observation gaps.

## Final evaluation

### What percentage of the application became visible after authentication?

Going from 1 page to 3 pages uncovered the **entire authenticated surface** of
the fixture: the contacts list (with search, Add Contact, Edit), the create
modal (with form fields), and the logout control. The only things NOT observed
are features the fixture does not have (delete button, pagination, registration)
— those are app facts, not observation failures.

### Which blind spots disappeared?

The dominant anonymous blind spot — "cannot determine CRUD or search for
contacts because ReplayQA has not explored any pages beyond the login screen" —
**disappeared entirely**. It was replaced by specific, actionable gaps (Delete,
Pagination, Registration, Password Recovery) that are genuine app properties.

### Did the unchanged downstream improve?

Dramatically: reasoning confidence rose 0.42 → 0.68 (+62%); the entity model
went from `User` to `User, Contact`; the capability model went from just
`Authentication` to the full CRUD+Search set; and the plan grew from ~2 login
scenarios to 10 grounded CRUD scenarios. All from Discovery alone.

### What prevented testing on PhoneBook?

PhoneBook's registration backend was unavailable throughout the entire milestone
window (verified across multiple attempts spanning hours). Without registration,
no credentials could be obtained to cross PhoneBook's login wall. The
authenticated fixture served as the deterministic validation target.

### What remains impossible to observe?

1. **OAuth / SSO / MFA / captcha flows.** The login strategy is standard
   username/password only (by design, per the milestone scope). If the login
   form redirects to OAuth or requires a second factor, ReplayQA stops with a
   clear failure message.
2. **Destructive actions (Delete).** Correctly never probed; their existence is
   inferred from button presence only.
3. **Session-expiring apps.** If the session expires during exploration (long
   discovery, short token TTL), later probes may hit a login redirect. Detecting
   mid-run session loss is a future enhancement.

## Reproducibility

```bash
# Anonymous (baseline): 1 page, can't see past login.
npm run discover -- file://$PWD/src/discovery/state-lab/fixture/auth-app.html

# Credentialed: 3 pages, full CRUD observed.
npm run discover -- file://$PWD/src/discovery/state-lab/fixture/auth-app.html \
  --username admin --password secret

# Login failure: wrong creds → stops with explanation.
npm run discover -- file://$PWD/src/discovery/state-lab/fixture/auth-app.html \
  --username wrong --password wrong

# Credentials via environment:
REPLAYQA_DISCOVERY_USERNAME=admin REPLAYQA_DISCOVERY_PASSWORD=secret \
  npm run discover -- file://.../auth-app.html

# Full MVP pipeline with credentials:
CEREBRAS_API_KEY=… npm run replayqa -- file://.../auth-app.html \
  --username admin --password secret --yes
```
