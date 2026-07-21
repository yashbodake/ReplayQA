import type { LoginVerification } from './verify.js';

/**
 * Thrown by Discovery when credentials were supplied but login did not verify.
 * Carries the evidence and tailored suggestions so the CLI can explain why
 * Discovery stopped and what to check — without ever revealing credentials
 * (none are stored on this error).
 */
export class LoginFailedError extends Error {
  readonly evidence: LoginVerification['evidence'];
  readonly suggestions: string[];
  readonly reason: string;

  constructor(verification: LoginVerification) {
    super(verification.reason);
    this.name = 'LoginFailedError';
    this.reason = verification.reason;
    this.evidence = verification.evidence;
    this.suggestions = suggestCauses(verification);
  }
}

/** Suggest likely causes from the observed evidence. */
export function suggestCauses(verification: LoginVerification): string[] {
  const out: string[] = [];
  const e = verification.evidence;

  if (!e.loginFormGone) {
    out.push('The credentials are likely incorrect, or the form rejected the input (still visible after submit).');
  } else if (!verification.success) {
    out.push('The form submitted and disappeared, but no authenticated state was detected — the app may use a non-standard post-login layout ReplayQA did not recognize.');
  }
  out.push('The login may require OAuth/SSO, MFA, or a captcha — ReplayQA supports standard username/password forms only.');
  out.push('The submit button label may not match /sign in|log in|login|submit|continue/i; ReplayQA then presses Enter on the password field.');
  out.push('The page may not have settled after submit (slow network); a retry may help.');

  return out;
}

/** Print a structured, credential-free login-failure report to the console. */
export function reportLoginFailure(error: LoginFailedError): void {
  console.error('\n✗ Login failed — Discovery stopped before exploration.');
  console.error(`\n  Reason: ${error.reason}`);
  console.error('  Evidence:');
  console.error(`    • urlChanged:        ${error.evidence.urlChanged}`);
  console.error(`    • loginFormGone:     ${error.evidence.loginFormGone}`);
  console.error(`    • logoutVisible:     ${error.evidence.logoutVisible}`);
  console.error(`    • userMenuVisible:   ${error.evidence.userMenuVisible}`);
  console.error(`    • dashboardHeading:  ${error.evidence.dashboardHeading}`);
  console.error(`    • heading:           ${JSON.stringify(error.evidence.heading)}`);
  console.error('\n  Possible causes:');
  for (const s of error.suggestions) console.error(`    - ${s}`);
  console.error('\n  Artifacts captured before login (landing state) are preserved under artifacts/discovery/states/.');
}
