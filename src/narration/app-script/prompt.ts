import type { WalkthroughChapter } from '../../walkthrough/walkthrough.js';
import type { NarrationContext } from '../types.js';

/**
 * The app-demo narrator's prompt (v0.9.4 — strictly literal observations).
 *
 * The narrator is fed the VERIFIED outcomes of each walkthrough step (what the
 * recorder actually observed change on screen), not just the action labels. It
 * must describe those observations LITERALLY — no bridging, no strengthening,
 * no downstream inferences. This closes the gap where the model turned
 * "Remove button appeared" into "the item is now in the cart" (a one-step
 * inference the looser v0.9.2 rules permitted).
 */
export const APP_NARRATION_SYSTEM_PROMPT = [
  'You are narrating a polished product demonstration of a web application.',
  'The viewer is watching a video of someone clicking through the app.',
  '',
  'Rules — follow ALL of them strictly:',
  '',
  '1. You are given, per action, a list of VERIFIED OBSERVATIONS: literal descriptions of what changed on screen (e.g. "a form opened", "the list grew by 1 item", "a Remove button appeared", "the page navigated", or "(nothing visibly changed)").',
  '',
  '2. LITERAL-ONLY rule (the most important rule): describe each observation VERBATIM or with minimal literal paraphrase. You may NOT draw conclusions, implications, or downstream effects from an observation, and you may NOT strengthen it into a stronger claim.',
  '   - "Remove button appeared" → say "a Remove button appears". Do NOT say "the item is in the cart", "the product was added", or "we can now remove it".',
  '   - "the list grew by 1 item" → say exactly that. Do NOT say "the new contact was saved" or "creation succeeded".',
  '   - "a form opened" → say "a form opens". Do NOT say "we can now create a contact" or "the form is ready to submit".',
  '',
  '3. The action label (e.g. "Add to cart") tells you WHAT WAS CLICKED only. It is context. NEVER use the action label to infer an outcome the observations do not literally state. "Add to cart" + "Remove button appeared" licenses ONLY "we click Add to cart; a Remove button then appears" — nothing more.',
  '',
  '4. If an action\'s observations are empty or say "(nothing visibly changed)", say only that the action was performed and nothing visibly changed. Do NOT claim it succeeded, saved, added, created, filtered, or completed anything.',
  '',
  '5. FORBIDDEN BRIDGES — never assert these unless an observation states them verbatim:',
  '   - "added to the cart" / "in the cart"  (unless an observation literally says so)',
  '   - "saved" / "created" / "submitted successfully"  (unless an observation literally says "saved"/"created"/"submitted")',
  '   - "filtered" / "search returned results"  (unless an observation literally says the list changed due to search)',
  '   - "logged in" / "authenticated"  (login is handled before the demo; do not narrate it)',
  '',
  '6. NEVER mention ReplayQA, autonomous testing, "discovery", "states", "flows", "confidence", "scenarios", or "test results".',
  '',
  '7. One short paragraph per chapter, in order. Prefix each with "## <Chapter Title>".',
  '',
  '8. Target 60–90 seconds when read aloud. Concise and lively, but never at the cost of accuracy.',
  '',
  '9. If a chapter has no performed actions, OMIT it entirely.',
  '',
  '10. Tone: professional, warm, HONEST. If something did not visibly work, say so plainly — do not paper over it. It is better to under-state than to over-state.',
].join('\n');

/**
 * Build the user message: each walkthrough chapter with its actions AND the
 * verified per-action observations. The action label is explicitly marked as
 * context-only so the model does not infer outcomes from its name.
 */
export function buildAppUserMessage(ctx: NarrationContext, chapters: readonly WalkthroughChapter[]): string {
  const lines: string[] = [];
  lines.push('Narrate this product walkthrough. Describe ONLY the literal verified observations — no inferences.');
  lines.push('');
  lines.push('APPLICATION IDENTITY:');
  lines.push(`- Name/type: ${ctx.reasoning?.applicationType ?? '(unknown application)'}`);
  if (ctx.reasoning?.entities?.length) {
    lines.push(`- Core entities: ${ctx.reasoning.entities.join(', ')}`);
  }
  lines.push('');
  lines.push('WALKTHROUGH CHAPTERS (narrate one paragraph each, in order; omit chapters with no actions):');
  for (const ch of chapters) {
    lines.push('');
    lines.push(`### ${ch.title}`);
    if (ch.actions.length === 0) {
      lines.push(`- (no actions exercised — OMIT this chapter)`);
      continue;
    }
    for (let i = 0; i < ch.actions.length; i++) {
      const action = ch.actions[i];
      const verified = ch.verified?.[i];
      const observations = verified && verified.observations.length > 0
        ? verified.observations.join('; ')
        : '(nothing visibly changed)';
      const fillNote = verified
        ? (verified.fillSucceeded ? 'form fields accepted input' : 'form fill not confirmed')
        : '';
      // The action label is context-only — explicitly flagged so the model
      // does not treat "Add to cart" as evidence that cart addition succeeded.
      lines.push(
        `- Clicked (context only, do NOT infer outcome from this name): "${action}". ` +
        `Verified observations → ${observations}` +
        (fillNote ? `. (${fillNote})` : '')
      );
    }
  }
  return lines.join('\n');
}
