/**
 * Revenue resolvers.
 *
 * Bridge between the M1 Zustand store (project / phases / assets /
 * subUnits / costLines / costOverrides / parcelFunding / land mode) and
 * the pure revenue engine in src/core/calculations/revenue.
 *
 * Two responsibilities:
 *   1. computeAllSellResults(state) -> Map of every Sell-strategy
 *      asset's per-period revenue / cash / recognition / escrow stream.
 *   2. computeAssetScheduleBundle(result) -> that asset's AR + Unearned
 *      roll-forwards.
 *
 * COST OF SALES IS NOT HERE. It is assembled once, in ./costOfSales, which
 * needs the per-period capex as well as the total and the IDC on top of both.
 *
 * Engine helpers stay pure; the bridge stays here so the engine never
 * imports from src/hubs (matches the M1.7 resolver pattern).
 */

import { isRetailCompanion } from '@/src/core/calculations/retailCompanion';
import { buildEngineDownpaymentAxis } from './state/saleCohortResolution';
import {
  computeProjectTimeline,
  computeSubUnitArea,
  resolveSubUnitMetric,
  keysFromArea,
  isRevenueSubUnit,
} from '@/src/core/calculations';
import { resolveAvgUnitSize, type AssetTypeValues } from './state/assetTypeStandards';
import { type CollectionsSource } from '@/src/core/calculations/capexPhasing';
import {
  computeSellAsset,
  computeHospitalityAsset,
  computeLeaseAsset,
  resolveHandoverYear,
  buildAccountsReceivable,
  buildUnearnedRevenue,
  type AssetSellConfig,
  type CashPaymentProfile,
  type HospitalityAssetResult,
  type HospitalityConfig,
  type IndexationConfig,
  type LeaseAssetResult,
  type LeaseConfig,
  type RecognitionProfile,
  type SellAssetResult,
  type SubUnitMaterial,
  type AccountsReceivableResult,
  type UnearnedRevenueResult,
} from '@/src/core/calculations/revenue';
import type { Module1Store } from './state/module1-store';
import type { Asset, Phase, Project, SubUnit } from './state/module1-types';

/**
 * Default Sell asset seed used when fields are missing on a fresh
 * asset. Pass 7g (2026-05-17) removed the project-wide template; each
 * asset owns its own cash + recognition + indexation. The DEFAULT_*
 * objects below are the empty / "no schedule" baselines that the
 * resolver returns when the asset hasn't been edited yet.
 *
 * Exported because the Output tab uses them as render fallbacks when
 * the user hasn't filled a profile yet.
 */
const DEFAULT_CASH_PROFILE: CashPaymentProfile = { percentages: [], profileMode: 'absolute_with_catchup' };
const DEFAULT_RECOGNITION_PROFILE: RecognitionProfile = { method: 'point_in_time', pointInTimeYear: 'handover' };
const DEFAULT_INDEXATION: IndexationConfig = { method: 'none' };
export const DEFAULT_SELL_TEMPLATE = {
  cashPaymentProfile: DEFAULT_CASH_PROFILE,
  recognitionProfile: DEFAULT_RECOGNITION_PROFILE,
  indexation: DEFAULT_INDEXATION,
} as const;

// ────────────────────────────────────────────────────────────────────
// M4 Pass 2h (2026-05-20): expansion helpers.
// Engine types still expect project-axis-indexed arrays. Storage uses
// phase-local (ByPhase) or year-keyed (ByYear) shapes. These helpers
// expand the storage shape into axis arrays before the engine sees them.
// New ByPhase / ByYear fields are preferred; legacy axis-indexed arrays
// are read as a fallback so back-compat is preserved for any snapshot
// that hasn't yet been touched by the hydration migration.
// ────────────────────────────────────────────────────────────────────

export function expandPhaseLocalToAxis(
  byPhase: number[] | undefined,
  legacy: number[] | undefined,
  phaseOffset: number,
  axisLength: number,
): number[] {
  const N = Math.max(0, axisLength);
  const out = new Array<number>(N).fill(0);
  // M2 Fix (2026-05-20): byPhase authoritative WHERE IT COVERS, legacy
  // fills the indices it doesn't cover.
  //
  // Problem: several operate / lease setters write ONLY to the legacy
  // axis-indexed field (occupancyPerPeriod, keysParticipationProfile,
  // F&B arrays). The hydration migration seeded byPhase from legacy
  // once, after which the engine started reading byPhase exclusively.
  // If the project axis later extended (new phase added, operations
  // years increased), byPhase stayed one or more entries short of the
  // new axis, producing 0 at the last operations year(s) even though
  // the user-facing UI showed an occupancy value (read from legacy).
  //
  // Merge rule:
  //   1. Apply byPhase at its phase-local indices (authoritative
  //      where it has an entry).
  //   2. For any axis index NOT covered by a byPhase entry, fall back
  //      to legacy.
  //
  // This preserves byPhase as the source of truth where it carries
  // data (phase-date preservation still works), while letting legacy
  // fill axis tails it doesn't reach.
  if (byPhase !== undefined) {
    for (let i = 0; i < byPhase.length; i++) {
      const axisIdx = phaseOffset + i;
      if (axisIdx >= 0 && axisIdx < N) out[axisIdx] = byPhase[i] ?? 0;
    }
    if (Array.isArray(legacy)) {
      for (let i = 0; i < Math.min(legacy.length, N); i++) {
        const phaseLocalIdx = i - phaseOffset;
        const coveredByByPhase = phaseLocalIdx >= 0 && phaseLocalIdx < byPhase.length;
        if (!coveredByByPhase) out[i] = legacy[i] ?? 0;
      }
    }
    return out;
  }
  if (Array.isArray(legacy)) {
    for (let i = 0; i < Math.min(legacy.length, N); i++) out[i] = legacy[i] ?? 0;
  }
  return out;
}

export function expandYearKeyedToAxis(
  byYear: Record<string, number> | undefined,
  legacy: number[] | undefined,
  projectStartYear: number,
  axisLength: number,
): number[] {
  const N = Math.max(0, axisLength);
  const out = new Array<number>(N).fill(0);
  if (byYear !== undefined) {
    for (let i = 0; i < N; i++) {
      const v = byYear[String(projectStartYear + i)] ?? 0;
      out[i] = v;
    }
    return out;
  }
  if (Array.isArray(legacy)) {
    for (let i = 0; i < Math.min(legacy.length, N); i++) out[i] = legacy[i] ?? 0;
  }
  return out;
}

/** Indexation config helper: returns a new IndexationConfig where
 *  growthPerPeriod is the expanded axis-indexed array. Preserves all
 *  other fields (method, rate, startYear, steps). */
function expandIndexationToAxis(
  ix: IndexationConfig | undefined,
  byPhase: number[] | undefined,
  phaseOffset: number,
  axisLength: number,
): IndexationConfig {
  if (!ix) return { method: 'none' };
  if (ix.method !== 'yoy_per_period') return ix;
  const growthPerPeriod = expandPhaseLocalToAxis(byPhase, ix.growthPerPeriod, phaseOffset, axisLength);
  return { ...ix, growthPerPeriod };
}

function expandIndexationFromYearKeyed(
  ix: IndexationConfig | undefined,
  byYear: Record<string, number> | undefined,
  projectStartYear: number,
  axisLength: number,
): IndexationConfig {
  if (!ix) return { method: 'none' };
  if (ix.method !== 'yoy_per_period') return ix;
  const growthPerPeriod = expandYearKeyedToAxis(byYear, ix.growthPerPeriod, projectStartYear, axisLength);
  return { ...ix, growthPerPeriod };
}

