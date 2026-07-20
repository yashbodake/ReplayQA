# ReplayQA

**A Playwright-powered QA framework that doesn't just run tests — it replays them.**

ReplayQA captures every detail of your test runs — video recordings, screenshots, network traffic, console logs, and execution traces — then bundles them into a single, interactive HTML dashboard you can share with your team.

No more guessing what went wrong. Just hit play and watch it happen.

---

## Why ReplayQA?

Most test runners give you a green checkmark and a vague error message. ReplayQA gives you the **full story**:

- Watch a **video recording** of the browser as the test ran
- See **screenshots** captured at the exact moment of failure
- Inspect **every network request** — method, URL, status, headers
- Read **console logs** — warnings, errors, info — color-coded and timestamped
- Download the full **Playwright trace** for deep debugging

All of it embedded directly in a beautiful dark-mode HTML report. No external services. No cloud uploads. Just open the file and replay.

---

## Features

### Interactive Test Selection (CLI)

Don't want to run everything? Use the interactive CLI to pick exactly which tests to execute:

```bash
npm run replay
```

```
ReplayQA — 9 tests available
  ↑/↓ navigate  ·  space toggle  ·  a select all  ·  n select none  ·  enter confirm

 → [x] Auth Flow › should register a new user
   [ ] Auth Flow › should login with existing user
   [x] Contact CRUD › should add a new contact

  2 tests selected
```

Arrow keys to navigate. Spacebar to toggle. Enter to run. It's that simple.

### Rich HTML Dashboard

After every test run, ReplayQA generates `reports/index.html` — a fully self-contained dashboard featuring:

| Feature | What you get |
|---------|-------------|
| **Video Player** | Embedded `<video>` player — watch the browser session inline |
| **Screenshots** | Inline image gallery — click to enlarge |
| **Console Logs** | Color-coded, scrollable log viewer with timestamps |
| **Network Logs** | Sortable table — every request/response with status badges |
| **Trace Files** | Downloadable `.zip` — open with `npx playwright show-trace` |
| **Test Cards** | Expandable per-test sections with artifact badges |
| **Summary** | Pass/fail/skip counts at a glance |
| **Toolbar** | Expand All / Collapse All controls |

### Configurable Artifact Collection

Fine-tune what gets captured via `replayqa.config.json`:

```json
{
  "outputDir": "./artifacts",
  "artifacts": {
    "videos": true,
    "screenshots": true,
    "traces": true,
    "consoleLogs": true,
    "networkLogs": true
  },
  "playwright": {
    "testDir": "./tests",
    "retries": 0,
    "workers": "auto"
  }
}
```

Turn off what you don't need. Keep your runs lean.

### Modular Architecture

```
src/
├── cli/              Interactive test selector + discovery
├── collectors/       Console & network log collectors
├── config/           Config loader (JSON sync + async TS/JS)
├── reporter/         Custom Playwright reporter + HTML generator
├── runner/           Test fixtures with auto-attached collectors
└── utils/            Shared helpers
```

Each module is independent, typed, and extensible.

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
git clone https://github.com/yashbodake/ReplayQA.git
cd ReplayQA
npm install
npx playwright install chromium
```

### Run All Tests

```bash
npm test
```

### Run Tests Interactively

```bash
npm run replay
```

Select the tests you want with `space`, then press `enter`.

### View the Report

```bash
xdg-open reports/index.html
```

Or just open `reports/index.html` in your browser.

---

## What Gets Generated

After a test run, you'll find:

```
artifacts/
├── test-output/              Playwright native artifacts
│   └── <test-name>/
│       ├── video.webm        Browser session recording
│       ├── trace.zip         Full execution trace
│       └── test-finished-1.png   Screenshot
└── logs/                     ReplayQA collector output
    └── chromium/<test-name>/
        ├── console.json      Every console message
        └── network.json      Every network request/response

reports/
└── index.html                The interactive dashboard
```

---

## Demo App — Phonebook Pro

ReplayQA's test suite runs against [Phonebook Pro](https://phone-book-yrap.vercel.app/), a full-stack contact management app built with Vue 3, FastAPI, and PostgreSQL.

The test suite covers the complete user journey:

| Test | What it verifies |
|------|-----------------|
| Register | New user signup and auto-login |
| Login | Existing user authentication |
| Add Contact | Create a contact and verify it appears |
| Search | Filter contacts by name |
| Edit Contact | Update a contact via PUT API |
| Delete Contact | Remove a contact with confirm dialog |
| Logout | Session teardown and redirect |
| Full Flow | End-to-end journey: register through logout |

**Phonebook Pro source code:** [github.com/yashbodake/PhoneBook](https://github.com/yashbodake/PhoneBook)

**Live demo:** [phone-book-yrap.vercel.app](https://phone-book-yrap.vercel.app/)

---

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run all Playwright tests |
| `npm run replay` | Interactive test selector (spacebar to pick) |
| `npm run test:headed` | Run tests in visible browser window |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting files |

---

## Tech Stack

- **Playwright** — browser automation and test runner
- **TypeScript** — strict typing, NodeNext modules
- **Node.js** — CLI tooling and custom reporter
- **Zero runtime dependencies** — just Playwright

---

## Configuration Reference

### `replayqa.config.json`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `outputDir` | `string` | `"./artifacts"` | Root directory for all artifacts |
| `artifacts.videos` | `boolean` | `false` | Enable video recording |
| `artifacts.screenshots` | `boolean` | `false` | Enable screenshot capture |
| `artifacts.traces` | `boolean` | `false` | Enable Playwright traces |
| `artifacts.consoleLogs` | `boolean` | `false` | Enable console log collection |
| `artifacts.networkLogs` | `boolean` | `false` | Enable network log collection |
| `playwright.testDir` | `string` | `"./tests"` | Test file directory |
| `playwright.retries` | `number` | `0` | Retry count on failure |
| `playwright.workers` | `number \| "auto"` | `"auto"` | Parallel worker count |

---

## How It Works

```
CLI (Interactive Selector)
    │
    ▼
Config Loader (replayqa.config.json)
    │
    ▼
Playwright Runner (test execution)
    │
    ├── Collectors (console + network logs per test)
    │
    ▼
ReplayQA Reporter
    │
    ├── Reads video, screenshot, trace attachments
    ├── Reads console.json + network.json
    ├── Embeds log data inline
    │
    ▼
HTML Dashboard (reports/index.html)
```

---

## License

MIT

---

<div align="center">

**Made with care by [Yash Bodake](https://github.com/yashbodake)**

*Test it. Watch it. Replay it.*

</div>
