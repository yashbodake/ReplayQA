# ReplayQA Narration Engine — v0.8 Evaluation

**Milestone:** v0.8 — AI Narrated Test Report
**Status:** ✅ Complete and validated on TodoMVC + SauceDemo
**Date:** 2026-07-25

The Narration Engine transforms a completed ReplayQA run into
`ReplayQA-Summary.mp4` — a narrated summary video that combines the recorded
browser execution with an AI-generated, fact-grounded voice-over. Narration is
derived **entirely from ReplayQA's structured artifacts and execution
timeline**. No video analysis, computer vision, or OCR is used in the narration
pipeline itself.

> **Note on the visual-match audit:** A separate, opt-in audit tool
> (`src/narration/audit/visual.ts`) uses a vision model to check whether the
> summary video's frames are consistent with the spoken chapters. This was added
> at the user's explicit request and **overrides the milestone's no-CV/OCR
> constraint for verification purposes only**. It is not part of the narration
> pipeline — the script and audio are always produced from structured artifacts.

---

## Verification tooling (`src/narration/audit/`)

Two audit tools run alongside narration to enforce factual integrity:

1. **Accuracy checker** (`accuracy.ts`) — milestone-compliant (text-only).
   Extracts every numeric/factual claim from the spoken script and reconciles
   it against the context's artifacts. Writes `accuracy.json`. Catches
   hallucinations like an invented state count or an unsupported capability.
2. **Visual-match audit** (`visual.ts`) — opt-in via `NARRATION_VISUAL_AUDIT=true`
   + an API key for a vision-capable model. Extracts a frame at each chapter's
   start timestamp, asks the vision model to describe it, and cross-checks the
   description against the chapter's facts. Writes `visual-audit.json` +
   `frames/`. Degrades gracefully to frame-only extraction if no vision model is
   configured.

Both are **verification tools** — they never feed back into narration generation.

---

## Architecture

```
artifacts (discovery, reasoning, plan, flow-graph, journeys, reliability, video)
        │
        ▼
  timeline/    TimelineRecorder — REAL streamed runtime events → timeline.json
        ▼
  NarrationContext  (sole input to the Script Generator)
        ▼
  planner/     chapters with verified facts only — NO natural language
        ▼
  script/      the ONLY natural-language generation (LLM + deterministic fallback)
        ▼
  tts/         TTSProvider interface; EdgeTTSProvider is the first implementation
        ▼
  render/      RenderPolicy strategy; DefaultRenderPolicy loops video → narration
        ▼
  reports/ReplayQA-Summary.mp4  (+ HTML report extension)
```

### Six architectural refinements (and how they were realized)

| # | Refinement | Realization |
|---|---|---|
| 1 | Real timestamped runtime events | `TimelineRecorder` emits at every stage boundary during execution; `timeline.json` is streamed on every event. Timestamps are real wall-clock deltas — never reconstructed. |
| 2 | Planner organizes only; no NLG | `planner/plan.ts` outputs `NarrationChapter` with `title` + `evidence.facts` + a terse `summary` note. There is deliberately no `text` field. All prose lives in `script/`. |
| 3 | NarrationContext = sole Script input | `loadNarrationContext()` aggregates every artifact into one typed object; `generateScript(ctx, …)` takes nothing else. |
| 4 | TTS fully interchangeable | `TTSProvider` interface + `getTTSProvider()` factory. The pipeline imports only the interface; `EdgeTTSProvider` is selected by `NARRATION_TTS_PROVIDER`. |
| 5 | Pluggable render policies | `RenderPolicy` strategy with `buildInputArgs` + `buildFFmpegArgs`. `DefaultRenderPolicy` ships first; freeze/loop/trim/fade-out add without touching the pipeline. |
| 6 | Module structure preserved | `timeline/ planner/ script/ tts/ render/` as proposed. |

---

## Validation

Both apps were run through the full pipeline (`npm run replayqa -- … --yes`),
which now emits timeline events and runs narration as a final non-fatal stage.

### TodoMVC (Vue SPA, no auth)

