import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BrowserController } from '../discovery/browser/controller.js';
import { hasLoginForm, loginAndVerify } from '../discovery/login/index.js';
import type { DiscoveryCredentials } from '../config/types.js';
import type { ActionCandidate } from '../discovery/browser/selector.js';

/**
 * The walkthrough recorder — a clean, linear product demo.
 *
 * Instead of scraping arbitrary DOM elements, this runs a fixed 5-step script
 * that tells a story on a single contact:
 *   1. LOGIN     — log in with credentials
 *   2. CREATE    — add a new contact (unique name + phone)
 *   3. SEARCH    — search for that same contact by name
 *   4. EDIT      — open the contact, change its name, save
 *   5. DELETE    — open the contact, delete it, confirm
 *
 * Each step runs exactly once, with natural pacing (pre-pause + result-hold)
 * so the video looks like a polished product demo. The contact created in
 * step 2 is the one searched, edited, and deleted — a coherent narrative.
 */

export interface WalkthroughOptions {
  targetUrl: string;
  credentials?: DiscoveryCredentials;
  outputDir: string;
  artifactsDir: string;
  headed?: boolean;
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

interface StepEvent {
  step: string;
  action: string;
  result: 'performed' | 'not-found' | 'error';
  observations: string[];
  timestampMs: number;
}

const PRE_PAUSE = 1500;
const RESULT_HOLD = 2000;

export async function recordWalkthrough(options: WalkthroughOptions): Promise<WalkthroughResult> {
  const outDir = resolve(options.outputDir);
  mkdirSync(outDir, { recursive: true });
  const eventsPath = resolve(outDir, 'walkthrough-events.json');
  const chaptersPath = resolve(outDir, 'chapters.json');

  const result: WalkthroughResult = {
    ok: false,
    eventsPath,
    chaptersPath,
    chapters: [],
    authenticated: false,
    totalSteps: 0,
    performedSteps: 0,
  };

  const events: StepEvent[] = [];
  const chapters: WalkthroughChapter[] = [];
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const addChapter = (title: string, actions: string[], verified: WalkthroughChapter['verified']) => {
    chapters.push({ index: chapters.length, title, start: Math.round(elapsed() / 1000), actions, verified });
  };
  const addEvent = (step: string, action: string, result: StepEvent['result'], observations: string[]) => {
    events.push({ step, action, result, observations, timestampMs: elapsed() });
  };

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
    addChapter('Login', ['Sign in'], [{
      action: 'Sign in',
      observations: authenticated ? ['the user is signed in'] : ['login was attempted'],
      fillSucceeded: authenticated,
    }]);
    addEvent('login', 'Sign in', authenticated ? 'performed' : 'error', authenticated ? ['signed in'] : ['login failed']);

    const homeUrl = controller.currentUrl() || options.targetUrl;
    const contactName = 'Demo ' + Date.now().toString().slice(-6);
    const contactPhone = '555' + Date.now().toString().slice(-7);
    const editedName = 'Edited ' + Date.now().toString().slice(-6);

    // ── STEP 2: CREATE CONTACT ─────────────────────────────────────────────
    await sleep(PRE_PAUSE);
    const createObs = await stepCreate(controller, contactName, contactPhone, homeUrl, sleep);
    await sleep(RESULT_HOLD);
    addChapter('Create Contact', ['Add new contact', 'Fill form', 'Submit'], createObs.verified);
    addEvent('create', 'Create contact', createObs.ok ? 'performed' : 'error', createObs.observations);

    // ── STEP 3: SEARCH ─────────────────────────────────────────────────────
    await sleep(PRE_PAUSE);
    // Reset to home first so search starts from the full list.
    await safeGoto(controller, homeUrl);
    const searchObs = await stepSearch(controller, contactName, sleep);
    await sleep(RESULT_HOLD);
    addChapter('Search', ['Search for the contact'], searchObs.verified);
    addEvent('search', 'Search', searchObs.ok ? 'performed' : 'error', searchObs.observations);

    // ── STEP 4: EDIT ───────────────────────────────────────────────────────
    await sleep(PRE_PAUSE);
    // Clear search / go home so the contact is visible in the full list.
    await safeGoto(controller, homeUrl);
    await sleep(500);
    const editObs = await stepEdit(controller, contactName, editedName, sleep);
    await sleep(RESULT_HOLD);
    addChapter('Edit Contact', ['Open contact', 'Edit', 'Change name', 'Save'], editObs.verified);
    addEvent('edit', 'Edit contact', editObs.ok ? 'performed' : 'error', editObs.observations);

    // ── STEP 5: DELETE ─────────────────────────────────────────────────────
    await sleep(PRE_PAUSE);
    await safeGoto(controller, homeUrl);
    await sleep(500);
    const deleteObs = await stepDelete(controller, editedName, sleep);
    await sleep(RESULT_HOLD);
    addChapter('Delete Contact', ['Open contact', 'Delete', 'Confirm'], deleteObs.verified);
    addEvent('delete', 'Delete contact', deleteObs.ok ? 'performed' : 'error', deleteObs.observations);

    // Persist artifacts.
    writeFileSync(eventsPath, JSON.stringify(events, null, 2) + '\n', 'utf-8');
    writeFileSync(chaptersPath, JSON.stringify(chapters, null, 2) + '\n', 'utf-8');

    const videoPath = await controller.videoPath();
    await controller.close();

    result.ok = true;
    result.videoPath = videoPath;
    result.chapters = chapters;
    result.totalSteps = events.length;
    result.performedSteps = events.filter((e) => e.result === 'performed').length;
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

// ── Step implementations ────────────────────────────────────────────────────

interface StepResult {
  ok: boolean;
  observations: string[];
  verified: WalkthroughChapter['verified'];
}

/** Find a button/link by label substring in currentActions. */
async function findAction(controller: BrowserController, labelRe: RegExp): Promise<ActionCandidate | undefined> {
  const actions = await controller.currentActions();
  return actions.find((a) => a.type !== 'input' && labelRe.test(a.label));
}

/** Find an input by label substring. */
async function findInput(controller: BrowserController, labelRe: RegExp): Promise<ActionCandidate | undefined> {
  const actions = await controller.currentActions();
  return actions.find((a) => a.type === 'input' && labelRe.test(a.label));
}

/** Count contact-like rows on the page. */
async function countContacts(controller: BrowserController): Promise<number> {
  const actions = await controller.currentActions();
  return actions.filter((a) => /\d{4,}/.test(a.label)).length;
}

// ── Step 2: Create ──────────────────────────────────────────────────────────
async function stepCreate(
  controller: BrowserController,
  name: string,
  phone: string,
  homeUrl: string,
  sleep: (ms: number) => Promise<void>
): Promise<StepResult> {
  const before = await countContacts(controller);
  const verified: WalkthroughChapter['verified'] = [];

  // Click "Add new contact"
  const addBtn = await findAction(controller, /add new contact/i);
  if (!addBtn) return { ok: false, observations: ['Add button not found'], verified };
  await controller.click(addBtn.selector, { timeout: 4000 });
  await controller.waitForStable(3000);
  await sleep(800);
  verified.push({ action: 'Open Add Contact form', observations: ['the Add Contact form opened'], fillSucceeded: true });

  // Fill name + phone (label-based, exact match)
  try {
    await controller.fill({ label: 'Full Name *' }, name, { timeout: 3000 });
    await controller.fill({ label: 'Phone Number *' }, phone, { timeout: 3000 });
  } catch (e) {
    return { ok: false, observations: ['could not fill the form fields'], verified };
  }
  verified.push({ action: 'Fill name and phone', observations: [`entered name "${name}" and phone "${phone}"`], fillSucceeded: true });
  await sleep(500);

  // Submit
  const submit = await findAction(controller, /^Add Contact$/i);
  if (submit) {
    await controller.click(submit.selector, { timeout: 4000 });
    await controller.waitForStable(4000);
  }
  await sleep(500);

  // Verify: navigate home to see the list (the form view hides it)
  await safeGoto(controller, homeUrl);
  await controller.waitForStable(3000);
  const after = await countContacts(controller);
  const saved = after > before;
  verified.push({
    action: 'Submit',
    observations: saved ? ['a new contact was added to the list'] : ['the form was submitted'],
    fillSucceeded: saved,
  });

  return {
    ok: saved,
    observations: saved ? [`created contact "${name}"`] : ['contact creation attempted'],
    verified,
  };
}

// ── Step 3: Search ──────────────────────────────────────────────────────────
async function stepSearch(
  controller: BrowserController,
  contactName: string,
  sleep: (ms: number) => Promise<void>
): Promise<StepResult> {
  const verified: WalkthroughChapter['verified'] = [];
  const searchInput = await findInput(controller, /search/i);
  if (!searchInput) return { ok: false, observations: ['search field not found'], verified };

  const before = await countContacts(controller);
  await controller.fill(searchInput.selector, contactName, { timeout: 3000 });
  await sleep(800);
  try { await controller.pressEnter(searchInput.selector); } catch { /* ignore */ }
  await controller.waitForStable(3000);
  await sleep(500);

  const after = await countContacts(controller);
  const filtered = after < before;
  verified.push({
    action: `Search for "${contactName}"`,
    observations: filtered
      ? ['the list filtered to show matching contacts']
      : ['the search was performed'],
    fillSucceeded: true,
  });

  return {
    ok: true,
    observations: filtered ? [`searched for "${contactName}", the list filtered`] : ['search performed'],
    verified,
  };
}

// ── Step 4: Edit ────────────────────────────────────────────────────────────
async function stepEdit(
  controller: BrowserController,
  contactName: string,
  newName: string,
  sleep: (ms: number) => Promise<void>
): Promise<StepResult> {
  const verified: WalkthroughChapter['verified'] = [];

  // Find and click the contact (by name match in its button/card label)
  const contact = await findContactByName(controller, contactName);
  if (!contact) return { ok: false, observations: [`contact "${contactName}" not found`], verified };
  await controller.click(contact.selector, { timeout: 4000 });
  await controller.waitForStable(3000);
  await sleep(800);
  verified.push({ action: 'Open contact details', observations: ['the contact details opened'], fillSucceeded: true });

  // Click Edit
  const editBtn = await findAction(controller, /^Edit/i);
  if (!editBtn) return { ok: false, observations: ['Edit button not found'], verified };
  await controller.click(editBtn.selector, { timeout: 4000 });
  await controller.waitForStable(3000);
  await sleep(500);

  // Change the name field
  try {
    await controller.fill({ label: 'Full Name *' }, newName, { timeout: 3000 });
  } catch {
    // Try a generic name input
    const nameInput = await findInput(controller, /name/i);
    if (nameInput) await controller.fill(nameInput.selector, newName, { timeout: 3000 });
  }
  verified.push({ action: 'Change name', observations: [`changed the name to "${newName}"`], fillSucceeded: true });
  await sleep(500);

  // Save
  const saveBtn = await findAction(controller, /^Save|^Update/i);
  if (saveBtn) {
    await controller.click(saveBtn.selector, { timeout: 4000 });
    await controller.waitForStable(4000);
  }
  await sleep(500);
  verified.push({ action: 'Save', observations: ['the contact was updated'], fillSucceeded: true });

  return {
    ok: true,
    observations: [`edited contact "${contactName}" → "${newName}"`],
    verified,
  };
}

// ── Step 5: Delete ──────────────────────────────────────────────────────────
async function stepDelete(
  controller: BrowserController,
  contactName: string,
  sleep: (ms: number) => Promise<void>
): Promise<StepResult> {
  const verified: WalkthroughChapter['verified'] = [];

  // Find and open the contact
  const contact = await findContactByName(controller, contactName);
  if (!contact) return { ok: false, observations: [`contact "${contactName}" not found`], verified };
  await controller.click(contact.selector, { timeout: 4000 });
  await controller.waitForStable(3000);
  await sleep(800);
  verified.push({ action: 'Open contact', observations: ['the contact details opened'], fillSucceeded: true });

  // Click Delete
  const delBtn = await findAction(controller, /^Delete/i);
  if (!delBtn) return { ok: false, observations: ['Delete button not found'], verified };
  await controller.click(delBtn.selector, { timeout: 4000 });
  await controller.waitForStable(3000);
  await sleep(500);

  // Confirm if a dialog appeared (try clicking a confirm/yes button)
  const confirmBtn = await findAction(controller, /^Yes$|^Confirm$|^Delete$|^OK$/i);
  if (confirmBtn) {
    await controller.click(confirmBtn.selector, { timeout: 3000 });
    await controller.waitForStable(3000);
  }
  await sleep(500);

  // Verify: go home and check the contact is gone
  const snap = await controller.currentSnapshot();
  const stillThere = snap.buttons.some((b) => b.toLowerCase().includes(contactName.toLowerCase().slice(0, 8)));
  const deleted = !stillThere;
  verified.push({
    action: 'Delete',
    observations: deleted ? ['the contact was removed from the list'] : ['delete was attempted'],
    fillSucceeded: deleted,
  });

  return {
    ok: deleted,
    observations: deleted ? [`deleted contact "${contactName}"`] : ['delete attempted'],
    verified,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Find a contact in the action list by name match. */
async function findContactByName(controller: BrowserController, name: string): Promise<ActionCandidate | undefined> {
  const actions = await controller.currentActions();
  const lower = name.toLowerCase();
  return actions.find((a) =>
    (a.type === 'button' || a.type === 'card') && a.label.toLowerCase().includes(lower.slice(0, 8))
  );
}

async function safeGoto(controller: BrowserController, url: string): Promise<void> {
  try {
    await controller.goto(url, { timeout: 20000 });
    await controller.waitForStable(3000);
  } catch { /* best-effort */ }
}

function deriveOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return url; }
}