/**
 * Build an AssetSellConfig for the engine. Pass 7g: reads cash +
 * recognition + indexation directly from the asset; defaults fill
 * unset fields. No project-level template, no override flag.
 */
export function resolveSellConfig(asset: Asset, _project: Project): AssetSellConfig | null {
  const cfg = asset.revenue?.sell;
  if (!cfg) return null;
  // SPREAD FIRST, then default the fields that need a default. This used to be
  // a field list, which is the shape recorded in docs/TRAPS.md 7.16: a rebuild
  // that enumerates what it keeps silently drops everything it does not name,
  // and it is the THIRD instance of that shape on this one path (the legacy
  // migration and the Module 2 Revenue sell rebuild were the other two).
  //
  // Found on 2026-08-19 by sabotage: a test that made the engine read a new
  // sale cohort field and move real money still passed, because this function
  // had already dropped the field on the way in. That is worse than a wrong
  // number, because it makes the wrongness untestable.
  //
  // No behaviour changes here: everything this now carries through is read by
  // nothing today. It means Step 3 of the sale cohort restructure has a config
  // that already carries its inputs, rather than a fourth name to remember.
  return {
    ...cfg,
    assetId: asset.id,
    subUnits: cfg.subUnits,
    cashPaymentProfile: cfg.cashPaymentProfile ?? DEFAULT_CASH_PROFILE,
    recognitionProfile: cfg.recognitionProfile ?? DEFAULT_RECOGNITION_PROFILE,
    indexation: cfg.indexation ?? DEFAULT_INDEXATION,
    handoverYearOverride: cfg.handoverYearOverride,
  };
}

/**
 * Pass 8b (2026-05-18): build a HospitalityConfig for the engine.
 * Reads asset.revenue.operate + sums keys across sub-units where
 * metric='units'. Operations window comes from the asset's phase
 * (operationsStart..operationsEnd, inclusive). Returns null when the
 * asset has no operate config yet.
 */
export function resolveHospitalityConfig(
  asset: Asset,
  phase: Phase,
  subUnits: SubUnit[],
  projectStartYear: number,
  axisLength: number,
  /** The project's values for the asset's type (tab 4), so a row still stated
   *  in sqm can be read as keys through the type's unit size. Absent, an area
   *  row counts no keys. */
  typeValues?: AssetTypeValues,
): HospitalityConfig | null {
  const cfg = asset.revenue?.operate;
  if (!cfg) return null;
  // THE ROWS REVENUE PRICES: the asset's, less Support (2026-09-13). The
  // metric is the ASSET's where it states one (docs/TRAPS.md 7.32); this
  // filter read the ROW's, so a keys row stored as 'area' under a hotel that
  // counts keys was dropped and the hotel had no rooms.
  const assetSubUnits = subUnits.filter((u) => u.assetId === asset.id && isRevenueSubUnit(u));
  // KEYS PER ROW. A count row IS the keys (rounded: keys are whole). An AREA
  // row under a hospitality asset holds keys the way Table 5 seeds them,
  // area over the unit size, resolved sub-units first and the type second
  // by the one rule tab 4 states; with no size to divide by it holds none,
  // and the card says so rather than inventing a hotel.
  const unitSize = resolveAvgUnitSize(assetSubUnits.map((u) => u.unitArea), typeValues).value;
  const keysOf = (u: SubUnit): number => resolveSubUnitMetric(u, asset) === 'units'
    ? Math.max(0, Math.round(u.metricValue))
    : keysFromArea(computeSubUnitArea(u, asset), unitSize);
  const keys = assetSubUnits.reduce((s, u) => s + keysOf(u), 0);
  const phaseStartYear = phase.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const op = Math.max(0, phase.operationsPeriods ?? 0);
  const overlap = Math.max(0, phase.overlapPeriods ?? 0);
  const constructionStartIdx = Math.max(0, Math.min(axisLength - 1, phaseStartYear - projectStartYear));
  const handoverYear = Math.max(constructionStartIdx, Math.min(axisLength - 1, constructionStartIdx + cp - 1));
  // Pass 9e (2026-05-18): operations can begin mid-construction when
  // the user sets operationsStartYearOverride. Default is the legacy
  // "after handover" rule (handoverYear + 1 - overlap). Override is
  // clamped to [constructionStartIdx, axisLength - 1].
  const defaultOpsStartIdx = Math.max(constructionStartIdx, Math.min(axisLength - 1, handoverYear + 1 - overlap));
  const opsStartIdx = cfg.operationsStartYearOverride != null
    ? Math.max(constructionStartIdx, Math.min(axisLength - 1, cfg.operationsStartYearOverride - projectStartYear))
    : defaultOpsStartIdx;
  // Pass 9e-8 (2026-05-18): ops end stays anchored to the phase's
  // calendar end (defaultOpsStartIdx + op - 1) so that pulling the
  // start FORWARD via the override doesn't lop a year off the end.
  // Without this, override to last-construction-year shortened the
  // window from 2030..2039 to 2029..2038.
  const opsEndIdx = Math.max(opsStartIdx, Math.min(axisLength - 1, defaultOpsStartIdx + op - 1));

  // Pass 9c (2026-05-18): per-sub-unit ADR resolution. Each
  // metric='units' sub-unit becomes a HospitalitySubUnitConfig with
  // its own keys + startingADR. Asset-level cfg.startingADR remains
  // the default when a sub-unit hasn't been edited (SubUnit.startingAdr
  // is undefined). Indexation override comes from the optional
  // SubUnit.hospitalityIndexation field; when absent the engine falls
  // back to asset-level adrIndexation.
  // Pass 9e-10 (2026-05-18): for pure Operate assets (Hotel 01 etc.)
  // the M1 sub-unit row writes ADR to `unitPrice`, not `startingAdr`
  // (the latter is the dedicated input only on companion mirror
  // rows). Fall back through both fields so the engine sees the ADR
  // the user actually entered, matching the sub-unit chip strip which
  // already does the same fallback.
  const hospSubUnits: HospitalityConfig['subUnits'] = assetSubUnits
    .map((u) => ({
      id: u.id,
      keys: keysOf(u),
      startingADR: u.startingAdr ?? u.unitPrice ?? cfg.startingADR ?? 0,
      adrIndexation: u.hospitalityIndexation,
    }));

  // M4 Pass 2h: expand phase-local arrays into project-axis arrays.
  const phaseOffset = phaseStartYear - projectStartYear;

  // Rental pool participation: manual %-per-period profile, decimal
  // 0..1. Empty / undefined => engine uses full keys (no scaling).
  let keysParticipationPerPeriod: number[] | undefined;
  const kppExpanded = cfg.keysParticipationProfileByPhase !== undefined || cfg.keysParticipationProfile !== undefined
    ? expandPhaseLocalToAxis(cfg.keysParticipationProfileByPhase, cfg.keysParticipationProfile, phaseOffset, axisLength)
    : undefined;
  if (kppExpanded !== undefined) {
    keysParticipationPerPeriod = kppExpanded.map((v) => Math.max(0, Math.min(1, v)));
  }

  // F&B array variants (when stored as array, not scalar) and indexation.
  const fbExpanded: HospitalityConfig['fb'] = {
    mode: cfg.fb.mode,
    percentOfRooms: cfg.fb.percentOfRoomsByPhase !== undefined
      ? expandPhaseLocalToAxis(cfg.fb.percentOfRoomsByPhase, Array.isArray(cfg.fb.percentOfRooms) ? cfg.fb.percentOfRooms : undefined, phaseOffset, axisLength)
      : cfg.fb.percentOfRooms,
    ratePerGuest: cfg.fb.ratePerGuestByPhase !== undefined
      ? expandPhaseLocalToAxis(cfg.fb.ratePerGuestByPhase, Array.isArray(cfg.fb.ratePerGuest) ? cfg.fb.ratePerGuest : undefined, phaseOffset, axisLength)
      : cfg.fb.ratePerGuest,
    fixedAmountPerPeriod: cfg.fb.fixedAmountPerPeriodByPhase !== undefined
      ? expandPhaseLocalToAxis(cfg.fb.fixedAmountPerPeriodByPhase, Array.isArray(cfg.fb.fixedAmountPerPeriod) ? cfg.fb.fixedAmountPerPeriod : undefined, phaseOffset, axisLength)
      : cfg.fb.fixedAmountPerPeriod,
    indexation: expandIndexationToAxis(cfg.fb.indexation, cfg.fb.indexation?.growthPerPeriodByPhase, phaseOffset, axisLength),
  };
  const orExpanded: HospitalityConfig['otherRevenue'] = {
    mode: cfg.otherRevenue.mode,
    percentOfRooms: cfg.otherRevenue.percentOfRoomsByPhase !== undefined
      ? expandPhaseLocalToAxis(cfg.otherRevenue.percentOfRoomsByPhase, Array.isArray(cfg.otherRevenue.percentOfRooms) ? cfg.otherRevenue.percentOfRooms : undefined, phaseOffset, axisLength)
      : cfg.otherRevenue.percentOfRooms,
    ratePerGuest: cfg.otherRevenue.ratePerGuestByPhase !== undefined
      ? expandPhaseLocalToAxis(cfg.otherRevenue.ratePerGuestByPhase, Array.isArray(cfg.otherRevenue.ratePerGuest) ? cfg.otherRevenue.ratePerGuest : undefined, phaseOffset, axisLength)
      : cfg.otherRevenue.ratePerGuest,
    fixedAmountPerPeriod: cfg.otherRevenue.fixedAmountPerPeriodByPhase !== undefined
      ? expandPhaseLocalToAxis(cfg.otherRevenue.fixedAmountPerPeriodByPhase, Array.isArray(cfg.otherRevenue.fixedAmountPerPeriod) ? cfg.otherRevenue.fixedAmountPerPeriod : undefined, phaseOffset, axisLength)
      : cfg.otherRevenue.fixedAmountPerPeriod,
    indexation: expandIndexationToAxis(cfg.otherRevenue.indexation, cfg.otherRevenue.indexation?.growthPerPeriodByPhase, phaseOffset, axisLength),
  };

  return {
    assetId: asset.id,
    subUnits: hospSubUnits,
    keys,
    daysPerYear: cfg.daysPerYear ?? 365,
    // Pass 9b (2026-05-18): defensive ?? 0 fallback so undefined or
    // missing startingADR doesn't propagate into Math.max(0, undefined)
    // → NaN downstream. Old snapshots written before Pass 8b may have
    // operate.startingADR === undefined when the user touched a
    // non-ADR field first; cfg.startingADR is undefined in that case.
    startingADR: cfg.startingADR ?? 0,
    adrIndexation: expandIndexationToAxis(cfg.adrIndexation, cfg.adrIndexation?.growthPerPeriodByPhase, phaseOffset, axisLength),
    occupancyPerPeriod: expandPhaseLocalToAxis(cfg.occupancyPerPeriodByPhase, cfg.occupancyPerPeriod, phaseOffset, axisLength),
    guestsPerOccupiedRoom: cfg.guestsPerOccupiedRoom ?? 1.5,
    fb: fbExpanded,
    otherRevenue: orExpanded,
    opsStartIdx,
    opsEndIdx,
    keysParticipationPerPeriod,
  };
}

