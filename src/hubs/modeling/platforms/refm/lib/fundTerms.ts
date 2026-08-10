/**
 * fundTerms.ts (REFM fund layer)
 *
 * Step 1 (2026-08-03) put the standalone-vs-fund toggle here. Step 2 added the
 * terms the M1 Fund Terms tab collects. Step 2 EXTENDED (2026-08-04) replaced
 * the single management fee with the real fee set a fund carries, and replaced
 * the per-role share list with a per-PARTY distribution matrix. See
 * docs/FUND_LAYER_GUIDELINE.md.
 *
 * STILL INPUTS ONLY. Nothing in any engine reads these values yet; the fees
 * land in M4 at Step 3 and the waterfall in M5 at Step 4. With the toggle off
 * every value here is stored and inert, which
 * scripts/verify-fund-layer-guard.ts pins by comparing full engine output with
 * the terms absent versus present-and-disabled.
 *
 * ── THE LINEARITY RULE, AND WHY IT IS A DATA STRUCTURE ─────────────────────
 *
 * A fee is a cash outflow, so paying it RAISES the funding requirement. If a
 * fee were charged on anything the funding solve moves within the same period,
 * the fee would feed its own base and the fund layer would land inside the M4
 * circular block. So every base is known BEFORE the period's cash moves:
 *
 *   fund size       total equity + debt, RESOLVED ONCE from a fee-free pass
 *                   and frozen before the solver (2026-08-05); never read live
 *   facility limit  a user input (the limit), never the drawn balance
 *   opening NAV     NAV at the START of the period, fixed before cash moves
 *   flat amount     a typed currency figure per annum
 *
 * That rule used to live in a comment, which is exactly the kind of thing a
 * later step violates without noticing. It is now DECLARATIVE: every fee is a
 * FeeSpec carrying its timing and its base, `LINEAR_FEE_BASES` is the allowed
 * set, `CIRCULAR_FEE_BASES` names what must never appear, and
 * scripts/verify-fund-terms.ts fails the build if any fee declares a base
 * outside the linear set. Step 3 inherits a contract rather than a memo.
 *
 * PURE: no I/O, no state, no engine import, no client- or server-only import,
 * because the tab, the API route and the verifiers all import it.
 *
 * Rates are DECIMAL FRACTIONS (0.02 = 2%), matching discountRate, payoutRatio
 * and the tax rate. The tab does the x100 for display, in one place.
 *
 * No em dashes in this file.
 */

import type { Project } from './state/module1-types';
import { PARTY_ROLES } from './parties';

// ── Fee bases ───────────────────────────────────────────────────────────────

/** Every base a v1 fee may charge on. All four are known before the period's
 *  funding solve, which is what keeps the fund layer out of the circular block. */
export const LINEAR_FEE_BASES = [
  'fund_size', 'total_equity', 'debt_facility',
  'opening_nav', 'facility_limit', 'flat_amount',
] as const;
export type FeeBaseKind = typeof LINEAR_FEE_BASES[number];

/**
 * Bases that must NEVER be used, named so the rule is testable rather than
 * remembered. Each one moves with the funding solve inside the period it would
 * be charged in, so charging on it would make the fee feed its own base.
 *
 * `fund_size_solved` is the trap worth spelling out: fund size as a USER INPUT
 * is linear and allowed, but fund size DERIVED as equity plus debt is not, and
 * the two are one careless line apart.
 */
export const CIRCULAR_FEE_BASES = [
  'closing_nav', 'average_nav', 'drawn_debt', 'total_sources',
  'funding_requirement', 'fund_size_solved',
] as const;

export const FEE_BASE_LABELS: Record<FeeBaseKind, string> = {
  fund_size: 'Fund size',
  total_equity: 'Total equity',
  debt_facility: 'Debt facility',
  opening_nav: 'Opening NAV',
  facility_limit: 'Facility limit',
  flat_amount: 'Flat amount',
};

