import { applyIndexation } from './indexation';
import { buildRecognition } from './recognition';
import { buildCohortMatrix, columnSums, type ProfileSpec } from './cohort';
import { buildSaleCohortProfile, resolveDownpayment, DEFAULT_INSTALMENT_YEARS } from './cohortTerms';
import type {
  AssetSellConfig,
  RecognitionProfile,
  SellAssetResult,
  SubUnitMaterial,
} from './types';

export interface ComputeSellInputs {
  config: AssetSellConfig;
  subUnits: SubUnitMaterial[];
  axisLength: number;
  handoverYear: number;
  /** Absolute project start year. Required for PIT 'custom' recognition
   *  mode so the engine can map pointInTimeCustomYear to a project-axis
   *  index. Optional for back-compat, when omitted, custom mode falls
   *  back to handover. (Pass 9g-H, 2026-05-18.) */
  projectStartYear?: number;
}

/**
 * Computes the full per-period Sell-asset revenue / cash / recognition
 * stream. Pure: no store reads, no IO. The caller is responsible for
 * translating M1 store rows into SubUnitMaterial and for resolving the
 * handover year from the asset's phase (constructionStart +
 * constructionPeriods - 1, or config.handoverYearOverride when set).
 *
 * ONE COHORT PER SALE YEAR (2026-08-19). Each carries its own payment
 * terms; see the sale cohort block below for the rule and why it replaced
 * the single shared cash payment profile.
 */
