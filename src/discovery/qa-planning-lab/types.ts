/**
 * QA Test Plan schema — the output of the experimental QA Planning Engine.
 *
 * Persisted to `artifacts/discovery/test-plan.json` and rendered to
 * `test-plan.md` for human review. This is NOT the ReplayQA Application Model
 * (RAM) and NOT generated tests — it is a senior-QA-style plan a human can
 * review before any automation is written.
 */

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface ApplicationSummary {
  applicationType: string;
  authenticationRequired: boolean;
  /** Coarse category, e.g. "CRUD Application". */
  category: string;
  /** One short paragraph. */
  summary: string;
}

export interface UserJourney {
  name: string;
  priority: Priority;
  rationale: string;
}

export interface TestScenario {
  /** Stable id, e.g. "TC-001". Auto-assigned if the model omits it. */
  id: string;
  /** Journey this scenario belongs to. */
  journey: string;
  title: string;
  priority: Priority;
  purpose: string;
  preconditions: string[];
  expectedResult: string;
}

export interface EdgeCaseGroup {
  area: string;
  cases: string[];
}

export interface RiskItem {
  area: string;
  reason: string;
}

export interface RiskAssessment {
  high: RiskItem[];
  medium: RiskItem[];
  low: RiskItem[];
}

export interface CoverageAnalysis {
  /** Areas the observations let us plan tests for with confidence. */
  coveredAreas: string[];
  /** Areas that exist conceptually but cannot yet be evaluated. */
  unevaluatedAreas: string[];
}

export interface TestPlan {
  applicationSummary: ApplicationSummary;
  criticalUserJourneys: UserJourney[];
  functionalScenarios: TestScenario[];
  edgeCases: EdgeCaseGroup[];
  riskAssessment: RiskAssessment;
  coverageAnalysis: CoverageAnalysis;
  /**
   * Blind spots — each in the form
   * "I cannot recommend tests for X because ReplayQA has not yet observed Y."
   */
  missingInformation: string[];
  /** The planner's confidence in the overall plan, 0..1. */
  confidence: number;
}