- **Discovery:** 5 states, 10 flows.
- **Timeline (real):** discovery @ 2.3s, reasoning @ 10.5s, plan @ 41.9s, execution-passed @ 53.7s.
- **Script source:** LLM-generated.
- **Narration length:** ~112s (slightly above the 60–90s target — see Opportunities).
- **Chapters:** 5 (Discovery, Application Understanding, QA Plan, Test Generation & Execution, Conclusion).
- **Outcome:** `ReplayQA-Summary.mp4` produced; H.264 + AAC; plays correctly.

### SauceDemo (e-commerce, credentialed)

- **Discovery:** 8 states, 6 transitions; authenticated.
- **Timeline (real):** `landing-captured` @ 2.7s, `authenticated` @ 3.9s (post-login URL `/inventory.html` recorded as a verified fact).
- **Script source:** deterministic fallback (the LLM returned empty content for this run — the fallback engaged automatically and produced a fully fact-grounded script).
- **Narration length:** 91.0s (within target).
- **Chapters:** 6 (adds an Authentication chapter because `authenticated`/`login-failed` events were present).
- **Outcome:** `ReplayQA-Summary.mp4` produced; H.264 + AAC; plays correctly.

---

## Narration accuracy (no-hallucination check)

Every claim in both scripts was checked against the source artifacts.

### Fixes applied after the second e2e pass

Two real issues surfaced during re-validation and were fixed:

1. **Markdown leaking into the voice-over.** The script (persisted as markdown
   for human review) was being passed straight to the TTS provider, so the
   voice read "hash hash Discovery" and "asterisk". Fix: `toSpeakableText()`
   (`script/plain-text.ts`) now strips headings, bold/italic, code spans, list
   markers, and links before TTS. The clean prose is persisted to
   `narration.txt` for auditing. Verified: `narration.txt` contains zero `#`,
   `**`, or backtick symbols on both apps.
2. **Inferred capabilities contradicted by blind spots.** The reasoning
   `capabilities` list is the model's *inference*; `missingInformation` states
   what was NOT observed. The initial script asserted "edit" and "delete" as
   supported capabilities, then the Conclusion admitted those controls were
   undetermined — a self-contradiction. Fix: the prompt builder now *withholds*
   any capability whose keyword (edit/delete/persist/auth/…) appears in a blind
   spot, so the LLM never sees the contradicted capability. System-prompt rule #3
   was also strengthened. After the fix, the TodoMVC script lists only the
   observable capabilities (create, read, filter, navigate, toggle,
   bulk-toggle) and the Conclusion honestly notes the delete/edit blind spot.

| Claim (script) | Source artifact | Verified |
|---|---|---|
| TodoMVC: "5 distinct UI states" | `discovery.json` pages.length = 5; planner `facts.stateCount` = 5 | ✅ |
| TodoMVC: "ten functional flows" | `flow-graph.json` edges.length = 10; planner `facts.flowCount` = 10 | ✅ |
| TodoMVC: "single entity, Todo" | `reasoning.json` entities = ["Todo"] | ✅ |
| TodoMVC: confidence 0.85 | `reasoning.json` confidence = 0.85 | ✅ |
| TodoMVC: "TC-001 … passed on the first pass" | `reliability-outcome.json` firstPassSuccess = true, repairsUsed = 0 | ✅ |
| TodoMVC: blind spot about edit/delete | `reasoning.json` missingInformation (verbatim) | ✅ |
| SauceDemo: "8 distinct states, 6 transitions" | `discovery.json` / `flow-graph.json` | ✅ |
| SauceDemo: "authenticated successfully" | timeline `authenticated` event @ 3.9s with `/inventory.html` | ✅ |
| SauceDemo: entities User/Product/CartItem | `reasoning.json` entities | ✅ |
| SauceDemo: "9 test scenarios" | `test-plan.json` functionalScenarios.length | ✅ |

No invented observations, counts, features, or outcomes were found in either
script. The planner only emits verified facts; the script generator's system
prompt forbids invention and instructs omission of unknowns.

---

## Synchronization quality

- **Audio ↔ chapter offsets:** chapter `start` offsets are derived from real
  event timestamps, scaled to the planned 60–90s window. They approximately
  align with the spoken content (within a few seconds).