export function computeSellAsset(inputs: ComputeSellInputs): SellAssetResult {
  const { config, subUnits, axisLength, handoverYear, projectStartYear } = inputs;
  const N = Math.max(0, axisLength);

  const presalesUnits = new Array<number>(N).fill(0);
  const presalesArea = new Array<number>(N).fill(0);
  const presalesRevenue = new Array<number>(N).fill(0);
  const postSalesUnits = new Array<number>(N).fill(0);
  const postSalesArea = new Array<number>(N).fill(0);
  const postSalesRevenue = new Array<number>(N).fill(0);

  const presalesAreaPerSU: Record<string, number[]> = {};
  const presalesRevenuePerSU: Record<string, number[]> = {};
  const presalesUnitsPerSU: Record<string, number[]> = {};
  const postSalesAreaPerSU: Record<string, number[]> = {};
  const postSalesRevenuePerSU: Record<string, number[]> = {};
  const postSalesUnitsPerSU: Record<string, number[]> = {};

  const cumulativeShareBySubUnit = new Map<string, number>();
  const subUnitConfigById = new Map(config.subUnits.map((s) => [s.subUnitId, s]));

  for (const su of subUnits) {
    const cfg = subUnitConfigById.get(su.id);
    if (!cfg) continue;
    const totalArea = Math.max(0, su.area);
    const totalUnits = Math.max(0, su.count);
    const areaPerUnit = totalUnits > 0 ? totalArea / totalUnits : 0;
    const baseRate = Math.max(0, su.ratePerArea);

    const preAreaSU = presalesAreaPerSU[su.id] ?? new Array<number>(N).fill(0);
    const preRevSU = presalesRevenuePerSU[su.id] ?? new Array<number>(N).fill(0);
    const preUnitsSU = presalesUnitsPerSU[su.id] ?? new Array<number>(N).fill(0);
    const postAreaSU = postSalesAreaPerSU[su.id] ?? new Array<number>(N).fill(0);
    const postRevSU = postSalesRevenuePerSU[su.id] ?? new Array<number>(N).fill(0);
    const postUnitsSU = postSalesUnitsPerSU[su.id] ?? new Array<number>(N).fill(0);

    let cumShare = cumulativeShareBySubUnit.get(su.id) ?? 0;
    let soldArea = 0;
    let soldUnits = 0;

    // Pass 7j (2026-05-17): apply whole-unit YoY rounding on the sold
    // quantity BEFORE revenue is derived, so revenue is computed from
    // the rounded area / unit count instead of the raw velocity cap.
    // Units-metric sub-units round to whole units; sqm-metric round to
    // whole sqm. cumShare advances by the rounded share so subsequent
    // periods cap correctly against remaining unsold area.
    //
    // THE LAST STEP SELLS THE EXACT REMAINDER (2026-09-13, founder: "we need
    // to ensure 100% inventory sold"). Rounding every step to whole sqm or
    // whole units left the fraction of the inventory that no whole step could
    // reach (12,342.28 sqm sold 12,342 and carried 0.28 sqm for ever; a row of
    // 143.6 units kept 0.6 of one), so a schedule typed to 100% closed at
    // 99.99% and the closing inventory never read zero. When the step's share
    // reaches whatever is still unsold, it takes exactly that, unrounded, so
    // sold equals inventory to the last decimal. A schedule that stops short
    // of 100% still leaves the remainder unsold, which is what it says.
    // `exhaust` is decided on the TYPED schedule: once the typed velocities
    // reach 100%, this step takes whatever is still unsold, however the
    // earlier steps rounded. Deciding it on the rounded cumulative would miss
    // by the rounding itself (the earlier steps sold 6,171 of 6,171.14, so the
    // last 50% step saw 50.001% remaining and rounded again).
    let typedCumShare = 0;
    const stepRounded = (cappedV: number, exhaust: boolean): { roundedArea: number; roundedUnits: number; actualV: number } => {
      const remainingShare = Math.max(0, 1 - cumShare);
      if ((exhaust || cappedV >= remainingShare - 1e-9) && remainingShare > 0) {
        const roundedArea = Math.max(0, totalArea - soldArea);
        const roundedUnits = areaPerUnit > 0 ? Math.max(0, totalUnits - soldUnits) : 0;
        return { roundedArea, roundedUnits, actualV: remainingShare };
      }
      const targetArea = totalArea * cappedV;
      if (areaPerUnit > 0) {
        const roundedUnits = Math.round(targetArea / areaPerUnit);
        const roundedArea = roundedUnits * areaPerUnit;
        const actualV = totalArea > 0 ? roundedArea / totalArea : 0;
        return { roundedArea, roundedUnits, actualV };
      }
      const roundedArea = Math.round(targetArea);
      const actualV = totalArea > 0 ? roundedArea / totalArea : 0;
      return { roundedArea, roundedUnits: 0, actualV };
    };

    for (let yr = 0; yr < N; yr++) {
      const v = Math.max(0, cfg.preSalesVelocity[yr] ?? 0);
      if (v === 0) continue;
      typedCumShare += v;
      const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
      if (cappedV === 0) continue;
      const { roundedArea, roundedUnits, actualV } = stepRounded(cappedV, typedCumShare >= 1 - 1e-9);
      if (roundedArea === 0) continue;
      cumShare += actualV;
      soldArea += roundedArea;
      soldUnits += roundedUnits;
      const indexedRate = applyIndexation(baseRate, yr, config.indexation);
      const value = roundedArea * indexedRate;
      presalesArea[yr] += roundedArea;
      presalesUnits[yr] += roundedUnits;
      presalesRevenue[yr] += value;
      preAreaSU[yr] += roundedArea;
      preRevSU[yr] += value;
      preUnitsSU[yr] += roundedUnits;
    }

    for (let yr = 0; yr < N; yr++) {
      const v = Math.max(0, cfg.postSalesVelocity[yr] ?? 0);
      if (v === 0) continue;
      typedCumShare += v;
      const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
      if (cappedV === 0) continue;
      const { roundedArea, roundedUnits, actualV } = stepRounded(cappedV, typedCumShare >= 1 - 1e-9);
      if (roundedArea === 0) continue;
      cumShare += actualV;
      soldArea += roundedArea;
      soldUnits += roundedUnits;
      const indexedRate = applyIndexation(baseRate, yr, config.indexation);
      const value = roundedArea * indexedRate;
      postSalesArea[yr] += roundedArea;
      postSalesUnits[yr] += roundedUnits;
      postSalesRevenue[yr] += value;
      postAreaSU[yr] += roundedArea;
      postRevSU[yr] += value;
      postUnitsSU[yr] += roundedUnits;
    }

    presalesAreaPerSU[su.id] = preAreaSU;
    presalesRevenuePerSU[su.id] = preRevSU;
    presalesUnitsPerSU[su.id] = preUnitsSU;
    postSalesAreaPerSU[su.id] = postAreaSU;
    postSalesRevenuePerSU[su.id] = postRevSU;
    postSalesUnitsPerSU[su.id] = postUnitsSU;
    cumulativeShareBySubUnit.set(su.id, cumShare);
  }

  // ── SALE COHORT COLLECTIONS (2026-08-19, restructure Step 3) ──────────────
  //
  // EVERY SALE YEAR IS ITS OWN COHORT WITH ITS OWN TERMS. It pays a
  // downpayment in the year it sells and the balance in equal instalments over
  // the years that follow, and the run is cut short by handover, because a
  // buyer's payment plan ends when they get the keys. A cohort selling at or
  // after handover pays in full in its own year, which is the convention the
  // post-sales lines below have always used.
  //
  // This REPLACES `cashPaymentProfile` as the driver of pre-sales cash. That
  // profile was ONE schedule shared by every sale year, so a cohort selling in
  // year 1 and a cohort selling in year 4 were forced onto the same milestones.
  // There is now one payment rule, not two: `distributeCashCollection` is gone
  // rather than left reachable, and `cashPaymentProfile` is retained only so no
  // saved data is destroyed. The Module 2 screen and the exports say so.
  //
  // The rule itself lives in cohortTerms.ts and is shared with the screen, so
  // the terms a user reads and the terms the model applies are the same object.
  //
  // ONE MATRIX, not two. The vintage matrix used to be built separately from
  // the collections series, from the same profile, which is two chances to
  // answer one question. The series is now the matrix's column sums, so they
  // cannot disagree.
  const cohortProfileFor = (saleYear: number): ProfileSpec => buildSaleCohortProfile({
    saleYear,
    handoverYear,
    downpayment: resolveDownpayment(config.downpayment, saleYear).value,
    instalmentYearsAllowed: config.maxInstalmentYears ?? DEFAULT_INSTALMENT_YEARS,
    // Absent means the hard cut-off, which is the reference model's behaviour.
    stopAtHandover: config.instalmentsStopAtHandover ?? true,
  });
  const cashVintageMatrix = buildCohortMatrix(presalesRevenue, cohortProfileFor, N);
  const cashCollectedPresales = columnSums(cashVintageMatrix, N);
  const recognitionPresales = buildRecognition(presalesRevenue, config.recognitionProfile, handoverYear, N, projectStartYear);

  // Pass 7f (2026-05-17): post-sales convention. Post-handover sales
  // collect and recognize in the same period (operating sales, no
  // milestone schedule). Pre + post components sum to the aggregate.
  const postSalesCash = postSalesRevenue.slice();
  const postSalesRecognition = postSalesRevenue.slice();
  const cashCollected = cashCollectedPresales.map((v, i) => v + (postSalesCash[i] ?? 0));
  const recognition = recognitionPresales.map((v, i) => v + (postSalesRecognition[i] ?? 0));

  const recognitionVintageMatrix = buildRecognitionMatrix(presalesRevenue, config.recognitionProfile, handoverYear, N);

  return {
    assetId: config.assetId,
    axisLength: N,
    presalesUnitsPerPeriod: presalesUnits,
    presalesAreaPerPeriod: presalesArea,
    presalesRevenuePerPeriod: presalesRevenue,
    postSalesUnitsPerPeriod: postSalesUnits,
    postSalesAreaPerPeriod: postSalesArea,
    postSalesRevenuePerPeriod: postSalesRevenue,
    presalesAreaPerPeriodPerSubUnit: presalesAreaPerSU,
    presalesRevenuePerPeriodPerSubUnit: presalesRevenuePerSU,
    presalesUnitsPerPeriodPerSubUnit: presalesUnitsPerSU,
    postSalesAreaPerPeriodPerSubUnit: postSalesAreaPerSU,
    postSalesRevenuePerPeriodPerSubUnit: postSalesRevenuePerSU,
    postSalesUnitsPerPeriodPerSubUnit: postSalesUnitsPerSU,
    cashCollectedPerPeriod: cashCollected,
    presalesCashPerPeriod: cashCollectedPresales,
    postSalesCashPerPeriod: postSalesCash,
    recognitionPerPeriod: recognition,
    presalesRecognitionPerPeriod: recognitionPresales,
    postSalesRecognitionPerPeriod: postSalesRecognition,
    presalesSalesValuePerPeriod: presalesRevenue.slice(),
    cashVintageMatrix,
    recognitionVintageMatrix,
  };
}