export const FEE_BASE_HELP: Record<FeeBaseKind, string> = {
  fund_size: 'Total equity plus the debt facility, from your model, frozen before the funding solve so the fee cannot feed its own base. Override it below to state a target instead.',
  total_equity: 'All equity injected over the life of the fund: cash, in kind and equity already in the project. Frozen before the funding solve.',
  debt_facility: 'Total debt raised over the life of the fund, including capitalised interest. The amount actually raised, not the facility ceiling. Frozen before the funding solve.',
  opening_nav: 'NAV at the START of each year, so the fee is known before the year`s cash moves.',
  facility_limit: 'The facility limit you enter below, not the drawn balance.',
  flat_amount: 'A fixed amount you enter, per annum.',
};

export type FeeTiming = 'one_time' | 'annual';
export const FEE_TIMING_LABELS: Record<FeeTiming, string> = {
  one_time: 'One time',
  annual: 'Annual',
};

/** Which fund-fee field a spec drives. Keys match the FundTerms field names, so
 *  the UI can render the whole section from this registry with no mapping. */
export type FundFeeKey =
  | 'fundStructureFeePct'
  | 'fundManagementFeePct'
  | 'custodyAdminFeePct'
  | 'debtArrangingFeePct'
  | 'otherExpensesPerAnnum';

export interface FeeSpec {
  key: FundFeeKey;
  label: string;
  timing: FeeTiming;
  base: FeeBaseKind;
  /** 'rate' is a decimal fraction shown as a percentage; 'amount' is currency. */
  kind: 'rate' | 'amount';
  help: string;
}

/**
 * The fund management fees, in the order the tab shows them.
 *
 * This registry is the single source of truth: the tab renders from it, the
 * verifier polices it, and Step 3 will read the timing and base from it rather
 * than re-deciding per fee in engine code.
 */
export const FUND_FEE_SPECS: readonly FeeSpec[] = [
  {
    key: 'fundStructureFeePct', label: 'Fund structure fee', timing: 'one_time', base: 'fund_size', kind: 'rate',
    help: 'Charged once on the fund size, for establishing the vehicle.',
  },
  // THREE DISTINCT CAPITAL BASES, matching the reference exactly (2026-08-10).
  //
  //   total equity   all equity injected over the life (cash + in kind + the
  //                  equity already in the project)
  //   debt facility  total debt RAISED over the life, incl. capitalised interest
  //   fund size      total equity + debt facility
  //
  // so a reader can add the two components and land on the third.
  //
  // History worth keeping, because this base moved twice in one day. The two
  // annual fees charged on OPENING NAV until 2026-08-10: the engine was right
  // (fee_t == openingNAV_t x rate) but a net-asset balance that moves each year
  // does not match a model that sizes a fund by its total funding, and the
  // displayed basis summed that balance over the life, reading about seven
  // times the fund size. They were then briefly moved to FUND SIZE, which
  // over-collapsed the problem: all three capital fees shared one base and the
  // equity-only and debt-only fees lost their distinct bases. This is the
  // correct decomposition.
  //
  // All three are lifetime totals resolved ONCE in the fee-free pass and then
  // frozen, so the freeze is unchanged.
  {
    key: 'fundManagementFeePct', label: 'Fund management fee', timing: 'annual', base: 'total_equity', kind: 'rate',
    help: 'Charged each year on total equity (all equity injected over the life of the fund).',
  },
  {
    key: 'custodyAdminFeePct', label: 'Custody and admin fee', timing: 'annual', base: 'total_equity', kind: 'rate',
    help: 'Charged each year on total equity (all equity injected over the life of the fund).',
  },
  // On the DEBT FACILITY (total debt raised), not the facility limit. On the
  // reference project the limit resolves from an LTV cap to 4,273.8m against
  // 2,834.1m actually raised, a 1,439.8m gap, so the two are not
  // interchangeable and the fee would have been charged on a ceiling the fund
  // never drew.
  {
    key: 'debtArrangingFeePct', label: 'Debt arranging fee', timing: 'one_time', base: 'debt_facility', kind: 'rate',
    help: 'Charged once on the debt facility (total debt raised over the life of the fund).',
  },
  {
    key: 'otherExpensesPerAnnum', label: 'Other expenses', timing: 'annual', base: 'flat_amount', kind: 'amount',
    help: 'A fixed amount per annum for anything not covered above.',
  },
] as const;

