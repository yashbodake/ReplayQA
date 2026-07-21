/**
 * AI Reasoning PoC — output schema.
 *
 * This is the shape we ask the LLM to return and the shape we persist to
 * `artifacts/discovery/reasoning.json`. It is intentionally simple and
 * human-readable: the point of the experiment is to see whether ReplayQA's
 * structured observations let a model produce a USEFUL understanding, not to
 * invent a new model format (RAM is separate and out of scope).
 */
export interface ReasoningResult {
  /** One-line description of what the app is (e.g. "Contact Management System"). */
  applicationType: string;
  /** Business data types the app manages (e.g. "Contact", "Product"). */
  entities: string[];
  /** What the app can do (e.g. "Authentication", "CRUD", "Search"). */
  capabilities: string[];
  /** Important user journeys as "A → B → C" strings. */
  flows: string[];
  /** The model's confidence in its overall assessment, 0..1. */
  confidence: number;
  /**
   * What the model could NOT determine, and why — in the form
   * "I cannot determine X because ReplayQA has not yet extracted Y."
   * This is the most important output: it tells us which observations to add.
   */
  missingInformation: string[];
}
