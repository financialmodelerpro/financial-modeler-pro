/**
 * fundTerms.ts (REFM fund layer)
 *
 * Step 1 (2026-08-03) put the standalone-vs-fund toggle here. Step 2 adds the
 * terms the M1 Fund Terms tab collects: management fee, fee base, hurdle,
 * carry, committed capital, and fee share by party role. See
 * docs/FUND_LAYER_GUIDELINE.md.
 *
 * STILL INPUTS ONLY. Nothing in any engine reads these values yet; the fee
 * lands in M4 at Step 3 and the waterfall in M5 at Step 4. With the toggle off
 * every value here is stored and inert, which
 * scripts/verify-fund-layer-guard.ts pins by comparing full engine output with
 * the terms absent versus present-and-disabled.
 *
 * PURE: no I/O, no state, no engine import, no client- or server-only import,
 * because the tab, the API route and the verifiers all import it.
 *
 * Rates are DECIMAL FRACTIONS (0.02 = 2%), matching discountRate, payoutRatio
 * and the tax rate rather than introducing percent-valued numbers that some
 * caller would eventually forget to divide. The tab does the x100 for display.
 *
 * No em dashes in this file.
 */

import type { Project } from './state/module1-types';
import { PARTY_ROLES } from './parties';

/**
 * What the management fee is charged on. EXACTLY TWO OPTIONS IN V1, and both
 * are LINEAR: the fee raises the funding requirement, but the higher funding
 * does not raise the fee.
 *
 * Fund size (equity + debt) is deliberately absent. It would make the fee feed
 * back into its own base (fee raises funding, funding raises fund size, fund
 * size raises the fee) and drag the fund layer into the M4 circular solve. It
 * is deferred to v1.1, where it is one added enum value rather than a rebuild.
 * Do not add it here without doing that work deliberately.
 */
export const FEE_BASES = ['committed_capital', 'total_development_cost'] as const;
export type FeeBase = typeof FEE_BASES[number];

export const FEE_BASE_LABELS: Record<FeeBase, string> = {
  committed_capital: 'Committed capital',
  total_development_cost: 'Total development cost',
};

export const FEE_BASE_HELP: Record<FeeBase, string> = {
  committed_capital: 'The capital investors have committed, as you enter it below. The fee does not move when funding changes.',
  total_development_cost: 'Total development cost from your model. Computed from capex, so it does not move when funding changes.',
};

/** One role's share of fee income. `sharePct` is a decimal fraction. */
export interface FeeShare {
  role: string;
  sharePct: number;
}

/** Fund terms, resolved: every field present, every value in range. */
export interface FundTerms {
  enabled: boolean;
  managementFeePct: number;
  feeBase: FeeBase;
  hurdleRatePct: number;
  carryPct: number;
  committedCapital: number;
  feeShares: FeeShare[];
}

/** What a project with no fund terms means. Standalone, which is today. */
export const DEFAULT_FUND_TERMS: FundTerms = {
  enabled: false,
  managementFeePct: 0,
  feeBase: 'committed_capital',
  hurdleRatePct: 0,
  carryPct: 0,
  committedCapital: 0,
  feeShares: [],
};

const clamp01 = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
};

const nonNegative = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
};

/** Coerce an unknown fee base to a valid one. Anything unrecognised, including
 *  a v1.1 'fund_size' arriving from a future build or a hand-edited row, falls
 *  back to the safe linear default rather than being honoured. */
export function coerceFeeBase(v: unknown): FeeBase {
  return (FEE_BASES as readonly string[]).includes(String(v)) ? (v as FeeBase) : 'committed_capital';
}

/** Keep only recognised roles, deduped, in canonical PARTY_ROLES order, with
 *  each share clamped to 0..1. Mirrors sanitizeRoles in parties.ts: the role
 *  set is validated in the app rather than by a database constraint, so it
 *  stays extensible without a migration. */
export function sanitizeFeeShares(input: unknown): FeeShare[] {
  if (!Array.isArray(input)) return [];
  const byRole = new Map<string, number>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { role?: unknown; sharePct?: unknown };
    const role = String(r.role ?? '');
    if (!(PARTY_ROLES as readonly string[]).includes(role)) continue;
    byRole.set(role, clamp01(r.sharePct));
  }
  return PARTY_ROLES.filter((r) => byRole.has(r)).map((r) => ({ role: r, sharePct: byRole.get(r) as number }));
}