/**
 * Recognition vintage matrix builder. PIT lumps cohort on a single
 * column (handover or sale year). Over-Time uses the shared cohort
 * engine with the recognition profile.
 */
function buildRecognitionMatrix(
  salesValuePerYear: number[],
  profile: RecognitionProfile,
  handoverYear: number,
  axisLength: number,
): number[][] {
  const N = Math.max(0, axisLength);
  const out: number[][] = [];
  for (let i = 0; i < N; i++) out.push(new Array<number>(N).fill(0));

  if (profile.method === 'point_in_time') {
    const anchor = profile.pointInTimeYear ?? 'handover';
    for (let saleYear = 0; saleYear < N; saleYear++) {
      const v = Math.max(0, salesValuePerYear[saleYear] ?? 0);
      if (v === 0) continue;
      const target = anchor === 'handover'
        ? Math.max(0, Math.min(N - 1, handoverYear))
        : saleYear;
      out[saleYear][target] += v;
    }
    return out;
  }

  return buildCohortMatrix(
    salesValuePerYear,
    { percentages: profile.percentages ?? [], positions: profile.positions, profileMode: profile.profileMode },
    N,
  );
}

export function resolveHandoverYear(
  axisLength: number,
  phaseStartYear: number,
  phaseConstructionPeriods: number,
  projectStartYear: number,
  override?: number,
): number {
  if (override != null && Number.isFinite(override)) return Math.max(0, Math.min(axisLength - 1, override));
  const handoverAbsYear = phaseStartYear + Math.max(0, phaseConstructionPeriods - 1);
  return Math.max(0, Math.min(axisLength - 1, handoverAbsYear - projectStartYear));
}
