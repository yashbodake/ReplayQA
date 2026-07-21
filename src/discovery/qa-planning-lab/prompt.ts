import type { PlannerInput } from './collect.js';

/**
 * Build the chat messages. The user message is JSON only: ReplayQA's raw
 * observations plus its prior reasoning. The system message casts the model as
 * a Senior QA Lead and fixes the output contract (the TestPlan schema).
 *
 * The most important field is again `missingInformation`: the plan must
 * declare its own blind spots rather than guessing.
 */
export function buildPrompt(input: PlannerInput): { system: string; user: string } {
  const system = [
    'You are a Senior QA Lead. You are given a JSON object with two keys:',
    '  - "observations": structured observations ReplayQA collected about a web',
    '    application (discovered pages with buttons/links/forms/tables/inputs,',
    '    explored-state metadata, and detector findings).',
    '  - "reasoning": ReplayQA\'s prior inference about the application',
    '    (applicationType, entities, capabilities, flows, and its own stated',
    '    missing information). Treat this as the engine\'s best understanding,',
    '    but verify it against the raw observations.',
    '',
    'Produce a professional QA Test Plan grounded ONLY in this JSON. Do not',
    'invent features the observations do not support. Do not generate code.',
    '',
    'Return ONLY a JSON object with EXACTLY this shape:',
    '  {',
    '    "applicationSummary": {',
    '      "applicationType": string,',
    '      "authenticationRequired": boolean,',
    '      "category": string,              // e.g. "CRUD Application"',
    '      "summary": string                // one short paragraph',
    '    },',
    '    "criticalUserJourneys": [',
    '      { "name": string, "priority": "critical"|"high"|"medium"|"low",',
    '        "rationale": string }',
    '    ],',
    '    "functionalScenarios": [',
    '      { "id": string,                  // e.g. "TC-001"',
    '        "journey": string,             // which journey it belongs to',
    '        "title": string,',
    '        "priority": "critical"|"high"|"medium"|"low",',
    '        "purpose": string,',
    '        "preconditions": string[],',
    '        "expectedResult": string }',
    '    ],',
    '    "edgeCases": [',
    '      { "area": string, "cases": string[] }',
    '    ],',
    '    "riskAssessment": {',
    '      "high":   [ { "area": string, "reason": string } ],',
    '      "medium": [ { "area": string, "reason": string } ],',
    '      "low":    [ { "area": string, "reason": string } ]',
    '    },',
    '    "coverageAnalysis": {',
    '      "coveredAreas": string[],',
    '      "unevaluatedAreas": string[]',
    '    },',
    '    "missingInformation": string[],   // BLIND SPOTS — see below',
    '    "confidence": number              // 0..1',
    '  }',
    '',
    'COVERAGE GUIDANCE:',
    '  - Generate concrete functional scenarios: valid + invalid auth, create,',
    '    read, update, duplicate, search-existing, search-missing — as far as',
    '    the observations support. Each scenario needs priority, purpose,',
    '    preconditions, and a single clear expected result.',
    '  - Edge cases: empty fields, duplicates, invalid emails, max length,',
    '    special characters — scoped to the fields/forms actually observed.',
    '',
    'BLIND SPOTS (most important):',
    '  - For anything you cannot responsibly recommend tests for, add an entry',
    '    to missingInformation in exactly this form:',
    '        "I cannot recommend tests for X because ReplayQA has not yet observed Y."',
    '  - If ReplayQA could not see past a login wall, say so explicitly and do',
    '    not fabricate post-login scenarios.',
    '  - Set confidence to reflect how much of the application the plan is',
    '    actually grounded in, not a guess.',
    '',
    'No text outside the JSON object.',
  ].join('\n');

  const user = JSON.stringify(input, null, 2);
  return { system, user };
}