/**
 * Pass 9g (2026-05-18): build a LeaseConfig for the engine. Reads
 * asset.revenue.lease + sums GLA across sub-units where metric='area'.
 * Per-sub-unit base rates come from M1 SubUnit.unitPrice (acts as the
 * "rate per sqm per year" entry for lease assets). Operations window
 * comes from the asset's phase. Returns null when the asset has no
 * lease config yet.
 */
export function resolveLeaseConfig(
  asset: Asset,
  phase: Phase,
  subUnits: SubUnit[],
  projectStartYear: number,
  axisLength: number,
): LeaseConfig | null {
  const cfg = asset.revenue?.lease;
  if (!cfg) return null;
  // THE ROWS REVENUE PRICES: the asset's, less Support (2026-09-13). GLA is
  // each row's AREA by the one rule (`computeSubUnitArea`, the ASSET's metric
  // where it states one, docs/TRAPS.md 7.32), so a row counted in units under
  // a Lease asset leases count x unit size rather than being dropped, and a
  // derived support row never reads as leasable. Fractional areas are kept
  // (sqm is a continuous measure unlike hospitality keys).
  const assetSubUnits = subUnits.filter((u) => u.assetId === asset.id && isRevenueSubUnit(u));
  const totalGla = assetSubUnits.reduce((s, u) => s + computeSubUnitArea(u, asset), 0);
  const phaseStartYear = phase.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const op = Math.max(0, phase.operationsPeriods ?? 0);
  const overlap = Math.max(0, phase.overlapPeriods ?? 0);
  const constructionStartIdx = Math.max(0, Math.min(axisLength - 1, phaseStartYear - projectStartYear));
  const handoverYear = Math.max(constructionStartIdx, Math.min(axisLength - 1, constructionStartIdx + cp - 1));
  const defaultOpsStartIdx = Math.max(constructionStartIdx, Math.min(axisLength - 1, handoverYear + 1 - overlap));
  const opsStartIdx = cfg.operationsStartYearOverride != null
    ? Math.max(constructionStartIdx, Math.min(axisLength - 1, cfg.operationsStartYearOverride - projectStartYear))
    : defaultOpsStartIdx;
  // Ops end stays anchored to the phase calendar end so pulling start
  // forward never lops a year off. Mirrors the hospitality resolver.
  const opsEndIdx = Math.max(opsStartIdx, Math.min(axisLength - 1, defaultOpsStartIdx + op - 1));

  // Per-sub-unit lease rows: each metric='area' sub-unit becomes a
  // LeaseSubUnitConfig with its own GLA + base rate. Asset-level
  // cfg.baseRate is the fallback when a sub-unit has no unitPrice set.
  const leaseSubUnits: LeaseConfig['subUnits'] = assetSubUnits
    .map((u) => ({
      id: u.id,
      gla: computeSubUnitArea(u, asset),
      baseRate: u.unitPrice > 0 ? u.unitPrice : (cfg.baseRate ?? 0),
    }));

  // M4 Pass 2h: expand phase-local arrays.
  const phaseOffset = phaseStartYear - projectStartYear;

  return {
    assetId: asset.id,
    subUnits: leaseSubUnits,
    gla: totalGla,
    baseRate: cfg.baseRate ?? 0,
    rentIndexation: expandIndexationToAxis(cfg.rentIndexation, cfg.rentIndexation?.growthPerPeriodByPhase, phaseOffset, axisLength),
    occupancyPerPeriod: expandPhaseLocalToAxis(cfg.occupancyPerPeriodByPhase, cfg.occupancyPerPeriod, phaseOffset, axisLength),
    opsStartIdx,
    opsEndIdx,
    arDays: cfg.arDays ?? 30,
  };
}

