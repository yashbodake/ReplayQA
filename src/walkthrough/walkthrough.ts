import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BrowserController } from '../discovery/browser/controller.js';
import { hasLoginForm, loginAndVerify } from '../discovery/login/index.js';
import {
  findNextAction,
  isFlowAction,
  isSearchInput,
  pickSearchValue,
  sampleValueFor,
} from './action-selection.js';
import type { DiscoveryCredentials } from '../config/types.js';
import type { ActionCandidate } from '../discovery/browser/selector.js';
import type { RawSnapshot } from '../discovery/models/snapshot.js';

/**
 * The walkthrough recorder — an app-agnostic interactive product demo.
 *
 * Instead of hardcoded steps for a specific app, this recorder:
 *   1. Logs in (if credentials provided)
 *   2. Discovers what's actually on the page (buttons, links, inputs)
 *   3. Interacts with the real features it finds — clicking safe actions,
 *      filling forms, navigating — whatever the app actually has.
 *
 * This works on SauceDemo (Add to cart, cart, checkout) just as well as
 * PhoneBook (Add contact, search, edit) or TodoMVC (add todo, filter, toggle).
 * The recorder adapts to whatever it finds.
 */

export interface WalkthroughOptions {
  targetUrl: string;
  credentials?: DiscoveryCredentials;
  outputDir: string;
  artifactsDir: string;
  headed?: boolean;
  /** Max number of demo steps to perform. Default 8. */
  maxSteps?: number;
}

export interface WalkthroughChapter {
  index: number;
  title: string;
  start: number;
  actions: string[];
  verified: { action: string; observations: string[]; fillSucceeded: boolean }[];
}

export interface WalkthroughResult {
  ok: boolean;
  error?: string;
  videoPath?: string;
  eventsPath: string;
  chaptersPath: string;
  chapters: WalkthroughChapter[];
  authenticated: boolean;
  totalSteps: number;
  performedSteps: number;
}

const PRE_PAUSE = 1500;
const RESULT_HOLD = 2000;
const STEP_DELAY = 800;

