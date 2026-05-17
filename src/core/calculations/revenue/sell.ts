import { applyIndexation } from './indexation';
import { distributeCashCollection } from './payment';
import { buildRecognition } from './recognition';
import { buildEscrowMovement } from './escrow';
import { buildCohortMatrix } from './cohort';
import type {
  AssetSellConfig,
  Cohort,
  RecognitionProfile,
  SellAssetResult,
  SellSubUnitConfig,
  SubUnitMaterial,
} from './types';

export interface ComputeSellInputs {
  config: AssetSellConfig;
  subUnits: SubUnitMaterial[];
  axisLength: number;
  handoverYear: number;
}

/**
 * Computes the full per-period Sell-asset revenue / cash / recognition
 * / escrow stream. Pure: no store reads, no IO. The caller is
 * responsible for translating M1 store rows into SubUnitMaterial and
 * for resolving the handover year from the asset's phase
 * (constructionStart + constructionPeriods - 1, or
 * config.handoverYearOverride when set).
 *
 * Cohorts (Pass 4): when config.cohorts is non-empty, each cohort runs
 * its own cash + recognition pipeline using its own per-sub-unit
 * velocity, optional price overrides, and optional profile overrides.
 * Asset-level escrow + indexation are shared. When config.cohorts is
 * absent or empty, the top-level config.subUnits + profiles act as a
 * single implicit cohort (Pass 3 path).
 *
 * Velocity cap is global across cohorts per sub-unit so that the
 * platform-wide invariant "no sub-unit oversells" holds even when
 * volume is split across many cohort launches.
 */