/**
 * Pass 9g-G (2026-05-18): builds the LITERAL recognition profile %
 * stream on the project axis (moved from Module2CostOfSales so the
 * Schedules summary feed can use the same computation). Matches the
 * values the user entered in Revenue Inputs (e.g. [2%, 22%, 42%, 35%]
 * at construction periods).
 *
 * Modes:
 *   - 'absolute_with_catchup' (default): pct[k] lands at axis index
 *     positions[k] (defaults to k). Out-of-axis pct collapses to
 *     handover year so a profile running past the axis still sums to
 *     100%.
 *   - 'point_in_time': 100% at handover year.
 *   - 'relative_to_sale': can't be flattened to a project-axis profile
 *     without a single sale year, falls back to the cohort-weighted
 *     derivedFallback stream.
 */
export function resolveLiteralRecognitionProfile(
  asset: Asset,
  phase: Phase | undefined,
  projectStartYear: number,
  axisLength: number,
  derivedFallback: number[],
): { profile: number[]; mode: 'literal' | 'derived' } {
  const N = Math.max(0, axisLength);
  const out = new Array<number>(N).fill(0);
  const sellCfg = asset.revenue?.sell;
  if (!sellCfg || !phase) return { profile: derivedFallback.slice(0, N), mode: 'derived' };
  const profile = sellCfg.recognitionProfile;
  const phaseStartYear = phase.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const handoverYear = resolveHandoverYear(N, phaseStartYear, cp, projectStartYear, sellCfg.handoverYearOverride);

  if (profile.method === 'point_in_time') {
    const anchor = profile.pointInTimeYear ?? 'handover';
    if (anchor === 'handover') {
      const idx = Math.max(0, Math.min(N - 1, handoverYear));
      out[idx] = 1;
      return { profile: out, mode: 'literal' };
    }
    // Pass 9g-H (2026-05-18): custom absolute year. 100% of recognition
    // lumps at the user-pinned project year. Falls back to handover when
    // the custom year is unset so the joint factor never silently zeros.
    if (anchor === 'custom') {
      const yr = profile.pointInTimeCustomYear;
      const idx = yr != null
        ? Math.max(0, Math.min(N - 1, yr - projectStartYear))
        : Math.max(0, Math.min(N - 1, handoverYear));
      out[idx] = 1;
      return { profile: out, mode: 'literal' };
    }
    return { profile: derivedFallback.slice(0, N), mode: 'derived' };
  }

  const pct = profile.percentages ?? [];
  const pos = profile.positions ?? pct.map((_, k) => k);
  const mode = profile.profileMode ?? 'absolute_with_catchup';
  if (mode === 'relative_to_sale' || pct.length === 0) {
    return { profile: derivedFallback.slice(0, N), mode: 'derived' };
  }

  let overflow = 0;
  for (let k = 0; k < pct.length; k++) {
    const axisIdx = pos[k] ?? k;
    const value = Math.max(0, pct[k] ?? 0);
    if (axisIdx < 0 || axisIdx >= N) overflow += value;
    else out[axisIdx] += value;
  }
  if (overflow > 0) {
    const lastIdx = Math.max(0, Math.min(N - 1, handoverYear));
    out[lastIdx] += overflow;
  }
  const sum = out.reduce((s, v) => s + v, 0);
  if (sum > 0 && Math.abs(sum - 1) > 1e-6) {
    for (let i = 0; i < N; i++) out[i] = out[i] / sum;
  }
  return { profile: out, mode: 'literal' };
}

// THE ASSET COMES IN WITH THE ROW (2026-09-10): the metric is the asset s
// where it states one, so a helper that took only the row could not resolve it.
// AND THE METRIC IS THE ASSET'S HERE TOO (2026-09-13). The area on the line
// above already resolved it, but the count and the rate below read the ROW's
// metric, so a row stored as 'units' under an asset that counts area (one live
// row, 10,098 sqm at 16,500) was priced at 16,500 over its 190 sqm unit size,
// about 86.84 a sqm: 876,951 where the row is worth 166.6m.
function makeSubUnitMaterial(u: SubUnit, asset: Asset | undefined): SubUnitMaterial {
  const area = computeSubUnitArea(u, asset);
  const metric = resolveSubUnitMetric(u, asset);
  if (metric === 'units') {
    const count = Math.max(0, u.metricValue);
    const unitArea = Math.max(0, u.unitArea ?? 0);
    const ratePerArea = unitArea > 0 ? u.unitPrice / unitArea : 0;
    return { id: u.id, area, count, ratePerArea, ratePerUnit: u.unitPrice, metric };
  }
  return { id: u.id, area, count: 0, ratePerArea: u.unitPrice, ratePerUnit: 0, metric };
}

/**
 * THE ROW LIST THE ENGINE SELLS, DERIVED FROM THE STORE (2026-09-13).
 *
 * `revenue.sell.subUnits` was the list: taken from the store at the first
 * velocity edit and refreshed only by the next, so a row added afterwards had
 * no entry and the engine skipped it. The store's rows are the list now; each
 * is looked up by id, a row with no entry reads the line's `velocityDefault`,
 * and a row with neither sells nothing until a velocity is typed. Exported so
 * the screen can state which of the three a row is on.
 */
export type VelocitySource = 'own' | 'default' | 'none';
export function resolveRowVelocity(
  sell: NonNullable<Asset['revenue']>['sell'] | undefined,
  subUnitId: string,
): { pre: number[] | undefined; post: number[] | undefined; preLegacy?: number[]; postLegacy?: number[]; source: VelocitySource } {
  const own = sell?.subUnits?.find((s) => s.subUnitId === subUnitId);
  if (own) {
    return {
      pre: own.preSalesVelocityByPhase, post: own.postSalesVelocityByPhase,
      preLegacy: own.preSalesVelocity, postLegacy: own.postSalesVelocity, source: 'own',
    };
  }
  const dflt = sell?.velocityDefault;
  if (dflt) return { pre: dflt.preSalesVelocityByPhase, post: dflt.postSalesVelocityByPhase, source: 'default' };
  return { pre: undefined, post: undefined, source: 'none' };
}

export interface ProjectRevenueSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  bySellAsset: Map<string, SellAssetResult>;
  projectTotals: SellAssetResult;
  // Pass 8b (2026-05-18): Hospitality (Operate-strategy) per-asset
  // results. Sell + Manage companions live here too (they're the
  // operate side of a sell parent). Includes pure Operate parents.
  byHospitalityAsset: Map<string, HospitalityAssetResult>;
  hospitalityProjectTotals: HospitalityAssetResult;
  // Pass 9g (2026-05-18): Retail / Office Lease per-asset results.
  // One entry per Lease-strategy parent asset; companions don't apply
  // (Sell + Manage companions go to byHospitalityAsset only).
  byLeaseAsset: Map<string, LeaseAssetResult>;
  leaseProjectTotals: LeaseAssetResult;
}

// ────────────────────────────────────────────────────────────────────
// SUMMING RESULTS (2026-09-13). A LINE'S RESULT IS THE SUM OF ITS MEMBERS'
// and the PROJECT total is the sum of every result, and both are these three
// functions, so a line total and the project total cannot disagree about what
// a sum is. Flows add; the per-sub-unit maps merge by id (ids are unique
// across the project); the vintage matrices add cell by cell. Rates (ADR,
// occupancy, an indexed rent) are weighted by the flow that explains them
// when `rates` is asked for, so a one-member line reads exactly as the
// member does; the project totals never carried rates and still do not.
// ────────────────────────────────────────────────────────────────────

