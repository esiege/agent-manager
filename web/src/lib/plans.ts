// Claude subscription plans for the Reporting tab's "Plan" view: how many tokens a plan allows,
// so usage reads as a share of the plan instead of an API bill.
//
// Anthropic doesn't publish token limits for its plans, so these are rough estimates of all
// tokens (cache reads and writes included, the way the Tokens tile counts them) per seat. They
// only fill in the input: anyone can type their own number over them.

export type PlanPeriod = 'week' | 'month';

export interface Plan {
  id: string;
  label: string;
  /** Millions of tokens per week. */
  weekly: number;
}

export const PLANS: Plan[] = [
  { id: 'pro', label: 'Pro', weekly: 50 },
  { id: 'max-5x', label: 'Max 5x', weekly: 250 },
  { id: 'max-20x', label: 'Max 20x', weekly: 1000 },
  { id: 'team-standard', label: 'Team Standard', weekly: 60 },
  { id: 'team-premium', label: 'Team Premium', weekly: 300 },
  { id: 'enterprise', label: 'Enterprise', weekly: 300 },
];

/** The dropdown's value once the number was typed by hand. */
export const CUSTOM_PLAN = 'custom';

export interface PlanSettings {
  plan: string;
  /** Millions of tokens allowed per period. */
  tokens: number;
  period: PlanPeriod;
}

const PERIOD_DAYS: Record<PlanPeriod, number> = { week: 7, month: 30 };

/** Two significant digits: a month of a 50M week reads as 210M, not 214.2857M. */
function round2(n: number): number {
  if (n <= 0) return 0;
  const unit = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / unit) * unit;
}

/** A value per one period, as the other period. */
export function convertPeriod(tokens: number, from: PlanPeriod, to: PlanPeriod): number {
  return from === to ? tokens : round2((tokens * PERIOD_DAYS[to]) / PERIOD_DAYS[from]);
}

/** What a plan allows per period, in millions of tokens; null for an unknown or custom plan. */
export function planTokens(planId: string, period: PlanPeriod): number | null {
  const plan = PLANS.find((p) => p.id === planId);
  return plan ? convertPeriod(plan.weekly, 'week', period) : null;
}

export const DEFAULT_PLAN: PlanSettings = { plan: 'max-5x', tokens: planTokens('max-5x', 'week')!, period: 'week' };

/** Tokens (not millions) the plan allows per day. */
export function allowancePerDay(s: PlanSettings): number {
  return (s.tokens * 1_000_000) / PERIOD_DAYS[s.period];
}
