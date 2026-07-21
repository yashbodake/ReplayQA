import type { BrowserController } from '../browser/controller.js';

/**
 * Login verification — ReplayQA never assumes login succeeded. After the
 * credentials are submitted, it gathers multiple independent signals and
 * requires the login form to be GONE plus at least one corroboration.
 */

export interface LoginEvidence {
  /** Absolute URL after the submit (vs the pre-login URL). */
  currentUrl: string;
  /** True if the URL changed between pre-submit and now. */
  urlChanged: boolean;
  /** True if no visible password field remains (the login form went away). */
  loginFormGone: boolean;
  /** True if a logout / sign-out control is now visible. */
  logoutVisible: boolean;
  /** True if a user/account/profile menu or avatar is now visible. */
  userMenuVisible: boolean;
  /** True if the page heading looks like an authenticated landing. */
  dashboardHeading: boolean;
  /** The heading observed (for the failure report). */
  heading: string;
}

export interface LoginVerification {
  success: boolean;
  evidence: LoginEvidence;
  /** Human-readable reason for the success/failure verdict. */
  reason: string;
}

const LOGOUT_RE = /log\s*out|sign\s*out|signout|logout/i;
const USER_MENU_RE = /\b(account|profile|user|avatar|settings|preferences)\b|hi\s|hello\s|@/i;
// A heading that suggests an authenticated landing (NOT a bare "welcome back"
// login heading). Requires the login form to already be gone.
const DASHBOARD_HEADING_RE = /^(dashboard|^my\s|inbox|overview|home|contacts|todos|users|products|items|entries)/i;

/** Gather post-login evidence via the controller (no raw logs, no credentials). */
export async function gatherEvidence(
  controller: BrowserController,
  beforeUrl: string
): Promise<LoginEvidence> {
  const currentUrl = controller.currentUrl();
  const snapshot = await controller.currentSnapshot();
  const loginFormGone = !snapshot.hasPassword;

  let actionLabels: string[] = [];
  try {
    actionLabels = (await controller.currentActions()).map((a) => a.label);
  } catch {
    /* best-effort */
  }
  let linkLabels: string[] = [];
  try {
    linkLabels = (await controller.currentNavLinks()).map((l) => l.text);
  } catch {
    /* best-effort */
  }
  const labels = [...actionLabels, ...linkLabels];

  const logoutVisible = labels.some((l) => LOGOUT_RE.test(l));
  const userMenuVisible = labels.some((l) => USER_MENU_RE.test(l));
  const dashboardHeading =
    loginFormGone && DASHBOARD_HEADING_RE.test(snapshot.heading.trim());
  const urlChanged = !sameUrl(currentUrl, beforeUrl);

  return {
    currentUrl,
    urlChanged,
    loginFormGone,
    logoutVisible,
    userMenuVisible,
    dashboardHeading,
    heading: snapshot.heading,
  };
}

/**
 * Decide whether login succeeded. Requires `loginFormGone` AND at least one
 * corroboration (URL change, logout control, user menu, or dashboard heading).
 * A disappeared form with no corroboration is treated as a FAILURE — ReplayQA
 * does not assume success.
 */
export function evaluateLogin(evidence: LoginEvidence): LoginVerification {
  const corroborations: string[] = [];
  if (evidence.urlChanged) corroborations.push('URL changed');
  if (evidence.logoutVisible) corroborations.push('logout control visible');
  if (evidence.userMenuVisible) corroborations.push('user menu visible');
  if (evidence.dashboardHeading) corroborations.push('authenticated heading');

  if (evidence.loginFormGone && corroborations.length >= 1) {
    return {
      success: true,
      evidence,
      reason: `login form removed; corroborations: ${corroborations.join(', ')}`,
    };
  }

  const reasons: string[] = [];
  if (!evidence.loginFormGone) {
    reasons.push('login form is still visible after submit');
  } else {
    reasons.push(
      'login form disappeared but no authenticated signal was observed (no URL change, logout control, user menu, or dashboard heading)'
    );
  }
  return { success: false, evidence, reason: reasons.join('; ') };
}

function sameUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin + ua.pathname + ua.search + ua.hash === ub.origin + ub.pathname + ub.search + ub.hash;
  } catch {
    return a === b;
  }
}