const addInto = (dst: number[], src: number[] | undefined, N: number): void => {
  for (let i = 0; i < N; i++) dst[i] += src?.[i] ?? 0;
};
const mergeMaps = (dst: Record<string, number[]>, src: Record<string, number[]> | undefined, N: number): void => {
  for (const [id, arr] of Object.entries(src ?? {})) {
    if (!dst[id]) dst[id] = new Array<number>(N).fill(0);
    addInto(dst[id], arr, N);
  }
};
const emptySell = (assetId: string, N: number): SellAssetResult => {
  const z = (): number[] => new Array<number>(N).fill(0);
  const m = (): number[][] => { const out: number[][] = []; for (let i = 0; i < N; i++) out.push(new Array<number>(N).fill(0)); return out; };
  return {
    assetId, axisLength: N,
    presalesUnitsPerPeriod: z(), presalesAreaPerPeriod: z(), presalesRevenuePerPeriod: z(),
    postSalesUnitsPerPeriod: z(), postSalesAreaPerPeriod: z(), postSalesRevenuePerPeriod: z(),
    presalesAreaPerPeriodPerSubUnit: {}, presalesRevenuePerPeriodPerSubUnit: {}, presalesUnitsPerPeriodPerSubUnit: {},
    postSalesAreaPerPeriodPerSubUnit: {}, postSalesRevenuePerPeriodPerSubUnit: {}, postSalesUnitsPerPeriodPerSubUnit: {},
    cashCollectedPerPeriod: z(), presalesCashPerPeriod: z(), postSalesCashPerPeriod: z(),
    recognitionPerPeriod: z(), presalesRecognitionPerPeriod: z(), postSalesRecognitionPerPeriod: z(),
    presalesSalesValuePerPeriod: z(), cashVintageMatrix: m(), recognitionVintageMatrix: m(),
  };
};

export function sumSellResults(results: readonly SellAssetResult[], N: number, assetId: string): SellAssetResult {
  const t = emptySell(assetId, N);
  const flows: Array<keyof SellAssetResult> = [
    'presalesUnitsPerPeriod', 'presalesAreaPerPeriod', 'presalesRevenuePerPeriod',
    'postSalesUnitsPerPeriod', 'postSalesAreaPerPeriod', 'postSalesRevenuePerPeriod',
    'cashCollectedPerPeriod', 'presalesCashPerPeriod', 'postSalesCashPerPeriod',
    'recognitionPerPeriod', 'presalesRecognitionPerPeriod', 'postSalesRecognitionPerPeriod',
    'presalesSalesValuePerPeriod',
  ];
  const maps: Array<keyof SellAssetResult> = [
    'presalesAreaPerPeriodPerSubUnit', 'presalesRevenuePerPeriodPerSubUnit', 'presalesUnitsPerPeriodPerSubUnit',
    'postSalesAreaPerPeriodPerSubUnit', 'postSalesRevenuePerPeriodPerSubUnit', 'postSalesUnitsPerPeriodPerSubUnit',
  ];
  for (const r of results) {
    for (const k of flows) addInto(t[k] as number[], r[k] as number[], N);
    for (const k of maps) mergeMaps(t[k] as Record<string, number[]>, r[k] as Record<string, number[]>, N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      t.cashVintageMatrix[i][j] += r.cashVintageMatrix[i]?.[j] ?? 0;
      t.recognitionVintageMatrix[i][j] += r.recognitionVintageMatrix[i]?.[j] ?? 0;
    }
  }
  return t;
}

export function sumHospitalityResults(
  results: readonly HospitalityAssetResult[], N: number, assetId: string, rates = false,
): HospitalityAssetResult {
  const z = (): number[] => new Array<number>(N).fill(0);
  const t: HospitalityAssetResult = {
    assetId, axisLength: N,
    availableRoomNightsPerPeriod: z(), occupiedRoomNightsPerPeriod: z(), occupancyPerPeriod: z(),
    adrPerPeriod: z(), adrIndexationFactorPerPeriod: z(), guestsPerPeriod: z(),
    roomsRevenuePerPeriod: z(), fbRevenuePerPeriod: z(), otherRevenuePerPeriod: z(), totalRevenuePerPeriod: z(),
    perSubUnit: {}, keysParticipationPerPeriod: z(), effectiveKeysPerPeriod: z(),
  };
  const factorWeighted = z();
  let staticKeys = 0;
  for (const r of results) {
    addInto(t.availableRoomNightsPerPeriod, r.availableRoomNightsPerPeriod, N);
    addInto(t.occupiedRoomNightsPerPeriod, r.occupiedRoomNightsPerPeriod, N);
    addInto(t.guestsPerPeriod, r.guestsPerPeriod, N);
    addInto(t.roomsRevenuePerPeriod, r.roomsRevenuePerPeriod, N);
    addInto(t.fbRevenuePerPeriod, r.fbRevenuePerPeriod, N);
    addInto(t.otherRevenuePerPeriod, r.otherRevenuePerPeriod, N);
    addInto(t.totalRevenuePerPeriod, r.totalRevenuePerPeriod, N);
    addInto(t.effectiveKeysPerPeriod, r.effectiveKeysPerPeriod, N);
    for (let i = 0; i < N; i++) factorWeighted[i] += (r.adrIndexationFactorPerPeriod[i] ?? 0) * (r.availableRoomNightsPerPeriod[i] ?? 0);
    for (const [id, su] of Object.entries(r.perSubUnit ?? {})) {
      // The per-row map is a LINE's to show; the project total never carried
      // one and still does not (rates = false), so it stays byte-identical.
      if (rates) t.perSubUnit[id] = su;
      staticKeys += Math.max(0, su.keys);
    }
  }
  if (rates) {
    for (let i = 0; i < N; i++) {
      const arn = t.availableRoomNightsPerPeriod[i];
      const orn = t.occupiedRoomNightsPerPeriod[i];
      t.occupancyPerPeriod[i] = arn > 0 ? orn / arn : 0;
      t.adrPerPeriod[i] = orn > 0 ? t.roomsRevenuePerPeriod[i] / orn : 0;
      t.adrIndexationFactorPerPeriod[i] = arn > 0 ? factorWeighted[i] / arn : 0;
      t.keysParticipationPerPeriod[i] = staticKeys > 0 ? t.effectiveKeysPerPeriod[i] / staticKeys : (arn > 0 ? 1 : 0);
    }
  }
  return t;
}

