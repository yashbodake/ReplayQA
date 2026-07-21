import type { BrowserController } from '../browser/controller.js';
import type { Selector } from '../browser/selector.js';
import type { DiscoveryCredentials } from '../../config/types.js';
import { gatherEvidence, evaluateLogin } from './verify.js';
import type { LoginVerification } from './verify.js';

/**
 * Selectors used to drive a standard login form. Kept here (not in the
 * controller) because they are a login-domain concern, not a browser primitive.
 * The controller resolves them to Playwright locators internally.
 *
 * These are generic (role + label), NOT app-specific. On a login page the first
 * textbox is the username and the first password field is the password.
 */
const USERNAME: Selector = { role: 'textbox' };
const PASSWORD: Selector = 'input[type="password"]';
const SUBMIT: Selector = {
  role: 'button',
  name: /sign in|log in|login|submit|continue/i,
};

/** A login form is considered present if a visible password input exists. */
export async function hasLoginForm(controller: BrowserController): Promise<boolean> {
  return (await controller.currentSnapshot()).hasPassword;
}

/**
 * Perform the login mechanics (fill + submit + wait). Assumes the caller has
 * already confirmed a login form is present via {@link hasLoginForm}. Does NOT
 * decide whether login succeeded — that is {@link loginAndVerify}'s job.
 *
 * Never logs or returns the credentials.
 */
export async function performLogin(
  controller: BrowserController,
  creds: DiscoveryCredentials
): Promise<void> {
  await controller.fill(USERNAME, creds.username).catch(() => undefined);
  await controller.fill(PASSWORD, creds.password);
  const clicked = await controller.click(SUBMIT);
  if (!clicked) {
    await controller.pressEnter(PASSWORD);
  }
  await controller.waitForStable(15000);
}

/**
 * Perform the login, then VERIFY it succeeded using multiple independent
 * signals (URL change, login form removed, logout control, user menu,
 * authenticated heading). ReplayQA never assumes success — see verify.ts.
 */
export async function loginAndVerify(
  controller: BrowserController,
  creds: DiscoveryCredentials
): Promise<LoginVerification> {
  const beforeUrl = controller.currentUrl();
  await performLogin(controller, creds);
  const evidence = await gatherEvidence(controller, beforeUrl);
  return evaluateLogin(evidence);
}
