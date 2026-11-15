/** Scoring engine public types. */

export type Category = 'headless' | 'automation' | 'contradiction' | 'behavior';
export type Severity = 'high' | 'medium' | 'low';
export type Verdict = 'bot' | 'suspect' | 'human';

/** One fired rule: the atomic unit of explanation. */
export interface SignalEvidence {
  /** Stable machine id, e.g. HEADLESS_WEBDRIVER */
  id: string;
  category: Category;
  severity: Severity;
  /** Weight contributed after capping (may be negative) */
  weight: number;
  /** Human-readable explanation, zh-CN */
  reason: string;
  /** The actual observed value that fired the rule */
  observed: unknown;
  /** What a benign browser would typically look like */
  expected?: string;
}

export interface CategoryBreakdown {
  category: Category;
  label: string;
  /** Sum of fired-rule weights before cap */
  raw: number;
  /** Actual contribution after the category cap */
  capped: number;
  cap: number;
  evidence: SignalEvidence[];
}

export interface DataQuality {
  mouseSamples: number;
  keySamples: number;
  clickCount: number;
  scrollCount: number;
  /** true when behavioral evidence is too thin to score behavior */
  behaviorInsufficient: boolean;
  envComplete: boolean;
}

export interface ScoreResult {
  sessionId: string;
  score: number;
  verdict: Verdict;
  threshold: { suspect: number; bot: number };
  categories: CategoryBreakdown[];
  evidence: SignalEvidence[];
  /** Positive signals that argued FOR a human (negative weights fired) */
  humanSignals: SignalEvidence[];
  dataQuality: DataQuality;
  /** Headline reasons, top 3 by absolute weight */
  summary: string[];
  scoredAt: string;
}
