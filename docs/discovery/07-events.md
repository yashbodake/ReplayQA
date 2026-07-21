# 07 — Event Bus

> Status: **Architecture specification (no implementation).**
> Prerequisite reading: `01-overview.md`..`03-modules.md`.

This document specifies the **Event Bus**: the typed in-process pub/sub channel that ties the Discovery Engine's modules together. It catalogs every event v1 emits, names each event's publishers and subscribers, describes payload shapes (described, not implemented), and states the ordering, error, and persistence guarantees.

The Event Bus exists for one reason: **to keep modules decoupled**. Detectors do not know about the RAM Builder. The Browser Controller does not know about the Reporter. Each module publishes what it knows; each module subscribes to what it needs. The result is a system where a new detector, a new reporter view, or a new persistence sink can be added without touching any other module.

---

## 1. Why a bus (and why not)

| Concern | Decision |
|---------|----------|
| Modules need to react to discoveries without being wired to their source | ✅ Bus |
| The reporter needs a live view of progress | ✅ Bus |
| The whole run needs a durable audit log | ✅ Bus (persists every event to `events.jsonl`) |
| Tests need to assert on what happened | ✅ Bus (subscribe in-process, or replay a recorded log) |
| We need cross-process / networked events | ❌ Out of scope — in-process only for v1 |
| We need high-throughput streaming | ❌ Discovery is low-volume (hundreds to low-thousands of events per run) |

Because the volume is low and all consumers are in-process, the bus is a **synchronous, ordered, in-process** channel built on Node's `events.EventEmitter`. No external broker, no queue library.

---

## 2. Bus contract (pseudocode)

```
Bus {
  publish(event: Event)            → void        # synchronous; in-order per publisher
  subscribe(name, handler)         → () => void  # returns unsubscribe
  subscribeAll(handler)            → () => void  # wildcard, for logger/reporter
  flush()                          → void        # ensure events.jsonl is on disk
}

Event {
  id:          string              # deterministic, e.g. ULID or hash(time+seq)
  name:        string              # one of the catalogued event names
  timestamp:   string              # ISO-8601, UTC
  publisher:   string              # module id, e.g. "detector.table"
  runId:       string
  payload:     object              # event-specific; see §4
}
```

### 2.1 Guarantees

1. **Per-publisher ordering.** Events from a single publisher are delivered to each subscriber in publication order. Cross-publisher ordering is not guaranteed beyond wall-clock timestamp.
2. **At-least-once within the process.** Subscribers may see an event more than once only if they themselves re-publish (e.g. replay mode). The bus itself never duplicates.
3. **No delivery after unsubscribe.** A handler removed before an event is published will not receive it.
4. **Persistent by default.** Every published event is appended to `events.jsonl` before `publish` returns, unless the event is explicitly marked `transient` (used only for high-frequency progress ticks).
5. **Failure isolation.** A throwing subscriber does not interrupt delivery to other subscribers and does not propagate to the publisher. The error is logged and counted; after a configurable threshold (`discovery.events.subscriberErrorLimit`, default `5`) the offending subscriber is auto-unsubscribed and a `SubscriberDisabled` event is emitted.

### 2.2 Non-goals

- No cross-process transport.
- No backpressure (subscribers must be non-blocking; long work is dispatched to a worker or deferred to `DiscoveryCompleted`).
- No event sourcing rebuild of engine state (the bus is an *audit and notification* channel; the RAM Builder is the source of truth for the model, the explorer for the frontier).

---

## 3. Event catalog (v1)

Events are named `<Subject><Verb>` in past tense (`…Detected`, `…Performed`, `…Completed`). The catalog is partitioned by lifecycle stage.

### 3.1 Lifecycle & control