export async function recordWalkthrough(options: WalkthroughOptions): Promise<WalkthroughResult> {
  const outDir = resolve(options.outputDir);
  mkdirSync(outDir, { recursive: true });
  const eventsPath = resolve(outDir, 'walkthrough-events.json');
  const chaptersPath = resolve(outDir, 'chapters.json');
  const maxSteps = options.maxSteps ?? 12;

  const result: WalkthroughResult = {
    ok: false, eventsPath, chaptersPath, chapters: [],
    authenticated: false, totalSteps: 0, performedSteps: 0,
  };

  const events: { step: string; action: string; result: string; observations: string[]; timestampMs: number }[] = [];
  const chapters: WalkthroughChapter[] = [];
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const controller = new BrowserController({
    origin: deriveOrigin(options.targetUrl),
    headed: options.headed ?? true,
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
    viewport: { width: 1920, height: 1080 },
  });

  try {
    await controller.open();
    await controller.goto(options.targetUrl, { timeout: 30000 });
    await controller.waitForStable();

    // ── STEP 1: LOGIN ──────────────────────────────────────────────────────
    await sleep(PRE_PAUSE);
    let authenticated = false;
    if (options.credentials && (await hasLoginForm(controller))) {
      const v = await loginAndVerify(controller, options.credentials);
      authenticated = v.success;
      await controller.waitForStable();
    }
    result.authenticated = authenticated;
    await sleep(RESULT_HOLD);
    chapters.push({
      index: 0, title: 'Login', start: 0,
      actions: ['Sign in'],
      verified: [{ action: 'Sign in', observations: authenticated ? ['the user is signed in'] : ['login was attempted'], fillSucceeded: authenticated }],
    });
    events.push({ step: 'login', action: 'Sign in', result: authenticated ? 'performed' : 'error', observations: authenticated ? ['signed in'] : ['login failed'], timestampMs: elapsed() });

    const homeUrl = controller.currentUrl() || options.targetUrl;
    let stepCount = 1; // login was step 1

    // ── STEPS 2+: DISCOVER & INTERACT WITH REAL FEATURES ───────────────────
    // Each "round" = navigate to home, find safe actions, do one, record it.
    const triedActions = new Set<string>();
    let chapterActions: string[] = [];
    let chapterVerified: WalkthroughChapter['verified'] = [];
    let chapterStartMs = elapsed();
    // Repetition guard: track the last observation signature + how many times
    // it repeated. After 2 identical outcomes in a row, stop exploring that
    // action category (prevents clicking 5 products that all do the same thing).
    let lastObsSignature = '';
    let repeatCount = 0;
    let continueFromCurrentPage = false;

    while (stepCount < maxSteps) {
      if (continueFromCurrentPage) {
        await controller.waitForStable(STEP_DELAY);
      } else {
        // Return to home for a clean start.
        await safeGoto(controller, homeUrl);
        await sleep(STEP_DELAY);
      }
      continueFromCurrentPage = false;

      // Discover what's on the page RIGHT NOW.
      const beforeSnap = await controller.currentSnapshot().catch(() => undefined);
      const beforeUrl = controller.currentUrl();
      const actions = await controller.currentActions();

      // Find the next safe, untried action to perform (with repetition guard).
      const candidate = findNextAction(actions, triedActions, lastObsSignature, repeatCount);
      if (!candidate) {
        if (controller.currentUrl() !== homeUrl && stepCount < maxSteps) {
          continueFromCurrentPage = false;
          continue; // next iteration will return home and try again
        }
        break; // nothing left to do
      }

      triedActions.add(candidate.label.toLowerCase());
      await sleep(PRE_PAUSE);

      // Perform the action.
      const actionLabel = candidate.label;
      let performed = false;
      let fillSucceeded = false;
      const observations: string[] = [];

      if (candidate.type === 'input' && isSearchInput(candidate.label)) {
        // It's a search/filter input — type something and press Enter.
        const value = pickSearchValue(beforeSnap, actions);
        try {
          await controller.fill(candidate.selector, value, { timeout: 3000 });
          await sleep(STEP_DELAY);
          await controller.pressEnter(candidate.selector);
          await controller.waitForStable(3000);
          performed = true;
          fillSucceeded = true;
          observations.push(`entered "${value}" into the search field`);
        } catch { /* ignore */ }
      } else {
        // It's a clickable action (button/link/card) — click it.
        const preClickInputs = new Set(actions.filter(a => a.type === 'input').map(a => a.label));
        try {
          const clicked = await controller.click(candidate.selector, { timeout: 4000 });
          if (clicked) {
            performed = true;
            await controller.waitForStable(3000);
            await sleep(STEP_DELAY);

            // If a form opened (new inputs appeared), fill + submit it.
            const newInputs = (await controller.currentActions()).filter(
              a => a.type === 'input' && !preClickInputs.has(a.label)
            );
            if (newInputs.length > 0) {
              const fillResult = await fillAndSubmitForm(controller, newInputs, actionLabel, sleep);
              fillSucceeded = fillResult;
              if (fillResult) observations.push('filled the form and submitted it');
            }
          }
        } catch { /* ignore */ }
      }

      // Capture the after-state and compute observations.
      await sleep(RESULT_HOLD);
      const afterSnap = await controller.currentSnapshot().catch(() => undefined);
      const afterUrl = controller.currentUrl();

      if (performed && beforeSnap && afterSnap) {
        const diffs = computeObservations(beforeSnap, afterSnap);
        if (afterUrl !== beforeUrl) diffs.push('the page navigated');
        observations.push(...diffs);
      }
      if (observations.length === 0 && performed) {
        observations.push('the action was performed');
      }

      // Record the step.
      chapterActions.push(actionLabel);
      chapterVerified.push({ action: actionLabel, observations, fillSucceeded });
      events.push({ step: `step-${stepCount}`, action: actionLabel, result: performed ? 'performed' : 'not-found', observations, timestampMs: elapsed() });
      stepCount++;

      // Update repetition tracking.
      const obsSignature = observations.join(';');
      if (obsSignature === lastObsSignature) {
        repeatCount++;
      } else {
        lastObsSignature = obsSignature;
        repeatCount = 1;
      }

      // If we just performed a flow action (cart, checkout, finish, etc.) and the
      // URL changed, stay on this page next iteration so we can continue the funnel.
      if (performed && afterUrl !== beforeUrl && isFlowAction(actionLabel)) {
        continueFromCurrentPage = true;
      }

      // Flush a chapter every 2-3 actions for natural narration pacing.
      if (chapterActions.length >= 2) {
        chapters.push({
          index: chapters.length,
          title: chapterActions[0],
          start: Math.round(chapterStartMs / 1000),
          actions: chapterActions,
          verified: chapterVerified,
        });
        chapterActions = [];
        chapterVerified = [];
        chapterStartMs = elapsed();
      }
    }

    // Flush remaining.
    if (chapterActions.length > 0) {
      chapters.push({
        index: chapters.length,
        title: chapterActions[0],
        start: Math.round(chapterStartMs / 1000),
        actions: chapterActions,
        verified: chapterVerified,
      });
    }

    writeFileSync(eventsPath, JSON.stringify(events, null, 2) + '\n', 'utf-8');
    writeFileSync(chaptersPath, JSON.stringify(chapters, null, 2) + '\n', 'utf-8');

    const videoPath = await controller.videoPath();
    await controller.close();

    result.ok = true;
    result.videoPath = videoPath;
    result.chapters = chapters;
    result.totalSteps = events.length;
    result.performedSteps = events.filter(e => e.result === 'performed').length;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      writeFileSync(eventsPath, JSON.stringify(events, null, 2) + '\n', 'utf-8');
      writeFileSync(chaptersPath, JSON.stringify(chapters, null, 2) + '\n', 'utf-8');
    } catch { /* ignore */ }
    await controller.close().catch(() => undefined);
    result.error = message;
    return result;
  }
}