// ── Fee distribution matrix ────────────────────────────────────────────────

/** The fee types that get split across parties. */
export const FEE_DISTRIBUTION_COLUMNS = [
  { key: 'performanceFeePct', label: 'Performance Fee' },
  { key: 'developerFeePct', label: 'Developer Fee' },
  { key: 'commissionPct', label: 'Commission' },
] as const;

export type FeeDistributionColumnKey = typeof FEE_DISTRIBUTION_COLUMNS[number]['key'];

/**
 * One party's share of each fee type.
 *
 * `partyId` links to refm_parties; `partyName` is SNAPSHOTTED at save time so a
 * renamed or deleted party never blanks a saved row, and no report has to join
 * back to a mutable side table. Same shape an M5 equity partner uses.
 *
 * The FUND MANAGER also occupies a row here, carrying the reserved id below.
 * That keeps the matrix ONE uniform structure keyed by party id rather than a
 * special case bolted on the side, and the reserved id is what tells the two
 * apart wherever the difference matters.
 */
export interface FeeDistributionRow {
  partyId: string;
  partyName: string;
  performanceFeePct: number;
  developerFeePct: number;
  commissionPct: number;
}

/**
 * The Fund Manager's reserved row id in the distribution matrix.
 *
 * Deliberately not a uuid: it must be recognisable on sight in stored jsonb,
 * and it must never collide with a refm_parties id (which is a uuid), so a
 * party can never be mistaken for the manager or the other way round.
 */
export const FUND_MANAGER_ROW_ID = '__fund_manager__';

export const DEFAULT_FUND_MANAGER_NAME = 'Fund Manager';

/** True for the Fund Manager's row rather than a project party's. */
export function isFundManagerRow(row: { partyId?: string } | null | undefined): boolean {
  return row?.partyId === FUND_MANAGER_ROW_ID;
}

/**
 * An entity that EARNS fee income: the Fund Manager, or a project party.
 *
 * This is the contract Step 5 consumes to flow fee income into M5 Parties and
 * the per-partner returns. It is deliberately NOT `PartnerInput`: an M5 partner
 * is defined by the equity it contributed and earns a time-weighted SHARE of
 * the consolidated stream, and the Fund Manager contributes no equity at all.
 * Dropping it into `PartnerInput` would give it a zero shareholding, a zero
 * invested base and an undefined IRR, and would break the reconciliation that
 * makes the partner table trustworthy (Sigma partners == consolidated). A fee
 * earner sits alongside the equity partners, not inside them.
 */
export interface FeeEarner {
  /** Stable id: FUND_MANAGER_ROW_ID, or a refm_parties id. */
  entityId: string;
  name: string;
  kind: 'fund_manager' | 'party';
  /**
   * Share of the FUND MANAGEMENT fees (structure, management, custody and
   * admin, debt arranging, other expenses). 1 for the Fund Manager, 0 for
   * everyone else: those fees are the manager's by definition and are never
   * split, so this is a constant rather than a stored input.
   */
  managementFeeShare: number;
  /** Shares of the split fee types, from the distribution matrix. */
  performanceFeePct: number;
  developerFeePct: number;
  commissionPct: number;
}

/**
 * Every entity entitled to fee income, Fund Manager first.
 *
 * The Fund Manager is ALWAYS present when the fund layer is on, even with an
 * empty matrix, because it earns the management fees regardless of whether
 * anyone has split the performance fee yet.
 */