| Event | Publisher | Subscribers | Payload (sketch) | Purpose |
|-------|-----------|-------------|-------------------|---------|
| `DiscoveryStarted` | orchestrator | reporter, logger | `{ runId, config, seed, budgets }` | Mark run begin. |
| `DiscoveryProgress` | orchestrator | reporter | `{ statesSeen, frontierSize, budgetUsed, elapsedMs }` `transient` | Live progress UI. |
| `BudgetWarning` | orchestrator | reporter, logger | `{ budget, used, limit }` | Near-limit alerts (80/90/100%). |
| `DiscoveryCompleted` | orchestrator | reporter, ram, logger | `{ runId, reason, stats, outputs }` | Trigger final report + RAM flush. |
| `DiscoveryFailed` | orchestrator | reporter, logger | `{ runId, error, stage, partialOutputs }` | Fatal-error handling. |
| `SubscriberDisabled` | bus | logger | `{ subscriber, errorCount }` | Failure isolation notice. |

### 3.2 Browser & navigation

| Event | Publisher | Subscribers | Payload (sketch) | Purpose |
|-------|-----------|-------------|-------------------|---------|
| `PageVisited` | browser | logger, reporter | `{ url, canonical, title, loadType }` | Track page loads. |
| `NavigationPerformed` | browser | navigation, logger | `{ fromUrl, toUrl, kind: "navigate"\|"spa-route"\|"in-page", trigger? }` | Edge recording. |
| `NetworkObserved` | browser | detectors (crud), logger | `{ method, urlTemplate, status, requestIds }` (headers redacted) | CRUD/network inference. |
| `ActionPerformed` | browser | reporter, detectors (toast) | `{ actionId, fromStateId, kind, safety, result }` | Drive reactive detectors. |
| `ActionRefused` | browser | logger, reporter | `{ actionId, reason: "destructive"\|"cross-origin"\|"timeout" }` | Safety audit trail. |

### 3.3 State

| Event | Publisher | Subscribers | Payload (sketch) | Purpose |
|-------|-----------|-------------|-------------------|---------|
| `StateCreated` | state | detectors, navigation, ram | `{ stateId, url, routeSignature, componentsPreview }` | Kick off detection + frontier expansion. |
| `StateRevisited` | state | navigation, logger | `{ stateId, viaEdge }` | Edge-only dedup. |
| `StateCaptureFailed` | state | logger, reporter | `{ fromUrl, error }` | Diagnostic. |

### 3.4 Detection (one per FindingType)

| Event | Publisher | Subscribers | Payload (sketch) |
|-------|-----------|-------------|-------------------|
| `NavigationFound` | detector.navigation | ram, navigation | landmark + items |
| `FormDetected` | detector.form | ram, detector.crud | form payload (see `04-detectors.md` §6.3) |
| `TableDetected` | detector.table | ram, detector.crud | table payload |
| `SearchDetected` | detector.search | ram, detector.crud | search payload |
| `ModalDetected` | detector.modal | ram, detector.form | modal payload |
| `ToastDetected` | detector.toast | ram | toast payload (incl. `triggerActionId`) |
| `AuthenticationDetected` | detector.login | ram, orchestrator | auth payload |
| `CrudDetected` | detector.crud | ram | entity + operations payload |

### 3.5 Model

| Event | Publisher | Subscribers | Payload (sketch) | Purpose |
|-------|-----------|-------------|-------------------|---------|
| `EntityResolved` | ram | reporter | `{ entityId, name, source, confidence }` | New/mutated entity. |
| `CrudCoverageChanged` | ram | reporter | `{ entityId, coverage: { create, read, update, delete } }` | Coverage grid updates. |
| `FlowResolved` | ram | reporter | `{ flowId, kind, name, entityId?, operation?, confidence, reliability?, promoted }` | A Flow was synthesized/finalized (see `09-flows.md`). Emitted whether or not promoted; `promoted=false` means it was kept for review only. |
| `ApiEndpointMapped` | ram | reporter | `{ endpointId, method, urlTemplate, entityId?, crudOperation?, flowIds?[] }` (headers redacted) | An endpoint was lifted into `extensions.api` and bound to model objects. |
| `TransitionAnnotated` | ram | reporter | `{ transitionId, fromStateId?, toStateId?, actionId?, guard?, group? }` | A semantic transition was recorded into `extensions.transitions`. |
| `RamUpdated` | ram | reporter | `{ modelSize, meanConfidence }` `transient` | Live report refresh. |
| `RamFinalized` | ram | orchestrator, reporter | `{ path, schemaVersion, validation: { ok, errors } }` | Signal model is sealed on disk. `schemaVersion` reflects 1.1 once Flows/extensions are emitted. |
| `RamValidationFailed` | ram | orchestrator, logger | `{ errors }` | Hard failure before write. |

