import type { ProjectFinancingConfig } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import type { CapexAggregate, FundingRequirement } from './types';

/**
 * Per-period funding-gap series feeding Methods 2 + 3.
 *
 * These are derived from the post-revenue / post-opex snapshot
 * (computeFundingGap in financials-resolvers) and passed in here so the
 * core financing engine stays free of any revenue / FS dependency.
 *   method2PerPeriod = Net Funding Requirement = MAX(0, capex − pre-sales)
 *   method3PerPeriod = Cash Deficit = MAX(0, minCash − cash available)
 */
export interface FundingGapInputs {
  method2PerPeriod: number[];
  method3PerPeriod: number[];
}

/** Normalise a debt / equity pair to percentages summing to 100 (default 70/30). */
function ratioFractions(
  debtPctRaw: number | undefined,
  equityPctRaw: number | undefined,
): { debtPct: number; equityPct: number } {
  const d = Math.max(0, debtPctRaw ?? 0);
  const e = Math.max(0, equityPctRaw ?? 0);
  const sum = d + e;
  if (sum <= 0) return { debtPct: 70, equityPct: 30 };
  return { debtPct: (d / sum) * 100, equityPct: (e / sum) * 100 };
}

/**
 * Funding Requirement table feed.
 *
 *   Method 1 (Fixed Debt-to-Equity Ratio): need = capex excl land in-kind.
 *     debtPct + equityPct come from fixedRatio config.
 *   Method 2 (Net Funding Requirement): need = capex less the pre-sales
 *     cash that funds it, summed period by period. debtPct + equityPct
 *     come from netFundingConfig. Sizes external funding to the GAP via
 *     the custom-curve path (so less debt than full capex).
 *   Method 3 (Cash Deficit Funding): period-by-period draw to maintain
 *     the minimum cash reserve. debtPct + equityPct come from
 *     cashDeficitConfig. The min-cash buffer is already absorbed in the
 *     deficit series, so it is NOT added again.
 *
 * Methods 2 + 3 require the per-period gap series (`gapInputs`); when it
 * is absent (e.g. the core engine called without snapshot context) they
 * fall back to 0 so the engine never blocks.
 *
 * Pass 26 (2026-05-14): Minimum Cash Reserve from financingConfig adds
 * a one-shot buffer on top of the selected method's curve, lumped at the
 * first non-zero capex period. Methods 1 + 2 + 4 add it explicitly;
 * Method 3 (Cash Deficit) absorbs it implicitly via the deficit calc.
 *
 * Funding-method fix (2026-06-01): Methods 2 + 3 now calculate (no longer
 * stubbed to 0), each method reads its OWN debt / equity ratio, and a
 * selected Method 2 / 3 sizes external funding to its gap series.
 *
 * `selected` mirrors the method the user picked in financingConfig.
 */