export function resolveFeeEarners(terms: FundTerms): FeeEarner[] {
  const fmRow = terms.feeDistribution.find(isFundManagerRow);
  const manager: FeeEarner = {
    entityId: FUND_MANAGER_ROW_ID,
    name: terms.fundManagerName || DEFAULT_FUND_MANAGER_NAME,
    kind: 'fund_manager',
    managementFeeShare: 1,
    performanceFeePct: fmRow?.performanceFeePct ?? 0,
    developerFeePct: fmRow?.developerFeePct ?? 0,
    commissionPct: fmRow?.commissionPct ?? 0,
  };
  const parties: FeeEarner[] = terms.feeDistribution
    .filter((r) => !isFundManagerRow(r))
    .map((r) => ({
      entityId: r.partyId,
      name: r.partyName,
      kind: 'party' as const,
      managementFeeShare: 0,
      performanceFeePct: r.performanceFeePct,
      developerFeePct: r.developerFeePct,
      commissionPct: r.commissionPct,
    }));
  return [manager, ...parties];
}

// ── Resolved terms ─────────────────────────────────────────────────────────

/** One role's share of fee income. LEGACY (migration 208): superseded by the
 *  per-party distribution matrix, retained so old rows keep resolving. */
export interface FeeShare {
  role: string;
  sharePct: number;
}

export interface FundTerms {
  enabled: boolean;

  /** The entity that earns the fund management fees. Exists only when the fund
   *  layer is on, which is why it lives here and not on the Parties tab. */
  fundManagerName: string;

  /**
   * The TARGET fund size, used when `fundSizeOverride` is on or when the model
   * raises no capital.
   *
   * CHANGED 2026-08-05: fund size is now DERIVED from the model by default
   * (total equity plus total debt, see resolveFundSize in fundFees.ts). It was
   * a typed input until then, because fund size is equity plus debt, debt is
   * solved by the funding requirement, and the fees raise that requirement, so
   * reading it live would make the fee feed its own base.
   *
   * What makes the derived figure safe is the FREEZE, not a change of heart:
   * it is resolved once from a fee-free snapshot before the solver runs and is
   * then a constant, exactly as opening NAV has been since Step 3.
   * `fund_size_solved` (a live solved figure read inside the loop) remains in
   * CIRCULAR_FEE_BASES and remains forbidden.
   */
  fundSize: number;
  /** True when the typed `fundSize` should win over the model's figure. */
  fundSizeOverride: boolean;
  /**
   * The facility LIMIT the debt arranging fee charges on. Resolved from the
   * model where the model states one (see resolveFacilityLimit in fundFees.ts);
   * this stored number is the manual value, used when the model has no limit or
   * when `facilityLimitOverride` pins it. Never the DRAWN balance, which is a
   * solved output.
   */
  facilityLimit: number;
  /** True when the typed `facilityLimit` should win over the model's figure. */
  facilityLimitOverride: boolean;

  /** Fund management fees (see FUND_FEE_SPECS for each one's timing and base). */
  fundStructureFeePct: number;
  fundManagementFeePct: number;
  custodyAdminFeePct: number;
  debtArrangingFeePct: number;
  otherExpensesPerAnnum: number;

  /** Performance fee. `carryPct` on the row is the same number: carry IS the
   *  performance fee, so it keeps its migration-208 column rather than gaining
   *  a second source of truth. */
  performanceFeePct: number;
  /** Hurdle, expressed as an IRR. */
  hurdleRatePct: number;

  /** Per-party split of each fee type. */
  feeDistribution: FeeDistributionRow[];

  // ── Legacy, migration 208. Retired from the UI, still resolved so an
  //    existing row keeps its values and nothing is silently lost.
  managementFeePct: number;
  feeBase: LegacyFeeBase;
  committedCapital: number;
  feeShares: FeeShare[];
}

/** LEGACY fee-base enum from migration 208. Superseded by FUND_FEE_SPECS,
 *  where each fee declares its own base. Kept for old rows only. */
export const LEGACY_FEE_BASES = ['committed_capital', 'total_development_cost'] as const;
export type LegacyFeeBase = typeof LEGACY_FEE_BASES[number];