---

## 4. Payload shape conventions

Payloads are plain JSON-serializable objects. Every detection payload is **identical in shape to the corresponding Finding's `payload`** from `04-detectors.md`, plus two envelope fields:

```
Payload (detection events) = Finding.payload ∪ {
   findingId:   string,
   stateId:     string,
   confidence:  number,
   evidence:    Evidence[]
}
```

This identity is deliberate: the bus does not transform detector output. The RAM Builder receives exactly what the detector produced. Any consumer can subscribe to the same stream and build its own view.

### 4.1 Redaction

- Every `NetworkObserved` payload passes through `utils.redactHeaders` before publish.
- Credentials are never placed in any payload by the Browser Controller; the auth step logs `password: "<redacted>"`.
- Toast messages are length-capped (default 280 chars) and stripped of anything resembling a token/JWT via a conservative regex.

### 4.2 Deterministic ids

Every event has `id` and every finding has `findingId`. Both are stable hashes of their semantic content (not random UUIDs) so that two runs of the same app produce equivalent event streams — the same property that makes the RAM diff-friendly (`05-ram.md` §5.2).

---

## 5. Publishers → Subscribers matrix

```
                │  orchestrator │ browser │ state │ detectors │ ram │ bus │ reporter │ logger
────────────────┼──────────────┼─────────┼───────┼───────────┼─────┼─────┼──────────┼───────
DiscoveryStarted│      P       │         │       │           │     │     │    S     │   S
DiscoveryProgress│     P       │         │       │           │     │     │    S     │
BudgetWarning   │      P       │         │       │           │     │     │    S     │   S
DiscoveryCompleted│    P       │         │       │           │  S  │     │    S     │   S
DiscoveryFailed │      P       │         │       │           │  S  │     │    S     │   S
PageVisited     │              │    P    │       │           │     │     │    S     │   S
NavigationPerformed│           │    P    │   S   │           │     │     │          │   S
NetworkObserved │              │    P    │       │    S(crud)│     │     │          │   S
ActionPerformed │              │    P    │       │   S(toast)│     │     │    S     │   S
ActionRefused   │              │    P    │       │           │     │     │    S     │   S
StateCreated    │              │         │   P   │     S*    │  S  │     │    S     │   S
StateRevisited  │              │         │   P   │     S(nav)│     │     │          │   S
*Detected (any) │              │         │       │     P     │  S  │     │    S     │   S
EntityResolved  │              │         │       │           │  P  │     │    S     │
CrudCoverageChanged│           │         │       │           │  P  │     │    S     │
FlowResolved     │              │         │       │           │  P  │     │    S     │
ApiEndpointMapped│              │         │       │           │  P  │     │    S     │
TransitionAnnotated│            │         │       │           │  P  │     │    S     │
RamUpdated      │              │         │       │           │  P  │     │    S     │
RamFinalized    │              │         │       │           │  P  │  S  │    S     │   S
RamValidationFailed│           │         │       │           │  P  │     │          │   S
SubscriberDisabled│            │         │       │           │     │  P  │          │   S
```

`P` = publishes, `S` = subscribes. `*Detected (any)` covers the eight detection events; each detector publishes its own, the RAM Builder subscribes to all of them, and (for `crud`) cross-detector subscription is noted where one detector consumes another's findings. The three model-side events `FlowResolved`, `ApiEndpointMapped`, and `TransitionAnnotated` are all published by `ram` after detector findings and the state graph are closed, and consumed only by the `reporter` for live view updates — they describe RAM-side synthesis, not new browser work.

---

## 6. Topology diagram

