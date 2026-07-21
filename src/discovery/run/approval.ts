import * as readline from 'node:readline/promises';

/**
 * Interactive [Y/n] approval gate. Resolves true unless the user explicitly
 * declines (n / no). Used between the QA plan and test generation so a human
 * reviews before any code is generated or executed.
 */
export async function promptApproval(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
