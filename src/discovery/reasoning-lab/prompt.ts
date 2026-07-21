import type { Observations } from './collect.js';

/**
 * Build the chat messages for the LLM. The user message is the observations
 * JSON verbatim — no handcrafted explanation, no hidden assumptions. The
 * system message fixes the output contract and stresses the most important
 * field: `missingInformation`.
 */
export function buildPrompt(observations: Observations): {
  system: string;
  user: string;
} {
  const system = [
    'You are analyzing a web application using ONLY structured observations',
    'produced by ReplayQA, a discovery engine. You receive a single JSON object',
    'with four keys:',
    '  - application: { url }',
    '  - discoveredPages: pages ReplayQA explored, each with title, url, buttons,',
    '    links, forms (fields + submit), tables (headers + rowCount), inputs.',
    '  - exploredStates: metadata about the states captured (id, url, timestamp).',
    '  - findings: structured observations emitted by detectors, each with a',
    '    type, confidence, evidence, and a type-specific payload.',
    '',
    'Infer, using ONLY this JSON:',
    '  1. applicationType — one-line description of what the app is.',
    '  2. entities — business data types the app manages (e.g. "Contact").',
    '  3. capabilities — what the app can do (e.g. "Authentication", "CRUD",',
    '     "Search", "Pagination", "Settings").',
    '  4. flows — important user journeys as "A → B → C" strings.',
    '',
    'HARD RULES:',
    '  - Derive everything from the JSON only. Do NOT assume facts you cannot',
    '    see. If ReplayQA did not explore a page (e.g. it hit a login wall and',
    '    had no credentials), you will not see that page — say so.',
    '  - missingInformation is the MOST IMPORTANT field. For everything you',
    '    cannot determine, add an entry in exactly this form:',
    '        "I cannot determine X because ReplayQA has not yet extracted Y."',
    '    This field guides which observations ReplayQA must add next.',
    '  - confidence (0..1) reflects how much of the application you believe you',
    '    actually understood from the provided JSON, not a guess.',
    '',
    'Return ONLY a JSON object with EXACTLY these keys, no other text:',
    '  {',
    '    "applicationType": string,',
    '    "entities": string[],',
    '    "capabilities": string[],',
    '    "flows": string[],',
    '    "confidence": number,',
    '    "missingInformation": string[]',
    '  }',
  ].join('\n');

  const user = JSON.stringify(observations, null, 2);
  return { system, user };
}