export function sumLeaseResults(
  results: readonly LeaseAssetResult[], N: number, assetId: string, rates = false,
): LeaseAssetResult {
  const z = (): number[] => new Array<number>(N).fill(0);
  const t: LeaseAssetResult = {
    assetId, axisLength: N,
    occupiedAreaPerPeriod: z(), occupancyPerPeriod: z(), indexedRatePerPeriod: z(),
    rentIndexationFactorPerPeriod: z(), totalRevenuePerPeriod: z(), perSubUnit: {},
  };
  const factorWeighted = z();
  let gla = 0;
  for (const r of results) {
    addInto(t.occupiedAreaPerPeriod, r.occupiedAreaPerPeriod, N);
    addInto(t.totalRevenuePerPeriod, r.totalRevenuePerPeriod, N);
    let rGla = 0;
    for (const [id, su] of Object.entries(r.perSubUnit ?? {})) { if (rates) t.perSubUnit[id] = su; rGla += Math.max(0, su.gla); }
    gla += rGla;
    for (let i = 0; i < N; i++) factorWeighted[i] += (r.rentIndexationFactorPerPeriod[i] ?? 0) * rGla;
  }
  if (rates) {
    for (let i = 0; i < N; i++) {
      const occ = t.occupiedAreaPerPeriod[i];
      t.occupancyPerPeriod[i] = gla > 0 ? occ / gla : 0;
      t.indexedRatePerPeriod[i] = occ > 0 ? t.totalRevenuePerPeriod[i] / occ : 0;
      t.rentIndexationFactorPerPeriod[i] = gla > 0 ? factorWeighted[i] / gla : 0;
    }
  }
  return t;
}

/** A LINE'S RESULTS: the sum over its members of whatever the engine produced
 *  for them, per strategy. Absent when no member produced one, which is what
 *  "no revenue block yet" looks like from here. */
export function lineRevenueResults(
  memberIds: readonly string[],
  snap: ProjectRevenueSnapshot,
  lineKey: string,
): { sell?: SellAssetResult; hospitality?: HospitalityAssetResult; lease?: LeaseAssetResult } {
  const N = snap.axisLength;
  const sells = memberIds.map((id) => snap.bySellAsset.get(id)).filter((r): r is SellAssetResult => !!r);
  const hosps = memberIds.map((id) => snap.byHospitalityAsset.get(id)).filter((r): r is HospitalityAssetResult => !!r);
  const leases = memberIds.map((id) => snap.byLeaseAsset.get(id)).filter((r): r is LeaseAssetResult => !!r);
  return {
    sell: sells.length ? sumSellResults(sells, N, lineKey) : undefined,
    hospitality: hosps.length ? sumHospitalityResults(hosps, N, lineKey, true) : undefined,
    lease: leases.length ? sumLeaseResults(leases, N, lineKey, true) : undefined,
  };
}