/** Sum of the fee shares. 1 means fully allocated. */
export function feeShareTotal(shares: readonly FeeShare[] | undefined): number {
  return (shares ?? []).reduce((sum, s) => sum + (Number.isFinite(s.sharePct) ? s.sharePct : 0), 0);
}

/**
 * True when the shares are usable: either nobody has been given a share yet
 * (nothing to reconcile) or they add up to 100 percent within a rounding
 * whisker. Reported to the user as a warning rather than enforced as a block,
 * matching how the platform surfaces reconciliation elsewhere: a half-entered
 * split is a normal intermediate state, not a reason to refuse a save.
 */
export function feeSharesBalanced(shares: readonly FeeShare[] | undefined): boolean {
  const list = shares ?? [];
  if (list.length === 0) return true;
  return Math.abs(feeShareTotal(list) - 1) < 1e-6;
}

/**
 * Resolve a project's fund terms.
 *
 * `enabled` is true ONLY for a literal true: absent, null, a non-object, or a
 * truthy non-boolean all resolve to off, so an older snapshot or a hand-edited
 * jsonb cannot switch the fund layer on by accident. Every other field is
 * coerced into range rather than trusted, because these values will drive money
 * from Step 3 and a NaN fee percentage must never reach an engine.
 */
export function resolveFundTerms(project: Pick<Project, 'fundTerms'> | null | undefined): FundTerms {
  const raw = project?.fundTerms;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FUND_TERMS, feeShares: [] };
  return {
    enabled: raw.enabled === true,
    managementFeePct: clamp01(raw.managementFeePct),
    feeBase: coerceFeeBase(raw.feeBase),
    hurdleRatePct: clamp01(raw.hurdleRatePct),
    carryPct: clamp01(raw.carryPct),
    committedCapital: nonNegative(raw.committedCapital),
    feeShares: sanitizeFeeShares(raw.feeShares),
  };
}

/**
 * The one question every future fee, hurdle, carry and net-returns code path
 * must ask before it does anything. Kept as a named helper so the guard can
 * pin the default, and so no caller hand-rolls a truthiness check that treats
 * a stray string as on.
 */
export function isFundLayerActive(project: Pick<Project, 'fundTerms'> | null | undefined): boolean {
  return resolveFundTerms(project).enabled;
}

/** The storage shape written to the snapshot. Same field names as the resolved
 *  form, so there is no mapping layer to get wrong. */
export type FundTermsPatch = NonNullable<Project['fundTerms']>;

/** Resolved terms as the snapshot patch the store persists. */
export function toFundTermsPatch(t: FundTerms): FundTermsPatch {
  return {
    enabled: t.enabled,
    managementFeePct: t.managementFeePct,
    feeBase: t.feeBase,
    hurdleRatePct: t.hurdleRatePct,
    carryPct: t.carryPct,
    committedCapital: t.committedCapital,
    feeShares: t.feeShares.map((s) => ({ role: s.role, sharePct: s.sharePct })),
  };
}

/** The database row shape, snake_case, as stored in refm_fund_terms. */
export interface FundTermsRow {
  fund_enabled: boolean;
  management_fee_pct: number;
  fee_base: string;
  hurdle_rate_pct: number;
  carry_pct: number;
  committed_capital: number;
  fee_shares: unknown;
}

/** Row to resolved terms. Used by the API route and the tab, so the two can
 *  never disagree about what a row means. */
export function fromRow(row: Partial<FundTermsRow> | null | undefined): FundTerms {
  if (!row) return { ...DEFAULT_FUND_TERMS, feeShares: [] };
  return {
    enabled: row.fund_enabled === true,
    managementFeePct: clamp01(row.management_fee_pct),
    feeBase: coerceFeeBase(row.fee_base),
    hurdleRatePct: clamp01(row.hurdle_rate_pct),
    carryPct: clamp01(row.carry_pct),
    committedCapital: nonNegative(row.committed_capital),
    feeShares: sanitizeFeeShares(row.fee_shares),
  };
}

/** Resolved terms to the row shape. Every value is already coerced, so the
 *  database CHECK constraints are a backstop rather than the first line of
 *  defence. */
export function toRow(t: FundTerms): FundTermsRow {
  return {
    fund_enabled: t.enabled,
    management_fee_pct: t.managementFeePct,
    fee_base: t.feeBase,
    hurdle_rate_pct: t.hurdleRatePct,
    carry_pct: t.carryPct,
    committed_capital: t.committedCapital,
    fee_shares: t.feeShares,
  };
}
