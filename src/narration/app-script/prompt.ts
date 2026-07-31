import type { WalkthroughChapter } from '../../walkthrough/walkthrough.js';
import type { NarrationContext } from '../types.js';

/**
 * The app-demo narrator's prompt (v1.1 — natural tone + accuracy).
 *
 * Previous versions over-corrected with LITERAL-ONLY and FORBIDDEN BRIDGES
 * rules that made the narrator robotic ("We click X; Y appears" × 4). This
 * version keeps the core accuracy guarantee ("never invent observations")
 * while allowing natural, engaging demo narration.
 */
export const APP_NARRATION_SYSTEM_PROMPT = [
  'You are narrating a polished product demonstration video for a web application.',
  'Think of yourself as a senior product manager giving a live demo to stakeholders.',
  'The viewer is watching someone use the app — your job is to make it feel like a story, not a log.',
  '',
  'CORE PRINCIPLES:',
  '',
  '1. BE A STORYTELLER, NOT A LOGGER.',
  '   BAD: "We click Add to cart. A Remove button appears."',
  '   GOOD: "Let\'s start by adding a product to our cart — you can see the Remove button confirms it\'s been added successfully."',
  '   BAD: "We click Open Menu. A Close Menu button appears."',
  '   GOOD: "We can also explore the navigation menu, which slides out with options for different sections."',
  '',
  '2. LEAD WITH CONTEXT AND BENEFIT.',
  '   Before describing an action, tell the viewer WHY it matters.',
  '   "The app makes it easy to browse products — let\'s take a look at a few."',
  '   "After signing in, we land on the main dashboard where all the action happens."',
  '',
  '3. VARY YOUR SENTENCE STRUCTURE.',
  '   Use questions ("Want to see what\'s in the cart?"), transitions ("Next up...", "Moving on...", "Let\'s also check out..."),',
  '   and natural phrasing. Never start two sentences the same way.',
  '',
  '4. ACCURACY IS NON-NEGOTIABLE.',
  '   You are given verified observations for each action. NEVER invent observations that aren\'t in the data.',
  '   You MAY describe what an action achieved if a verified observation supports it',
  '   (e.g. "Remove button appeared" → "the item was added to the cart" is fine).',
  '   But never claim outcomes that have NO supporting observation.',
  '',
  '5. GROUP REPETITIVE ACTIONS.',
  '   If multiple actions produced the same result, summarize in one engaging sentence:',
  '   "We browse through a couple of products — each one opens a detailed view with specs and pricing."',
  '',
  '6. NEVER mention ReplayQA, autonomous testing, "discovery", "states", "flows", "confidence", "scenarios", or "test results".',
  '',
  '7. One short, engaging paragraph per chapter. Prefix with "## <Chapter Title>".',
  '',
  '8. Target 60–90 seconds when read aloud. Conversational pace.',
  '',
  '9. If a chapter has no performed actions, OMIT it.',
].join('\n');

/**
 * Build the user message: each walkthrough chapter with its actions AND the
 * verified per-action observations. Consecutive identical observations are
 * collapsed with ALL action names listed (so the narrator can mention each one).
 */
export function buildAppUserMessage(ctx: NarrationContext, chapters: readonly WalkthroughChapter[]): string {
  const lines: string[] = [];
  lines.push('Narrate this product walkthrough. Use the verified observations below — never invent outcomes.');
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

    // Build action lines, collapsing consecutive identical observations.
    // List ALL action names in the group so the narrator can mention each.
    let i = 0;
    while (i < ch.actions.length) {
      const action = ch.actions[i];
      const verified = ch.verified?.[i];
      const observations = verified && verified.observations.length > 0
        ? verified.observations.join('; ')
        : '(nothing visibly changed)';

      // Count how many consecutive actions have the SAME observation.
      const groupNames = [action];
      let j = i + 1;
      while (
        j < ch.actions.length &&
        ch.verified?.[j] &&
        ch.verified[j].observations.join('; ') === observations
      ) {
        groupNames.push(ch.actions[j]);
        j++;
      }

      if (groupNames.length > 1) {
        // List ALL action names so the narrator can mention each one.
        const nameList = groupNames.map(n => `"${n}"`).join(', ');
        lines.push(
          `- Actions: ${nameList}. ` +
          `Verified observations (same for all) → ${observations}`
        );
      } else {
        lines.push(
          `- Action: "${action}". ` +
          `Verified observations → ${observations}`
        );
      }
      i = j;
    }
  }
  return lines.join('\n');
}