```
   ┌───────────────┐                                   ┌──────────────┐
   │ orchestrator  │──── DiscoveryStarted/Completed ──▶│   reporter   │
   └───────────────┘                                   └──────────────┘
   ┌───────────────┐  PageVisited/NetworkObserved/      ┌──────────────┐
   │   browser     │──── ActionPerformed ──────────────▶│   reporter   │
   └───────────────┘                  │                  └──────────────┘
                                      │ ActionPerformed       ▲
                                      ▼                        │
   ┌───────────────┐  StateCreated ──▶┌──────────────┐  *Detected │
   │    state      │──── StateCreated─▶│  detectors   │───────────┘
   └───────────────┘                   └──────────────┘
                                      │  *Detected
                                      ▼
   ┌───────────────┐  NavigationPerformed / StateRevisited    ┌──────────────┐
   │  navigation   │◀─────────────────────────────────────────│     ram      │
   └──────┬────────┘   *Detected (consumed by crud detector)  └──────────────┘
          │ candidateAction                                                    ▲
          └──── (findings → explorer via direct call, not bus) ────────────────┘
                                  (candidate actions are read from finding
                                   payloads; the bus carries findings, not
                                   imperative "do this" commands — see §7)
```

Two structural points worth emphasizing:

1. **The bus carries facts, not commands.** A detection event says "a form was found"; it does not say "go click the form". The explorer reads candidate actions from finding *payloads* via a direct (typed) call to the Detector Manager's results, never from the bus. This keeps the bus a clean audit/notification channel and preserves the single decision path described in `02-pipeline.md` §3.
2. **`ram` and `reporter` depend on the bus, nothing else.** They never import `browser`. This is the invariant that makes them safely unit-testable with event fixtures.

---

## 7. Fact-vs-command discipline

To prevent the bus from mutating into a hidden control-flow channel, these rules are enforced by convention + review:

| Allowed on the bus | Not allowed on the bus |
|---------------------|------------------------|
| "X was detected" | "Do X" |
| "Action was performed" (past tense) | "Perform action" (imperative) |
| "State was created" | "Navigate to state" |
| "Budget was exceeded" | "Stop the run" (the orchestrator decides this from its own watchdog + budget counters) |

The one exception is `DiscoveryCompleted`/`DiscoveryFailed`, which the orchestrator emits **after** it has already decided to stop; reporters and the RAM Builder react to it, they do not obey it as a command.

---

## 8. Persistence and replay

- **`events.jsonl`**: newline-delimited JSON, one Event per line, append-only, fsynced on `Bus.flush()`. Lives at `artifacts/discovery/<run-id>/events.jsonl`.
- **Transient events** (`DiscoveryProgress`, `RamUpdated`) are also persisted but flagged in-payload (`transient: true`) so replay tooling can skip them when reconstructing a faithful model.
- **Replay mode**: `Bus.replay(filePath)` reads an `events.jsonl` and re-publishes every event in order. Used by:
  - The Reporter in dry-runs (regenerate `discovery-report.html` from a past run without re-discovering).
  - Tests (assert against a recorded event stream).
  - The future `replayqa discovery diff <run-a> <run-b>` command (compare two runs by their event streams).

---

## 9. Error and overload handling

| Scenario | Handling |
|----------|----------|
| Subscriber throws | Caught by the bus, logged, counted; auto-unsubscribe after threshold; `SubscriberDisabled` emitted. |
| Publisher throws before publishing | Propagates to the caller (the module), which must handle it; no event is emitted. |
| Publisher throws mid-publish (rare) | The event is already on disk; subscribers already notified. Treated as a subscriber error for the trailing ones. |
| `events.jsonl` write fails | The bus switches to "memory-only + warn" mode; the run continues but the audit log is incomplete. Surfaced in the report. |
| Event volume spike | The only high-frequency events are the two transient ticks. They are debounced (default `250ms`) before publish. |

---

## 10. Adding a new event (recipe)

1. Pick a name from the past-tense convention; add it to §3.
2. Declare the payload shape in §4 (or reference a Finding payload from `04-detectors.md`).
3. Add the publisher and subscriber columns in §5.
4. Add a JSON Schema entry for the payload alongside the RAM schema (see `08-folder-structure.md`).
5. If the event represents a new model object, also update `05-ram.md` §3 and the RAM schema.

Because events are the integration layer, every new event is an architecture-level decision and should be reviewed as such. Detectors adding *findings* (existing event names with new payloads) do not need this scrutiny — that is the extension mechanism designed to be cheap.