export function computeAllSellResults(state: Pick<Module1Store, 'project' | 'phases' | 'assets' | 'subUnits'>): ProjectRevenueSnapshot {
  const { project, phases, assets, subUnits } = state;
  const timeline = computeProjectTimeline(project, phases);
  const projectStartYear = new Date(timeline.startDate).getUTCFullYear();
  // Mirror buildProjectAxis: inclusive slot count derived from
  // max(phaseOffset + cp + op - overlap), not endYear - startYear (which
  // is years elapsed and off-by-one for the last operating year).
  let maxEnd = Math.max(1, timeline.totalPeriods);
  for (const p of phases) {
    const ps = p.startDate ? new Date(p.startDate).getUTCFullYear() : projectStartYear;
    const psIdx = Math.max(0, ps - projectStartYear);
    const phaseLen = Math.max(0, (p.constructionPeriods ?? 0) + (p.operationsPeriods ?? 0) - (p.overlapPeriods ?? 0));
    if (psIdx + phaseLen > maxEnd) maxEnd = psIdx + phaseLen;
  }
  const N = maxEnd;
  const yearLabels = Array.from({ length: N }, (_, i) => projectStartYear + i);

  const bySellAsset = new Map<string, SellAssetResult>();

  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    // Pass 7w (2026-05-18): Sell + Manage parents share the same
    // sell-side revenue mechanics as pure Sell (Pre-Sales velocity +
    // Sales During Operation + cash + recognition + indexation). The
    // companion (operate side) wires in at Pass 10 and lives in
    // Hospitality / Operations.
    if (a.strategy !== 'Sell' && a.strategy !== 'Sell + Manage') continue;
    const cfgRaw = resolveSellConfig(a, project);
    if (!cfgRaw) continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;

    const phaseStartYear = phase.startDate
      ? new Date(phase.startDate).getUTCFullYear()
      : projectStartYear;
    const phaseOffset = phaseStartYear - projectStartYear;
    const handoverYear = resolveHandoverYear(
      N,
      phaseStartYear,
      phase.constructionPeriods ?? 0,
      projectStartYear,
      cfgRaw.handoverYearOverride,
    );

    // M4 Pass 2h: expand new phase-local fields into axis-indexed arrays
    // before the engine sees them. The engine type still expects
    // project-axis arrays; storage holds phase-local now.
    const storedSell = a.revenue?.sell;
    // THE ROWS ARE THE STORE'S, less Support, each looked up by id (see
    // resolveRowVelocity). The stored list is no longer walked, so a row it
    // never learned about is priced the moment it exists on Table 5.
    const assetSubUnits = subUnits.filter((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const cfg: AssetSellConfig = {
      ...cfgRaw,
      subUnits: assetSubUnits.map((u) => {
        const v = resolveRowVelocity(storedSell, u.id);
        return {
          subUnitId: u.id,
          preSalesVelocity: expandPhaseLocalToAxis(v.pre, v.preLegacy, phaseOffset, N),
          postSalesVelocity: expandPhaseLocalToAxis(v.post, v.postLegacy, phaseOffset, N),
        };
      }),
      // Sale cohort downpayment: phase-local in storage, project axis for the
      // engine, exactly as the velocity arrays above. NULLS ARE PRESERVED
      // rather than flattened to zero, because an unset sale year is not a
      // zero-downpayment one and the forward-fill rule needs to tell them
      // apart. Years before the phase starts stay null; nothing sells there.
      //
      // Option B Step 2 (2026-08-20): the PROJECT DEFAULT is applied here, for
      // an asset that carries no downpayment on any sale year. The decision
      // lives in `saleCohortResolution.ts`, which the Module 2 screen also
      // calls, so the source a user reads and the source the model uses are
      // one answer rather than two that agree.
      //
      // With no project default set, this returns exactly what it returned
      // before, which is what makes the step inert on every existing project.
      downpayment: buildEngineDownpaymentAxis(
        storedSell?.downpaymentByPhase,
        project.saleCohortDefaults?.downpayment,
        phaseOffset,
        N,
      ),
      cashPaymentProfile: (() => {
        const cpp = cfgRaw.cashPaymentProfile;
        const sCpp = storedSell?.cashPaymentProfile;
        // M2 Pass 9k-Fix #3 (2026-05-20): MERGE legacy + percentagesByPhase
        // instead of picking one.
        //
        // Background: Pass 2h dual-wrote cash percentages to both the
        // legacy axis-indexed `percentages` (full project-axis length,
        // every setter writes here) and to `percentagesByPhase`
        // (phase-local, length cp+op-overlap pre-Fix #1). The early
        // resolver preferred percentagesByPhase whenever it existed,
        // which silently masked legacy entries past the truncated tail.
        // For users whose snapshots passed through Pass 9k truncation,
        // the engine then saw only the truncated phase-local slice and
        // collected 100% of every cohort by handover (catchup logic),
        // wiping post-handover cash from the vintage matrix.
        //
        // Merge rule: start from legacy axis-indexed, overlay any
        // non-zero phase-local entries (after phaseOffset shift). Both
        // legacy and ByPhase carry user intent depending on when the
        // edit happened; non-destructive merge guarantees no loss.
        // Positions are the simple axis-indexed [0..N-1].
        const axisPct = new Array<number>(N).fill(0);
        if (Array.isArray(sCpp?.percentages)) {
          for (let i = 0; i < Math.min(sCpp.percentages.length, N); i++) {
            axisPct[i] = sCpp.percentages[i] ?? 0;
          }
        } else if (Array.isArray(cpp.percentages)) {
          for (let i = 0; i < Math.min(cpp.percentages.length, N); i++) {
            axisPct[i] = cpp.percentages[i] ?? 0;
          }
        }
        if (Array.isArray(sCpp?.percentagesByPhase)) {
          for (let k = 0; k < sCpp.percentagesByPhase.length; k++) {
            const axisIdx = phaseOffset + k;
            const v = sCpp.percentagesByPhase[k] ?? 0;
            if (axisIdx >= 0 && axisIdx < N && v !== 0) axisPct[axisIdx] = v;
          }
        }
        const positions = axisPct.map((_, i) => i);
        return { ...cpp, percentages: axisPct, positions };
      })(),
      recognitionProfile: (() => {
        const rp = cfgRaw.recognitionProfile;
        const sRp = storedSell?.recognitionProfile;
        if (rp.method !== 'over_time') return rp;
        // Same merge rule as cash; see comment above.
        const axisPct = new Array<number>(N).fill(0);
        if (Array.isArray(sRp?.percentages)) {
          for (let i = 0; i < Math.min(sRp.percentages.length, N); i++) {
            axisPct[i] = sRp.percentages[i] ?? 0;
          }
        } else if (Array.isArray(rp.percentages)) {
          for (let i = 0; i < Math.min(rp.percentages.length, N); i++) {
            axisPct[i] = rp.percentages[i] ?? 0;
          }
        }
        if (Array.isArray(sRp?.percentagesByPhase)) {
          for (let k = 0; k < sRp.percentagesByPhase.length; k++) {
            const axisIdx = phaseOffset + k;
            const v = sRp.percentagesByPhase[k] ?? 0;
            if (axisIdx >= 0 && axisIdx < N && v !== 0) axisPct[axisIdx] = v;
          }
        }
        const positions = axisPct.map((_, i) => i);
        return { ...rp, percentages: axisPct, positions };
      })(),
      indexation: expandIndexationToAxis(cfgRaw.indexation, storedSell?.indexation?.growthPerPeriodByPhase, phaseOffset, N),
    };

    const subUnitMaterials = assetSubUnits.map((u) => makeSubUnitMaterial(u, a));

    const result = computeSellAsset({
      config: cfg,
      subUnits: subUnitMaterials,
      axisLength: N,
      handoverYear,
      projectStartYear,
    });
    bySellAsset.set(a.id, result);
  }
  // THE PROJECT TOTAL IS THE ONE SUM (see sumSellResults above).
  const projectTotals = sumSellResults([...bySellAsset.values()], N, '__project__');

  // Pass 8b (2026-05-18): Hospitality compute loop. Operate-strategy
  // parents, which include the Operate companion of a Sell + Manage parent.
  const byHospitalityAsset = new Map<string, HospitalityAssetResult>();

  for (const a of assets) {
    if (a.visible === false) continue;
    // THE STRATEGY, NOT THE COMPANION FLAG (2026-09-13). "Or is a companion"
    // admitted the retail strip, a Lease asset, which then fell out on its
    // missing operate block; the Operate companion carries strategy Operate
    // and is admitted by that. One classifier fewer (docs/TRAPS.md 7.33).
    if (a.strategy !== 'Operate') continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;
    const typeValues = a.assetTypeId ? project.assetTypeValues?.[a.assetTypeId] : undefined;
    const cfg = resolveHospitalityConfig(a, phase, subUnits, projectStartYear, N, typeValues);
    if (!cfg) continue;
    const result = computeHospitalityAsset({ config: cfg, axisLength: N });
    byHospitalityAsset.set(a.id, result);
  }
  // Rates (occupancy, ADR) are left at 0 on the project total, as before:
  // they do not sum, and no consumer reads them at project level.
  const hospitalityProjectTotals = sumHospitalityResults([...byHospitalityAsset.values()], N, '__project__');

  // Pass 9g (2026-05-18): Retail / Office Lease compute loop. One entry
  // per Lease-strategy parent. Companions stay in hospitality.
  const byLeaseAsset = new Map<string, LeaseAssetResult>();
  for (const a of assets) {
    // CONSOLIDATION STEP 6 (2026-09-10): A RETAIL COMPANION EARNS ITS OWN RENT.
    // The skip is the OPERATE companion's: that one has no area of its own and
    // mirrors its parent's units, so pricing it here would count the parent's
    // building twice. A retail companion is the opposite case, a building held
    // on Lease with its own floor area and its own sub-unit, and the whole point
    // of giving it a row to be priced on (step 4b) was that this loop would read
    // it. The strategy test below already admits it; only the blanket companion
    // skip stood in the way.
    if (a.visible === false || (a.isCompanion === true && !isRetailCompanion(a))) continue;
    if (a.strategy !== 'Lease') continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;
    const cfg = resolveLeaseConfig(a, phase, subUnits, projectStartYear, N);
    if (!cfg) continue;
    const result = computeLeaseAsset({ config: cfg, axisLength: N });
    byLeaseAsset.set(a.id, result);
  }
  const leaseProjectTotals = sumLeaseResults([...byLeaseAsset.values()], N, '__project__');

  return {
    axisLength: N,
    projectStartYear,
    yearLabels,
    bySellAsset,
    projectTotals,
    byHospitalityAsset,
    hospitalityProjectTotals,
    byLeaseAsset,
    leaseProjectTotals,
  };
}

export type ResolverState = Pick<
  Module1Store,
  'project' | 'phases' | 'assets' | 'subUnits' | 'parcels' | 'costLines' | 'costOverrides' | 'landAllocationMode'
>;

// `computeAssetCapex` lived here and returned `computeAssetCost(...).total` as
// the cost-of-sales base. It is GONE (2026-08-30): the cost-of-sales layer in
// ./costOfSales needs the per-period spend as well as the total, on one
// projection, so a scalar-only helper could only ever be half the base. Its
// last caller was the schedule bundle above.

export interface AssetScheduleBundle {
  assetId: string;
  ar: AccountsReceivableResult;
  unearned: UnearnedRevenueResult;
  // NO cos here (2026-08-30). Cost of sales is assembled once, in
  // ./costOfSales, which is the only place the capex base plus IDC and the
  // spread are put together. This bundle used to carry a CoS built on an
  // IDC-free base that the P&L then threw away and rebuilt, so the result was
  // computed twice and the first one was always discarded.
}

/**
 * Convenience: per-asset AR + Unearned + Cost of Sales bundle. Reads
 * the asset's SellAssetResult (recognition + cash) and its total capex,
 * then runs the three schedule builders.
 */
export function computeAssetScheduleBundle(
  result: SellAssetResult,
): AssetScheduleBundle {
  const N = result.axisLength;
  // Pass 7q: sale value drives both AR + UR (gross obligation).
  // AR unwinds via cash; Unearned unwinds via recognition.
  const ar = buildAccountsReceivable(
    result.presalesRevenuePerPeriod,
    result.presalesCashPerPeriod,
    N,
  );
  const unearned = buildUnearnedRevenue(
    result.presalesRecognitionPerPeriod,
    result.presalesRevenuePerPeriod,
    N,
  );
  return { assetId: result.assetId, ar, unearned };
}

// ────────────────────────────────────────────────────────────────────
// M2 Pass 9h (2026-05-19): Pre-Sales Escrow snapshot.
//
// Composes the existing per-asset Sell results' presalesCashPerPeriod
// into a project-wide escrow schedule per asset + project totals.
// Reads Project.escrow.heldPct / defaultReleaseYear and per-asset
// Asset.revenue.sell.escrow overrides; falls back to handover year for
// each asset's release event when no override is set.
//
// Sell + Manage parents are included (they have pre-sales cash).
// Lease + pure Hospitality assets do not appear (no pre-sales cash).
// ────────────────────────────────────────────────────────────────────

import { computeEscrow, type EscrowAssetResult } from '@/src/core/calculations/revenue';
import { assetLabel } from '@/src/core/calculations/assetName';

export interface EscrowAssetRow {
  assetId: string;
  assetName: string;
  phaseId: string;
  /** Resolved held % actually used (per-asset override > project default > 0). */
  effectiveHeldPct: number;
  /** Resolved release year (absolute calendar year). */
  effectiveReleaseYear: number;
  /** Project-axis index for the release year. */
  releaseYearIdx: number;
  /** Resolved "held until" year (absolute calendar year). Pre-sales cash
   *  arriving after this year is not withheld. Defaults to the asset's
   *  handover year (last construction year). */
  effectiveHeldUntilYear: number;
  /** Project-axis index for heldUntil. */
  heldUntilIdx: number;
  preSalesCashPerPeriod: number[];
  result: EscrowAssetResult;
}

export interface ProjectEscrowSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  /** Per-asset escrow row (only assets with pre-sales cash). */
  byAsset: Map<string, EscrowAssetRow>;
  /** Project totals across every asset row. */
  projectTotals: {
    preSalesCashPerPeriod: number[];
    heldPerPeriod: number[];
    releasePerPeriod: number[];
    cumulativeBalancePerPeriod: number[];
    netMovementPerPeriod: number[];
    cashFlowAdjustmentPerPeriod: number[];
    totalHeld: number;
    totalReleased: number;
  };
}