// ── Action discovery ────────────────────────────────────────────────────────

/**
 * Fill a form's inputs with realistic values and submit it.
 * Returns true if at least one field was filled.
 */
async function fillAndSubmitForm(
  controller: BrowserController,
  inputs: ActionCandidate[],
  triggerAction: string,
  sleep: (ms: number) => Promise<void>
): Promise<boolean> {
  let anyFilled = false;
  for (const input of inputs.slice(0, 4)) {
    const value = sampleValueFor(input.label, triggerAction);
    if (!value) continue;
    try {
      await controller.fill(input.selector, value, { timeout: 2500 });
      anyFilled = true;
      await sleep(300);
    } catch { /* skip */ }
  }
  if (!anyFilled) return false;

  // Find and click the submit button.
  const actions = await controller.currentActions().catch(() => []);
  const submit = actions.find(a =>
    a.type === 'button' &&
    !a.label.toLowerCase().includes(triggerAction.toLowerCase()) &&
    /^(save|create|submit|add|checkout|continue|login|sign)/i.test(a.label.trim()) &&
    !/^(cancel|close|back)$/i.test(a.label.trim())
  );
  if (submit) {
    try {
      await controller.click(submit.selector, { timeout: 3000 });
      await controller.waitForStable(3000);
    } catch { /* ignore */ }
  }
  return anyFilled;
}

/** Compute human-readable observations from a before/after snapshot diff. */
function computeObservations(before: RawSnapshot, after: RawSnapshot): string[] {
  const obs: string[] = [];
  if (after.forms.length > before.forms.length) obs.push('a form opened');
  else if (after.forms.length < before.forms.length) obs.push('the form closed');

  const beforeBtns = new Set(before.buttons);
  const newBtns = after.buttons.filter(b => !beforeBtns.has(b)).slice(0, 3);
  for (const b of newBtns) obs.push(`a "${b}" button appeared`);

  if (after.heading && after.heading !== before.heading) {
    obs.push(`the heading changed to "${after.heading}"`);
  }

  // List/item count change.
  const beforeItems = before.buttons.filter(b => /\d{3,}|@/.test(b)).length;
  const afterItems = after.buttons.filter(b => /\d{3,}|@/.test(b)).length;
  if (afterItems > beforeItems) obs.push(`items were added to the list`);
  else if (afterItems < beforeItems && afterItems > 0) obs.push(`the list changed`);

  return obs;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function safeGoto(controller: BrowserController, url: string): Promise<void> {
  try {
    await controller.goto(url, { timeout: 20000 });
    await controller.waitForStable(3000);
  } catch { /* best-effort */ }
}

function deriveOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}
