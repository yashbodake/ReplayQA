import type { NarrationChapter, ChapterEvidence } from '../planner/types.js';
import type { NarrationContext } from '../types.js';

/**
 * The single source of narration wording rules (Refinement #2: the script
 * module is the ONLY place narration prose is produced).
 *
 * The system prompt is deliberately strict about factual grounding: the model
 * may only rephrase facts it is given, never invent them. This is how we keep
 * the "no hallucinated facts" success criterion enforceable.
 */
export const NARRATION_SYSTEM_PROMPT = [
  'You are a senior QA engineer narrating a ReplayQA run for someone who has never seen it.',
  'Speak ONLY from the verified facts and chapter evidence provided in the user message.',
  'Rules — follow all of them:',
  '1. Never invent observations, counts, features, page names, or outcomes.',
  '2. If a fact is unknown or absent, omit it entirely. Do not speculate.',
  '3. The "capabilities" list is the model’s INFERENCE, not an observation. If a "Known blind spot" says a capability could not be determined (e.g. edit, delete), you MUST NOT present that capability as supported. Either omit it or, at most, acknowledge the uncertainty in the Conclusion.',
  '4. Counts and confidence values must be stated EXACTLY as given — do not round or change them.',
  '5. Do not mention ReplayQA internals (LLMs, prompts, hashes, probes). Speak about the application and the test.',
  '6. Output exactly one short paragraph per chapter, in chapter order.',
  '7. Prefix each paragraph with a markdown heading: "## <Chapter Title>".',
  '8. Target 60–90 seconds when read aloud at a calm pace. Be concise — do not pad.',
  '9. Tone: professional, confident, calm — like a senior QA engineer presenting results.',
].join('\n');

/**
 * Build the user message: the chapters (titles + verified facts + the planner's
 * terse factual summary) plus a compact slice of NarrationContext the model may
 * reference. No raw DOM, no video, no internal ReplayQA detail.
 */
export function buildUserMessage(ctx: NarrationContext, chapters: readonly NarrationChapter[]): string {
  const lines: string[] = [];
  lines.push('Narrate the following ReplayQA run. Use ONLY these facts.');
  lines.push('');
  lines.push('APPLICATION:');
  lines.push(`- Target URL: ${ctx.targetUrl || '(unknown)'}`);
  if (ctx.reasoning?.applicationType) lines.push(`- Application type: ${ctx.reasoning.applicationType}`);
  if (ctx.reasoning?.entities?.length) lines.push(`- Entities: ${ctx.reasoning.entities.join(', ')}`);
  if (ctx.reasoning?.capabilities?.length) {
    // Filter OUT any capability whose keyword is flagged as undetermined in a
    // blind spot. The reasoning "capabilities" list is the model's inference;
    // "missingInformation" is what ReplayQA actually could NOT observe. Narrating
    // an inferred capability that a blind spot contradicts would be a
    // self-contradiction, so we withhold the contradicted capability from the
    // prompt entirely rather than trusting the LLM to suppress it.
    const blind = (ctx.reasoning.missingInformation ?? []).join(' ').toLowerCase();
    const safe = ctx.reasoning.capabilities.filter((cap) => {
      const c = cap.toLowerCase();
      // If a blind spot mentions edit/delete/persist/auth and this capability
      // asserts it, drop the capability.
      const contradictedKeywords = ['edit', 'delete', 'remov', 'persist', 'storag', 'auth', 'login', 'user'];
      return !contradictedKeywords.some((kw) => c.includes(kw) && blind.includes(kw));
    });
    if (safe.length) lines.push(`- Capabilities: ${safe.slice(0, 6).join('; ')}`);
  }
  if (typeof ctx.reasoning?.confidence === 'number') {
    lines.push(`- Understanding confidence: ${ctx.reasoning.confidence.toFixed(2)}`);
  }
  lines.push('');
  lines.push('CHAPTERS (narrate one paragraph each, in this order):');
  for (const ch of chapters) {
    lines.push('');
    lines.push(`### ${ch.title}`);
    lines.push(`- Planner fact note: ${ch.evidence.summary}`);
    lines.push(`- Verified facts: ${renderFacts(ch.evidence)}`);
  }
  if (ctx.reasoning?.missingInformation?.length) {
    lines.push('');
    lines.push('KNOWN BLIND SPOTS (you may acknowledge at most one, verbatim, only in the Conclusion):');
    for (const m of ctx.reasoning.missingInformation.slice(0, 2)) lines.push(`- ${m}`);
  }
  return lines.join('\n');
}

function renderFacts(evidence: ChapterEvidence): string {
  const entries = Object.entries(evidence.facts);
  if (entries.length === 0) return '(none)';
  return entries
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}=[${v.slice(0, 4).join(', ')}${v.length > 4 ? ', …' : ''}]`;
      if (typeof v === 'string') return `${k}="${v}"`;
      return `${k}=${String(v)}`;
    })
    .join('; ');
}