export const DEFAULT_FUND_TERMS: FundTerms = {
  enabled: false,
  fundManagerName: DEFAULT_FUND_MANAGER_NAME,
  fundSize: 0,
  fundSizeOverride: false,
  facilityLimit: 0,
  facilityLimitOverride: false,
  fundStructureFeePct: 0,
  fundManagementFeePct: 0,
  custodyAdminFeePct: 0,
  debtArrangingFeePct: 0,
  otherExpensesPerAnnum: 0,
  performanceFeePct: 0,
  hurdleRatePct: 0,
  feeDistribution: [],
  managementFeePct: 0,
  feeBase: 'committed_capital',
  committedCapital: 0,
  feeShares: [],
};

/** A fresh copy, so a caller mutating the result cannot flip the shared default. */
const freshDefaults = (): FundTerms => ({ ...DEFAULT_FUND_TERMS, feeDistribution: [], feeShares: [] });

// ── Coercion ───────────────────────────────────────────────────────────────

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

/** Coerce an unknown legacy fee base to a valid one. Anything unrecognised,
 *  including the deferred circular 'fund_size' or a hand-edited row, falls back
 *  to the safe default rather than being honoured. */
export function coerceFeeBase(v: unknown): LegacyFeeBase {
  return (LEGACY_FEE_BASES as readonly string[]).includes(String(v)) ? (v as LegacyFeeBase) : 'committed_capital';
}

/** LEGACY (migration 208). Keep only recognised roles, deduped, in canonical
 *  PARTY_ROLES order, shares clamped. */
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

/**
 * Rebuild the distribution matrix from untrusted input.
 *
 * A row without a partyId is dropped: the id is the link, and a share that
 * belongs to nobody cannot be rendered, edited or paid. Duplicate ids collapse
 * to the last one. Every share is clamped to 0..1. Rows for parties that no
 * longer exist are KEPT here on purpose, because dropping them silently would
 * discard the user's numbers behind their back; the tab is what surfaces them
 * and removes them on an explicit save.
 */
export function sanitizeFeeDistribution(input: unknown): FeeDistributionRow[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<string, FeeDistributionRow>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const partyId = String(r.partyId ?? '');
    if (!partyId) continue;
    byId.set(partyId, {
      partyId,
      partyName: typeof r.partyName === 'string' ? r.partyName : '',
      performanceFeePct: clamp01(r.performanceFeePct),
      developerFeePct: clamp01(r.developerFeePct),
      commissionPct: clamp01(r.commissionPct),
    });
  }
  return Array.from(byId.values());
}

