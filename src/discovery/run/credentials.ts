import type { DiscoveryCredentials } from '../../config/types.js';

/** Environment variable used to pass the username into generated tests. */
export const USERNAME_ENV = 'REPLAYQA_DISCOVERY_USERNAME';

/** Environment variable used to pass the password into generated tests. */
export const PASSWORD_ENV = 'REPLAYQA_DISCOVERY_PASSWORD';

/**
 * Build the environment variables that must be present when a generated test
 * (or its repair pass) is executed, so it can read real credentials instead of
 * inventing fake ones.
 */
export function buildCredentialEnv(
  credentials: DiscoveryCredentials | undefined
): Record<string, string> {
  if (!credentials?.username || !credentials?.password) return {};
  return {
    [USERNAME_ENV]: credentials.username,
    [PASSWORD_ENV]: credentials.password,
  };
}

/**
 * Return the system-prompt lines that tell the LLM how to handle credentials in
 * generated (or repaired) Playwright tests.
 *
 * When credentials are provided, the model must read them from environment
 * variables. When they are absent, it falls back to the original safe fake-data
 * guidance so non-login tests stay deterministic.
 */
export function buildCredentialPromptInstructions(
  credentials: DiscoveryCredentials | undefined
): string[] {
  if (credentials?.username && credentials?.password) {
    return [
      'Use the real credentials provided via environment variables for any login step:',
      `  const username = process.env.${USERNAME_ENV} || '';`,
      `  const password = process.env.${PASSWORD_ENV} || '';`,
      'Fill these into the login form inputs. Do NOT invent fake credentials.',
    ];
  }
  return ['Use safe, deterministic test data (e.g. a clearly fake name/email).'];
}