export function computeEscrowSnapshot(
  state: Pick<Module1Store, 'project' | 'phases' | 'parcels' | 'assets' | 'subUnits'>,
  revenueSnap: ProjectRevenueSnapshot,
): ProjectEscrowSnapshot {
  const { project, phases, assets } = state;
  const N = revenueSnap.axisLength;
  const projectStartYear = revenueSnap.projectStartYear;
  const yearLabels = revenueSnap.yearLabels;
  const zeros = (): number[] => new Array<number>(N).fill(0);

  const projectHeldPct = Math.max(0, project.escrow?.heldPct ?? 0);
  const projectDefaultReleaseYear = project.escrow?.defaultReleaseYear;
  const projectDefaultHeldUntilYear = project.escrow?.defaultHeldUntilYear;

  const phaseMap = new Map<string, typeof phases[number]>();
  for (const p of phases) phaseMap.set(p.id, p);

  const byAsset = new Map<string, EscrowAssetRow>();
  const totals = {
    preSalesCashPerPeriod: zeros(),
    heldPerPeriod: zeros(),
    releasePerPeriod: zeros(),
    cumulativeBalancePerPeriod: zeros(),
    netMovementPerPeriod: zeros(),
    cashFlowAdjustmentPerPeriod: zeros(),
    totalHeld: 0,
    totalReleased: 0,
  };

  for (const a of assets) {
    if (a.visible === false || a.isCompanion === true) continue;
    if (a.strategy !== 'Sell' && a.strategy !== 'Sell + Manage') continue;
    const sellResult = revenueSnap.bySellAsset.get(a.id);
    if (!sellResult) continue;

    // Resolve effective held % (asset override > project default > 0).
    const assetHeldOverride = a.revenue?.sell?.escrow?.heldPctOverride;
    const effectiveHeldPct = assetHeldOverride !== undefined && assetHeldOverride >= 0
      ? assetHeldOverride
      : projectHeldPct;

    // Resolve effective release year. Order: per-asset override >
    // project default > end of construction + 1 (= the calendar year
    // AFTER handover). Why +1: regulators release the escrow balance
    // back to the developer at the end of the year following project
    // completion, not on the completion year itself. Per Ahmad
    // 2026-05-19.
    const phase = phaseMap.get(a.phaseId);
    const phaseStartYear = phase?.startDate
      ? new Date(phase.startDate).getUTCFullYear()
      : projectStartYear;
    const cp = Math.max(0, phase?.constructionPeriods ?? 0);
    const handoverYear = phaseStartYear + Math.max(0, cp - 1);
    const defaultReleaseYearForAsset = handoverYear + 1;
    const assetReleaseOverride = a.revenue?.sell?.escrow?.releaseYearOverride;
    const effectiveReleaseYear = assetReleaseOverride !== undefined
      ? assetReleaseOverride
      : (projectDefaultReleaseYear !== undefined ? projectDefaultReleaseYear : defaultReleaseYearForAsset);

    const releaseYearIdx = Math.max(0, Math.min(N - 1, effectiveReleaseYear - projectStartYear));

    // Resolve "held until" year. Order: per-asset override > project
    // default > handover year (= end of construction). Per Ahmad
    // 2026-05-20: default escrow withholding stops at construction
    // completion; pre-sales cash arriving in operating years is not
    // regulator-locked unless the user explicitly extends the window.
    const assetHeldUntilOverride = a.revenue?.sell?.escrow?.heldUntilYearOverride;
    const effectiveHeldUntilYear = assetHeldUntilOverride !== undefined
      ? assetHeldUntilOverride
      : (projectDefaultHeldUntilYear !== undefined ? projectDefaultHeldUntilYear : handoverYear);
    const heldUntilIdx = Math.max(0, Math.min(N - 1, effectiveHeldUntilYear - projectStartYear));

    const preSalesCashPerPeriod = sellResult.presalesCashPerPeriod.slice(0, N);

    const result = computeEscrow({
      axisLength: N,
      heldPct: effectiveHeldPct,
      releaseYearIdx,
      heldUntilIdx,
      preSalesCashPerPeriod,
    });

    byAsset.set(a.id, {
      assetId: a.id,
      assetName: assetLabel(a, state),
      phaseId: a.phaseId,
      effectiveHeldPct,
      effectiveReleaseYear,
      releaseYearIdx,
      effectiveHeldUntilYear,
      heldUntilIdx,
      preSalesCashPerPeriod,
      result,
    });

    for (let t = 0; t < N; t++) {
      totals.preSalesCashPerPeriod[t] += preSalesCashPerPeriod[t] ?? 0;
      totals.heldPerPeriod[t] += result.heldPerPeriod[t] ?? 0;
      totals.releasePerPeriod[t] += result.releasePerPeriod[t] ?? 0;
      totals.netMovementPerPeriod[t] += result.netMovementPerPeriod[t] ?? 0;
      totals.cashFlowAdjustmentPerPeriod[t] += result.cashFlowAdjustmentPerPeriod[t] ?? 0;
    }
    totals.totalHeld += result.totalHeld;
    totals.totalReleased += result.totalReleased;
  }

  // Cumulative balance from the totals net-movement stream (mirrors the
  // reference v1.16 row 29: cumulative locked balance summed across
  // every asset's held - released stream).
  let running = 0;
  for (let t = 0; t < N; t++) {
    running += totals.netMovementPerPeriod[t];
    if (running < 0) running = 0;
    totals.cumulativeBalancePerPeriod[t] = running;
  }

  return {
    axisLength: N,
    projectStartYear,
    yearLabels,
    byAsset,
    projectTotals: totals,
  };
}