- **Video ↔ audio:** Playwright browser videos are often much shorter than the
  narration (TodoMVC: 2.2s test → 1.04s video; SauceDemo: 2.1s test → 0.96s
  video). The `DefaultRenderPolicy` **loops the video** to cover the full
  narration and truncates to the audio length, so the summary always matches
  the narration rather than being cut to the raw execution clip. This is the
  correct trade-off for a narrated summary: the audio carries the explanation.
- **HTML report:** the summary is embedded with a chapter list; clicking a
  chapter seeks the `<video>` to its offset.

---

## Total narration duration

| App | Source | Duration | Target |
|---|---|---|---|
| TodoMVC (initial) | LLM | ~112s | 60–90s (over) |
| TodoMVC (after capability-filter fix) | LLM | 97.4s | 60–90s (slightly over) |
| SauceDemo (initial) | fallback | 91.0s | 60–90s (within) |
| SauceDemo (re-validation) | LLM | 95.0s | 60–90s (slightly over) |

The fallback template is tightly bounded and lands within target. The LLM path
runs slightly long; the system prompt asks for 60–90s but does not hard-enforce
it. See Opportunities.

---

## Opportunities for future improvements

1. **Tighten LLM length control.** Add a post-generation length check; if the
   script exceeds the target when spoken (~150 wpm), trim or split chapters and
   re-generate. Alternatively pass an explicit token budget tied to the chapter
   durations the planner already computes.
2. **Richer render policies.** Implement `FreezeLastFramePolicy` (hold the final
   frame instead of looping — less repetitive for short videos) and
   `FadeOutPolicy`. The `RenderPolicy` interface is already in place; these are
   additive.
3. **Subtitle/caption track.** `edge-tts` can emit Word Boundary timestamps;
   burn or embed an `.srt` for accessibility and silent viewing.
4. **Finer-grained discovery events.** Emit `nav-followed` and `probe-skipped`
   events so the timeline (and thus the Discovery chapter) can distinguish
   link-following from action-probing.
5. **Additional TTS providers.** An `OpenAITTSProvider` (via the existing API
   key + `/audio/speech`) and a local Coqui/Piper provider would remove the
   Python dependency for users who already have an LLM key. The
   `TTSProvider` interface + factory make this a one-file addition.
6. **Multi-language narration.** Voice + script language are already
   configurable (`NARRATION_VOICE`, a future `NARRATION_LANG`); wire a language
   switch into the planner/script prompt.
7. **Real per-stage timing in the UI.** The timeline already carries real
   timestamps; surface stage durations (e.g. "reasoning took 7s") in the HTML
   report's timeline panel.

---

## Files

**Created:**
- `src/narration/timeline/{types,recorder,build,index}.ts`
- `src/narration/planner/{types,plan,index}.ts`
- `src/narration/script/{prompt,script,index,plain-text}.ts`
- `src/narration/tts/{provider,edge-tts,index}.ts`
- `src/narration/render/{policy,render,index}.ts`
- `src/narration/audit/{accuracy,visual,index}.ts`
- `src/narration/{types,context,narrate,cli,index}.ts`
- `src/reporter/narration-section.ts`
- `docs/discovery/narration-report.md`

**Modified:**
- `src/discovery/run/orchestrator.ts` — owns the `TimelineRecorder`, emits stage events, runs `narrate()` as a non-fatal final stage.
- `src/discovery/core/{phases,discover}.ts` — `onEvent` hook; emits `landing-captured`, `state-discovered`, `authenticated`/`login-failed`, `flow-discovered`.
- `package.json` — `npm run narrate`.
- `README.md` — milestone, command, prerequisites, outputs.
- `.gitignore` — `.venv/`, `.bin/`.

---

## Constraints honored

- ✅ No video analysis, computer vision, or OCR.
- ✅ Narration built entirely from structured artifacts + the execution timeline.
- ✅ Planner never generates prose; script is the sole NLG boundary.
- ✅ TTS behind an interface; Edge-TTS is one selectable implementation.
- ✅ Render policies are strategies; the pipeline is policy-agnostic.
- ✅ Timeline is a real runtime artifact, streamed during execution.
- ✅ Narration failure never discards prior artifacts (non-fatal stage).