export function computeFundingRequirement(
  capex: CapexAggregate,
  financingConfig: ProjectFinancingConfig,
  gapInputs?: FundingGapInputs,
): FundingRequirement {
  const exclLandInKindByPeriod = capex.perPeriod.exclLandInKind;
  const N = exclLandInKindByPeriod.length;

  const pad = (arr: number[] | undefined): number[] => {
    const out = new Array<number>(N).fill(0);
    if (arr) for (let i = 0; i < N; i++) out[i] = Math.max(0, arr[i] ?? 0);
    return out;
  };
  const m2PerPeriod = pad(gapInputs?.method2PerPeriod);
  const m3PerPeriod = pad(gapInputs?.method3PerPeriod);

  const m1 = capex.totals.exclLandInKind;
  const m2 = m2PerPeriod.reduce((s, v) => s + v, 0);
  const m3 = m3PerPeriod.reduce((s, v) => s + v, 0);
  // Pass 30 (2026-05-14): Method 4 = user-specified Debt + Equity.
  const m4Cfg = financingConfig.fixedAmountConfig
    ?? { debtAmount: 0, equityAmount: 0, yoySchedule: [] };
  const m4DebtAmt = Math.max(0, m4Cfg.debtAmount ?? 0);
  const m4EquityAmt = Math.max(0, m4Cfg.equityAmount ?? 0);
  const m4 = m4DebtAmt + m4EquityAmt;

  const selectedMethodId = financingConfig.fundingMethod;
  const selected =
    selectedMethodId === 1 ? m1
    : selectedMethodId === 2 ? m2
    : selectedMethodId === 3 ? m3
    : m4;

  // debtPct / equityPct: each method reads its OWN ratio config.
  //   Method 1 -> fixedRatio
  //   Method 2 -> netFundingConfig
  //   Method 3 -> cashDeficitConfig
  //   Method 4 -> derived from the user-specified debt + equity amounts
  // so downstream consumers (parcel land split, IDC capitalisation) see a
  // meaningful ratio for whichever method is active.
  let debtPct: number;
  let equityPct: number;
  if (selectedMethodId === 4) {
    debtPct = m4 > 0 ? (m4DebtAmt / m4) * 100 : 0;
    equityPct = m4 > 0 ? (m4EquityAmt / m4) * 100 : 0;
  } else {
    const cfg =
      selectedMethodId === 2 ? financingConfig.netFundingConfig
      : selectedMethodId === 3 ? financingConfig.cashDeficitConfig
      : financingConfig.fixedRatio;
    const r = ratioFractions(cfg?.debtPct, cfg?.equityPct);
    debtPct = r.debtPct;
    equityPct = r.equityPct;
  }
  const debtFrac = debtPct / 100;
  const equityFrac = equityPct / 100;

  // Pass 30: Method 4 builds its per-period draw from the YoY schedule
  // (normalised to 100). Method 1 mirrors capex. Methods 2 + 3 mirror
  // their gap series and size external funding to the gap via the
  // custom-curve path (same mechanism Method 4 uses).
  let selectedByPeriod: number[];
  let customDebtByPeriod: number[] | undefined;
  let customEquityByPeriod: number[] | undefined;
  if (selectedMethodId === 1) {
    selectedByPeriod = exclLandInKindByPeriod.slice();
  } else if (selectedMethodId === 2 || selectedMethodId === 3) {
    // Methods 2 + 3 (Net Funding Requirement / Cash Deficit).
    //
    // GAP-SIZED (2026-06-01): when the per-period funding gap is fed
    // (gapInputs), external funding is sized to the NET requirement via the
    // custom path, split at this method's own ratio. Method 2 funds capex
    // net of pre-sales, Method 3 funds only the cash deficit to maintain
    // minimum cash. computeFinancialsSnapshot now feeds the gap (a guarded
    // two-pass), so the P&L / Cash Flow / Balance Sheet draw the gap-sized
    // amount, consistent with Module 1.
    //
    // FALLBACK: when no gap is fed (degenerate / direct core call), size
    // from CAPEX via the standard (non-custom) split so the statements are
    // never left unfunded. An all-zero custom curve would otherwise trip
    // useCustom in debtEquity.ts and zero all funding (the 2026-06-01
    // regression), so custom arrays are set ONLY when the gap is real.
    const gapForDisplay = selectedMethodId === 2 ? m2PerPeriod : m3PerPeriod;
    const gapTotal = selectedMethodId === 2 ? m2 : m3;
    if (gapInputs && gapTotal > 0) {
      selectedByPeriod = gapForDisplay.slice();
      customDebtByPeriod = gapForDisplay.map((v) => v * debtFrac);
      customEquityByPeriod = gapForDisplay.map((v) => v * equityFrac);
    } else {
      selectedByPeriod = exclLandInKindByPeriod.slice();
    }
  } else {
    const raw = m4Cfg.yoySchedule ?? [];
    const padded = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) padded[i] = Math.max(0, raw[i] ?? 0);
    const sumW = padded.reduce((s, v) => s + v, 0);
    const norm = sumW > 0 ? padded.map((v) => v / sumW) : padded.map(() => N > 0 ? 1 / N : 0);
    selectedByPeriod = norm.map((w) => w * m4);
    customDebtByPeriod = norm.map((w) => w * m4DebtAmt);
    customEquityByPeriod = norm.map((w) => w * m4EquityAmt);
  }

  // Min Cash Reserve buffer, lumped at the first non-zero capex period and
  // split at the project ratio by debtEquity.ts. Added on top for every
  // method EXCEPT Method 3 when it is gap-sized: the Method 3 cash-deficit
  // gap already funds up to the minimum cash reserve, so adding the buffer
  // again would double-count it.
  const minCashReserve = Math.max(0, financingConfig.minimumCashReserve ?? 0);
  const minCashByPeriod = new Array<number>(N).fill(0);
  const method3GapSized = selectedMethodId === 3 && !!gapInputs && m3 > 0;
  if (minCashReserve > 0 && N > 0 && !method3GapSized) {
    let firstCapexIdx = -1;
    for (let i = 0; i < N; i++) {
      if ((exclLandInKindByPeriod[i] ?? 0) > 0) { firstCapexIdx = i; break; }
    }
    minCashByPeriod[firstCapexIdx >= 0 ? firstCapexIdx : 0] = minCashReserve;
  }
  const totalFundingNeedByPeriod = selectedByPeriod.map((v, i) => v + (minCashByPeriod[i] ?? 0));
  const selectedWithMinCash = selected + (selectedMethodId === 3 ? 0 : minCashReserve);

  return {
    method1: m1,
    method2: m2,
    method3: m3,
    method4: m4,
    selected,
    selectedMethodId,
    debtPct,
    equityPct,
    minCashReserve,
    minCashByPeriod,
    selectedByPeriod,
    totalFundingNeedByPeriod,
    selectedWithMinCash,
    customDebtByPeriod,
    customEquityByPeriod,
  };
}
