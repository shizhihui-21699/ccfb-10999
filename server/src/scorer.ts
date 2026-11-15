/**
 * Score aggregation.
 *
 * Model: additive weighted rules inside four capped categories.
 *   headless ≤45, automation ≤30, contradiction ≤20, behavior ≤20.
 * Negative-weight "human signal" rules may offset positive evidence within the
 * same category, so one strong human trait can dilute a borderline technical
 * signal instead of being ignored. Final score clamped to [0,100].
 *
 * Thresholds (tunable in one place for A/B):
 *   score >= 60  => bot
 *   30..59       => suspect
 *   <30          => human
 *
 * Hard overrides — additive capping must not bury decisive forensic evidence.
 * Severity (not weight) drives the override: severity=high means the signal
 * cannot occur organically on a real user machine.
 *   - two+ distinct severity=high signals  => bot (e.g. HeadlessChrome UA AND
 *     webdriver=true — no legitimate browser has both);
 *   - one severity=high signal             => at least suspect.
 */
import type { BotGuardReport } from '../../shared/protocol.ts';
import { RULE_SETS, evaluateRules } from './rules.ts';
import type {
  Category,
  CategoryBreakdown,
  DataQuality,
  ScoreResult,
  SignalEvidence,
  Verdict,
} from './types.ts';

export const THRESHOLDS = { suspect: 30, bot: 60 } as const;
const HARD_BOT_HIGH_COUNT = 2;

const CATEGORY_ORDER: Category[] = ['headless', 'automation', 'contradiction', 'behavior'];

function assessQuality(report: BotGuardReport): DataQuality {
  const b = report.behavior;
  const interactionCount = b.mouse.count + b.keyboard.count + b.click.count + b.scroll.count;
  // env is "complete" once the heavy probes ran (canvas hash present or explicit block)
  const envComplete = report.env.canvas.hash !== '' || report.env.canvas.blocked;
  return {
    mouseSamples: b.mouse.count,
    keySamples: b.keyboard.count,
    clickCount: b.click.count,
    scrollCount: b.scroll.count,
    behaviorInsufficient: interactionCount < 10,
    envComplete,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreReport(report: BotGuardReport): ScoreResult {
  const fired = evaluateRules(report);
  const categories: CategoryBreakdown[] = [];
  const allEvidence: SignalEvidence[] = [];
  const humanSignals: SignalEvidence[] = [];

  let total = 0;
  const highSignals: SignalEvidence[] = [];

  for (const category of CATEGORY_ORDER) {
    const set = RULE_SETS[category];
    const evidence = fired.get(category) ?? [];
    const raw = evidence.reduce((s, e) => s + e.weight, 0);
    // Negative evidence may pull the category below zero; clamp at 0 for the
    // contribution, but keep raw visible in the breakdown.
    const capped = clamp(raw, 0, set.cap);
    total += capped;
    for (const e of evidence) {
      allEvidence.push(e);
      if (e.weight < 0) humanSignals.push(e);
      if (e.severity === 'high' && e.weight > 0) highSignals.push(e);
    }
    categories.push({ category, label: set.label, raw: Number(raw.toFixed(2)), capped, cap: set.cap, evidence });
  }

  const score = clamp(Math.round(total), 0, 100);

  // Distinct forensic high-severity signals (dedupe by rule id).
  const distinctHigh = new Set(highSignals.map((e) => e.id)).size;
  let verdict: Verdict;
  if (score >= THRESHOLDS.bot || distinctHigh >= HARD_BOT_HIGH_COUNT) verdict = 'bot';
  else if (score >= THRESHOLDS.suspect || distinctHigh >= 1) verdict = 'suspect';
  else verdict = 'human';

  const summary = [...allEvidence]
    .filter((e) => e.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((e) => `${e.reason}(+${e.weight})`);
  if (distinctHigh >= HARD_BOT_HIGH_COUNT && score < THRESHOLDS.bot) {
    summary.unshift(`硬判定:${distinctHigh} 条高置信度取证信号同时出现,直接判 bot(常规阈值 ${THRESHOLDS.bot})`);
  }

  return {
    sessionId: report.sessionId,
    score,
    verdict,
    threshold: { suspect: THRESHOLDS.suspect, bot: THRESHOLDS.bot },
    categories,
    evidence: allEvidence.sort((a, b) => b.weight - a.weight),
    humanSignals,
    dataQuality: assessQuality(report),
    summary,
    scoredAt: new Date().toISOString(),
  };
}