export function computeSellAsset(inputs: ComputeSellInputs): SellAssetResult {
  const { config, subUnits, axisLength, handoverYear } = inputs;
  const N = Math.max(0, axisLength);

  const cohorts: Cohort[] = config.cohorts && config.cohorts.length > 0
    ? config.cohorts
    : [{
        id: '__implicit__',
        name: 'Default',
        subUnits: config.subUnits,
      }];

  const presalesUnits = new Array<number>(N).fill(0);
  const presalesArea = new Array<number>(N).fill(0);
  const presalesRevenue = new Array<number>(N).fill(0);
  const postSalesUnits = new Array<number>(N).fill(0);
  const postSalesArea = new Array<number>(N).fill(0);
  const postSalesRevenue = new Array<number>(N).fill(0);
  const cashCollectedPresales = new Array<number>(N).fill(0);
  const recognitionPresales = new Array<number>(N).fill(0);

  // Cohort matrices (rows = sale year, cols = collection / recognition year)
  // aggregated across every cohort. Used by the UI to render the MAAD-style
  // vintage matrix on Tab 2 / Tab 4 outputs.
  const cashMatrix: number[][] = [];
  const recMatrix: number[][] = [];
  for (let i = 0; i < N; i++) { cashMatrix.push(new Array<number>(N).fill(0)); recMatrix.push(new Array<number>(N).fill(0)); }

  const cumulativeShareBySubUnit = new Map<string, number>();

  for (const cohort of cohorts) {
    const cohortCashProfile = cohort.cashPaymentProfile ?? config.cashPaymentProfile;
    const cohortRecProfile = cohort.recognitionProfile ?? config.recognitionProfile;
    const cohortPresalesRevenue = new Array<number>(N).fill(0);

    const subUnitConfigById = new Map<string, SellSubUnitConfig>(
      cohort.subUnits.map((s) => [s.subUnitId, s]),
    );

    for (const su of subUnits) {
      const cfg = subUnitConfigById.get(su.id);
      if (!cfg) continue;
      const totalArea = Math.max(0, su.area);
      const totalUnits = Math.max(0, su.count);
      const areaPerUnit = totalUnits > 0 ? totalArea / totalUnits : 0;
      const overridePrice = cohort.pricePerSubUnit?.[su.id];
      const baseRate = Math.max(0, overridePrice ?? su.ratePerArea);

      let cumShare = cumulativeShareBySubUnit.get(su.id) ?? 0;

      for (let yr = 0; yr < N; yr++) {
        const v = Math.max(0, cfg.preSalesVelocity[yr] ?? 0);
        if (v === 0) continue;
        const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
        cumShare += cappedV;
        const areaSold = totalArea * cappedV;
        const unitsSold = areaPerUnit > 0 ? areaSold / areaPerUnit : 0;
        const indexedRate = applyIndexation(baseRate, yr, config.indexation);
        const value = areaSold * indexedRate;
        presalesArea[yr] += areaSold;
        presalesUnits[yr] += unitsSold;
        presalesRevenue[yr] += value;
        cohortPresalesRevenue[yr] += value;
      }

      for (let yr = 0; yr < N; yr++) {
        const v = Math.max(0, cfg.postSalesVelocity[yr] ?? 0);
        if (v === 0) continue;
        const cappedV = Math.min(v, Math.max(0, 1 - cumShare));
        if (cappedV === 0) continue;
        cumShare += cappedV;
        const areaSold = totalArea * cappedV;
        const unitsSold = areaPerUnit > 0 ? areaSold / areaPerUnit : 0;
        const indexedRate = applyIndexation(baseRate, yr, config.indexation);
        const value = areaSold * indexedRate;
        postSalesArea[yr] += areaSold;
        postSalesUnits[yr] += unitsSold;
        postSalesRevenue[yr] += value;
      }

      cumulativeShareBySubUnit.set(su.id, cumShare);
    }

    const cohortCash = distributeCashCollection(cohortPresalesRevenue, cohortCashProfile, N);
    const cohortRec = buildRecognition(cohortPresalesRevenue, cohortRecProfile, handoverYear, N);
    for (let i = 0; i < N; i++) {
      cashCollectedPresales[i] += cohortCash[i];
      recognitionPresales[i] += cohortRec[i];
    }

    // Accumulate the cohort's contribution to the vintage matrices. Cash
    // re-uses the shared cohort engine directly. Recognition splits into
    // point-in-time (lump on diagonal at handover/sale year) vs over-time
    // (shared cohort engine on the over-time profile).
    const cashCohortMatrix = buildCohortMatrix(cohortPresalesRevenue, cohortCashProfile, N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cashMatrix[r][c] += cashCohortMatrix[r][c] ?? 0;

    const recCohortMatrix = buildRecognitionMatrix(cohortPresalesRevenue, cohortRecProfile, handoverYear, N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) recMatrix[r][c] += recCohortMatrix[r][c] ?? 0;
  }

  const cashCollected = cashCollectedPresales.map(
    (v, i) => v + (postSalesRevenue[i] ?? 0),
  );
  const recognition = recognitionPresales.map(
    (v, i) => v + (postSalesRevenue[i] ?? 0),
  );

  const escrow = buildEscrowMovement(cashCollectedPresales, config.escrow, N);
  const netCash = cashCollected.map((v, i) => v + (escrow.netAdjustment[i] ?? 0));

  return {
    assetId: config.assetId,
    axisLength: N,
    presalesUnitsPerPeriod: presalesUnits,
    presalesAreaPerPeriod: presalesArea,
    presalesRevenuePerPeriod: presalesRevenue,
    postSalesUnitsPerPeriod: postSalesUnits,
    postSalesAreaPerPeriod: postSalesArea,
    postSalesRevenuePerPeriod: postSalesRevenue,
    cashCollectedPerPeriod: cashCollected,
    recognitionPerPeriod: recognition,
    escrowHeldPerPeriod: escrow.held,
    escrowReleasedPerPeriod: escrow.released,
    escrowBalancePerPeriod: escrow.balance,
    netCashAvailablePerPeriod: netCash,
    presalesSalesValuePerPeriod: presalesRevenue.slice(),
    cashVintageMatrix: cashMatrix,
    recognitionVintageMatrix: recMatrix,
  };
}

/**
 * Recognition vintage matrix builder. PIT recognition lumps the full
 * cohort on a single column (handover year or sale year). Over-Time
 * recognition uses the shared cohort engine with the recognition profile.
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