/** Column total across parties. 1 means fully allocated. */
export function feeColumnTotal(rows: readonly FeeDistributionRow[] | undefined, col: FeeDistributionColumnKey): number {
  return (rows ?? []).reduce((sum, r) => {
    const v = r[col];
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/**
 * True when a column is usable: nobody allocated yet (nothing to reconcile) or
 * it adds to 100 percent within a rounding whisker. Reported as a warning
 * rather than enforced, because a half-entered split is a normal intermediate
 * state, not a reason to refuse a save.
 */
export function feeColumnBalanced(rows: readonly FeeDistributionRow[] | undefined, col: FeeDistributionColumnKey): boolean {
  const total = feeColumnTotal(rows, col);
  if (total === 0) return true;
  return Math.abs(total - 1) < 1e-6;
}

/** LEGACY helpers (migration 208), kept for old rows. */
export function feeShareTotal(shares: readonly FeeShare[] | undefined): number {
  return (shares ?? []).reduce((sum, s) => sum + (Number.isFinite(s.sharePct) ? s.sharePct : 0), 0);
}
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
 * coerced into range rather than trusted, because these values drive money from
 * Step 3 and a NaN fee must never reach an engine.
 */
export function resolveFundTerms(project: Pick<Project, 'fundTerms'> | null | undefined): FundTerms {
  const raw = project?.fundTerms;
  if (!raw || typeof raw !== 'object') return freshDefaults();
  return {
    enabled: raw.enabled === true,
    fundManagerName: typeof raw.fundManagerName === 'string' && raw.fundManagerName.trim()
      ? raw.fundManagerName.trim() : DEFAULT_FUND_MANAGER_NAME,
    fundSize: nonNegative(raw.fundSize),
    fundSizeOverride: raw.fundSizeOverride === true,
    facilityLimit: nonNegative(raw.facilityLimit),
    facilityLimitOverride: raw.facilityLimitOverride === true,
    fundStructureFeePct: clamp01(raw.fundStructureFeePct),
    fundManagementFeePct: clamp01(raw.fundManagementFeePct),
    custodyAdminFeePct: clamp01(raw.custodyAdminFeePct),
    debtArrangingFeePct: clamp01(raw.debtArrangingFeePct),
    otherExpensesPerAnnum: nonNegative(raw.otherExpensesPerAnnum),
    // carryPct is the stored name for the performance fee; performanceFeePct is
    // accepted too so a payload written against the newer field still resolves.
    performanceFeePct: clamp01(raw.performanceFeePct ?? raw.carryPct),
    hurdleRatePct: clamp01(raw.hurdleRatePct),
    feeDistribution: sanitizeFeeDistribution(raw.feeDistribution),
    managementFeePct: clamp01(raw.managementFeePct),
    feeBase: coerceFeeBase(raw.feeBase),
    committedCapital: nonNegative(raw.committedCapital),
    feeShares: sanitizeFeeShares(raw.feeShares),
  };
}

/**
 * The one question every future fee, hurdle, carry and net-returns code path
 * must ask before it does anything.
 */
export function isFundLayerActive(project: Pick<Project, 'fundTerms'> | null | undefined): boolean {
  return resolveFundTerms(project).enabled;
}

/** The storage shape written to the snapshot. */
export type FundTermsPatch = NonNullable<Project['fundTerms']>;

/** Resolved terms as the snapshot patch the store persists. `carryPct` is
 *  written alongside `performanceFeePct` so a Step 1 or Step 2 reader still
 *  finds the number where it expects it. */
export function toFundTermsPatch(t: FundTerms): FundTermsPatch {
  return {
    enabled: t.enabled,
    fundManagerName: t.fundManagerName,
    fundSize: t.fundSize,
    fundSizeOverride: t.fundSizeOverride,
    facilityLimit: t.facilityLimit,
    facilityLimitOverride: t.facilityLimitOverride,
    fundStructureFeePct: t.fundStructureFeePct,
    fundManagementFeePct: t.fundManagementFeePct,
    custodyAdminFeePct: t.custodyAdminFeePct,
    debtArrangingFeePct: t.debtArrangingFeePct,
    otherExpensesPerAnnum: t.otherExpensesPerAnnum,
    performanceFeePct: t.performanceFeePct,
    carryPct: t.performanceFeePct,
    hurdleRatePct: t.hurdleRatePct,
    feeDistribution: t.feeDistribution.map((r) => ({ ...r })),
    managementFeePct: t.managementFeePct,
    feeBase: t.feeBase,
    committedCapital: t.committedCapital,
    feeShares: t.feeShares.map((s) => ({ role: s.role, sharePct: s.sharePct })),
  };
}

// ── Database row mapping ───────────────────────────────────────────────────

/** The database row shape, snake_case, as stored in refm_fund_terms
 *  (migrations 208 + 209). Every 209 field is optional here, because the server
 *  falls back to the 208 column set when 209 has not been applied. */
export interface FundTermsRow {
  fund_enabled: boolean;
  management_fee_pct: number;
  fee_base: string;
  hurdle_rate_pct: number;
  carry_pct: number;
  committed_capital: number;
  fee_shares: unknown;
  // Migration 209
  fund_size?: number;
  facility_limit?: number;
  fund_structure_fee_pct?: number;
  fund_management_fee_pct?: number;
  custody_admin_fee_pct?: number;
  debt_arranging_fee_pct?: number;
  other_expenses_per_annum?: number;
  fee_distribution?: unknown;
  // Migration 210
  fund_manager_name?: string;
  facility_limit_override?: boolean;
  // Migration 211
  fund_size_override?: boolean;
}

export function fromRow(row: Partial<FundTermsRow> | null | undefined): FundTerms {
  if (!row) return freshDefaults();
  return {
    enabled: row.fund_enabled === true,
    fundManagerName: typeof row.fund_manager_name === 'string' && row.fund_manager_name.trim() ? row.fund_manager_name.trim() : DEFAULT_FUND_MANAGER_NAME,
    // Key order deliberately matches the FundTerms interface and
    // DEFAULT_FUND_TERMS, because verify-fund-terms compares the row and
    // snapshot round trips with JSON.stringify, which is order sensitive.
    fundSize: nonNegative(row.fund_size),
    fundSizeOverride: row.fund_size_override === true,
    facilityLimit: nonNegative(row.facility_limit),
    facilityLimitOverride: row.facility_limit_override === true,
    fundStructureFeePct: clamp01(row.fund_structure_fee_pct),
    fundManagementFeePct: clamp01(row.fund_management_fee_pct),
    custodyAdminFeePct: clamp01(row.custody_admin_fee_pct),
    debtArrangingFeePct: clamp01(row.debt_arranging_fee_pct),
    otherExpensesPerAnnum: nonNegative(row.other_expenses_per_annum),
    performanceFeePct: clamp01(row.carry_pct),
    hurdleRatePct: clamp01(row.hurdle_rate_pct),
    feeDistribution: sanitizeFeeDistribution(row.fee_distribution),
    managementFeePct: clamp01(row.management_fee_pct),
    feeBase: coerceFeeBase(row.fee_base),
    committedCapital: nonNegative(row.committed_capital),
    feeShares: sanitizeFeeShares(row.fee_shares),
  };
}

/** Resolved terms to the FULL row shape (migrations 208 + 209). */
export function toRow(t: FundTerms): Required<FundTermsRow> {
  return {
    fund_enabled: t.enabled,
    management_fee_pct: t.managementFeePct,
    fee_base: t.feeBase,
    hurdle_rate_pct: t.hurdleRatePct,
    carry_pct: t.performanceFeePct,
    committed_capital: t.committedCapital,
    fee_shares: t.feeShares,
    fund_size: t.fundSize,
    fund_size_override: t.fundSizeOverride,
    facility_limit: t.facilityLimit,
    fund_structure_fee_pct: t.fundStructureFeePct,
    fund_management_fee_pct: t.fundManagementFeePct,
    custody_admin_fee_pct: t.custodyAdminFeePct,
    debt_arranging_fee_pct: t.debtArrangingFeePct,
    other_expenses_per_annum: t.otherExpensesPerAnnum,
    fee_distribution: t.feeDistribution,
    fund_manager_name: t.fundManagerName,
    facility_limit_override: t.facilityLimitOverride,
  };
}

/** The migrations 208 + 209 + 210 subset, for a database where 211 is not
 *  applied. The fund-size override still rides in the version snapshot, which
 *  is what the engine reads. */
export function toRow210(t: FundTerms): FundTermsRow {
  const row: Record<string, unknown> = { ...toRow(t) };
  delete row.fund_size_override;
  return row as unknown as FundTermsRow;
}

/** The migrations 208 + 209 subset, for a database where 210 is not applied.
 *  The Fund Manager name and the override flag still ride in the version
 *  snapshot, which is what the engine reads. */
export function toRow209(t: FundTerms): FundTermsRow {
  const row: Record<string, unknown> = { ...toRow(t) };
  delete row.fund_manager_name;
  delete row.facility_limit_override;
  delete row.fund_size_override;
  return row as unknown as FundTermsRow;
}

/** The migration-208 subset, for a database where 209 is not applied yet. The
 *  new fields simply do not persist to the table; they still ride in the
 *  version snapshot, which is what the engine reads. */
export function toLegacyRow(t: FundTerms): FundTermsRow {
  return {
    fund_enabled: t.enabled,
    management_fee_pct: t.managementFeePct,
    fee_base: t.feeBase,
    hurdle_rate_pct: t.hurdleRatePct,
    carry_pct: t.performanceFeePct,
    committed_capital: t.committedCapital,
    fee_shares: t.feeShares,
  };
}
