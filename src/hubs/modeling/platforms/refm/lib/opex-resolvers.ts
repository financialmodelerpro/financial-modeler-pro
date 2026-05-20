/**
 * Module 3 Opex resolver.
 *
 * Composes M2's per-asset revenue snapshot into the inputs each
 * computeAssetOpex / computeHQOpex call needs, walks every visible
 * non-companion asset in the M1 store, and aggregates the project
 * totals. Returns a `ProjectOpexSnapshot` parallel to the Revenue
 * snapshot.
 *
 * Companion handling: Sell + Manage companions live on the Hospitality
 * revenue side; their opex is computed against the companion's own
 * keys + hospitality revenue (mirrors how revenue resolves).
 */

import {
  buildAccountsPayable,
  computeAssetOpex,
  computeHQOpex,
  defaultHospitalityOpexLines,
  defaultLeaseOpexLines,
  defaultHQOpexLines,
  defaultOpexIndexation,
  type AccountsPayableResult,
  type AssetOpexInputs,
  type AssetOpexResult,
  type HQOpexInputs,
  type HQOpexResult,
  type OpexLine,
  type OpexRevenueContext,
} from '@/src/core/calculations/opex';
import type { IndexationConfig } from '@/src/core/calculations/revenue/types';
import type { Module1Store } from './state/module1-store';
import type { Asset, Phase, Project } from './state/module1-types';
import type { ProjectRevenueSnapshot } from './revenue-resolvers';

export interface ProjectOpexSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  /** Per-asset opex result. Keyed by asset id. */
  byAsset: Map<string, AssetOpexResult>;
  /** Project totals across all visible assets (sum of per-asset arrays). */
  projectTotals: {
    directCostsPerPeriod: number[];
    indirectCostsPerPeriod: number[];
    managementFeePerPeriod: number[];
    otherOpexPerPeriod: number[];
    totalOpexPerPeriod: number[];
    gopPerPeriod: number[];
    noiPerPeriod: number[];
  };
  /** Project-wide HQ opex (not tied to any asset). */
  hq: HQOpexResult;
  /** Total opex including HQ. */
  totalOpexPerPeriodInclHQ: number[];
}

function zeros(n: number): number[] { return new Array<number>(n).fill(0); }

/**
 * Resolve the per-asset opex line list. Falls back to a
 * strategy-appropriate default when the asset has no opex config yet
 * so a brand new project renders something sensible on first visit.
 */
function resolveAssetOpexLines(asset: Asset): OpexLine[] {
  const stored = asset.opex?.lines;
  if (stored && stored.length > 0) {
    return stored.map((l) => ({
      id: l.id,
      name: l.name,
      category: l.category,
      mode: l.mode,
      value: l.value,
      indexation: l.indexation,
      useAssetDefault: l.useAssetDefault,
      rateMode: l.rateMode,
      yoyRates: l.yoyRates,
      disabled: l.disabled,
    }));
  }
  if (asset.strategy === 'Operate') return defaultHospitalityOpexLines();
  if (asset.strategy === 'Lease') return defaultLeaseOpexLines();
  return [];
}

/** Resolve the asset-level inflation default. Stored config wins; when
 *  absent (legacy snapshots / fresh assets) we seed with the same 3%
 *  YoY compound the engine has always used for fixed-cost lines. */
function resolveAssetDefaultIndexation(asset: Asset): IndexationConfig {
  const stored = asset.opex?.defaultIndexation;
  if (stored && stored.method) {
    return stored as IndexationConfig;
  }
  return defaultOpexIndexation();
}

/**
 * Build a revenue context for a single asset from the M2 revenue
 * snapshot. For Hospitality assets, room / F&B / other revenue come
 * from the hospitality result; for Lease assets, leaseRevenue ties
 * to totalRev, the rest are zero.
 */
function buildAssetRevenueContext(
  asset: Asset,
  revenueSnap: ProjectRevenueSnapshot,
  axisLength: number,
): OpexRevenueContext {
  const room = zeros(axisLength);
  const fb = zeros(axisLength);
  const other = zeros(axisLength);
  const total = zeros(axisLength);
  const lease = zeros(axisLength);

  if (asset.strategy === 'Operate') {
    // Includes both pure Hospitality and Sell + Manage companions
    // (companions carry strategy='Operate' with isCompanion=true).
    const r = revenueSnap.byHospitalityAsset.get(asset.id);
    if (r) {
      for (let t = 0; t < axisLength; t++) {
        room[t] = r.roomsRevenuePerPeriod[t] ?? 0;
        fb[t] = r.fbRevenuePerPeriod[t] ?? 0;
        other[t] = r.otherRevenuePerPeriod[t] ?? 0;
        total[t] = r.totalRevenuePerPeriod[t] ?? 0;
      }
    }
  } else if (asset.strategy === 'Lease') {
    const r = revenueSnap.byLeaseAsset.get(asset.id);
    if (r) {
      for (let t = 0; t < axisLength; t++) {
        const v = r.totalRevenuePerPeriod[t] ?? 0;
        total[t] = v;
        lease[t] = v;
      }
    }
  }
  // Sell + Manage PARENTS and pure Sell have no ongoing opex.

  return {
    roomRevenuePerPeriod: room,
    fbRevenuePerPeriod: fb,
    otherRevenuePerPeriod: other,
    totalRevenuePerPeriod: total,
    leaseRevenuePerPeriod: lease,
  };
}

/**
 * Determine [opsStartIdx, opsEndIdx] for an asset from its phase.
 * Mirrors the convention used by the revenue resolvers.
 */
function resolveOpsWindow(
  asset: Asset,
  project: Project,
  phaseMap: Map<string, Phase>,
  axisLength: number,
): { opsStartIdx: number; opsEndIdx: number } {
  const phase = phaseMap.get(asset.phaseId);
  if (!phase) return { opsStartIdx: 0, opsEndIdx: Math.max(0, axisLength - 1) };
  const projectStartYear = new Date(project.startDate).getUTCFullYear();
  const phaseStartYear = phase.startDate
    ? new Date(phase.startDate).getUTCFullYear()
    : projectStartYear;
  const offset = phaseStartYear - projectStartYear;
  const cp = Math.max(0, phase.constructionPeriods ?? 0);
  const op = Math.max(0, phase.operationsPeriods ?? 0);
  const overlap = Math.max(0, phase.overlapPeriods ?? 0);
  const handoverIdx = Math.max(0, offset + cp - 1);
  const defaultOpsStart = Math.max(handoverIdx, handoverIdx + 1 - overlap);

  // Lease + Hospitality both allow opsStartYearOverride
  let opsStartIdx = defaultOpsStart;
  if (asset.strategy === 'Operate') {
    const override = asset.revenue?.operate?.operationsStartYearOverride;
    if (typeof override === 'number') {
      opsStartIdx = Math.max(handoverIdx, override - projectStartYear);
    }
  } else if (asset.strategy === 'Lease') {
    const override = asset.revenue?.lease?.operationsStartYearOverride;
    if (typeof override === 'number') {
      opsStartIdx = Math.max(handoverIdx, override - projectStartYear);
    }
  }

  const opsEndIdx = Math.min(axisLength - 1, defaultOpsStart + op - 1);
  return {
    opsStartIdx: Math.max(0, Math.min(axisLength - 1, opsStartIdx)),
    opsEndIdx: Math.max(opsStartIdx, opsEndIdx),
  };
}

export function computeAllOpexResults(
  state: Pick<Module1Store, 'project' | 'phases' | 'assets' | 'subUnits'>,
  revenueSnap: ProjectRevenueSnapshot,
): ProjectOpexSnapshot {
  const { project, phases, assets, subUnits } = state;
  const N = revenueSnap.axisLength;

  // Map phases by id for fast lookup during the asset loop.
  const phaseMap = new Map<string, Phase>();
  for (const ph of phases) {
    phaseMap.set(ph.id, ph);
  }

  const byAsset = new Map<string, AssetOpexResult>();
  const projectTotals = {
    directCostsPerPeriod: zeros(N),
    indirectCostsPerPeriod: zeros(N),
    managementFeePerPeriod: zeros(N),
    otherOpexPerPeriod: zeros(N),
    totalOpexPerPeriod: zeros(N),
    gopPerPeriod: zeros(N),
    noiPerPeriod: zeros(N),
  };

  for (const a of assets) {
    // Only Hospitality (Operate, including Sell + Manage companions
    // whose strategy is 'Operate') and Retail/Lease carry opex.
    // Sell + Manage PARENTS (strategy 'Sell + Manage') and pure Sell
    // have no ongoing operations — skip.
    if (a.strategy !== 'Operate' && a.strategy !== 'Lease') continue;

    const lines = resolveAssetOpexLines(a);
    if (lines.length === 0) continue;

    const { opsStartIdx, opsEndIdx } = resolveOpsWindow(a, project, phaseMap, N);

    // Driver quantities: total keys for hospitality, total leasable
    // sqm for lease. Pull from M1 sub-units of this asset.
    const myUnits = subUnits.filter((u) => u.assetId === a.id);
    let keys = 0;
    let leasableSqm = 0;
    if (a.strategy === 'Operate') {
      for (const u of myUnits) {
        if (u.metric === 'units') keys += Math.max(0, u.metricValue);
      }
    } else if (a.strategy === 'Lease') {
      for (const u of myUnits) {
        if (u.metric === 'area') leasableSqm += Math.max(0, u.metricValue);
      }
    }

    const revenue = buildAssetRevenueContext(a, revenueSnap, N);

    const inputs: AssetOpexInputs = {
      assetId: a.id,
      strategy: a.strategy as AssetOpexInputs['strategy'],
      lines,
      defaultIndexation: resolveAssetDefaultIndexation(a),
      keys,
      leasableSqm,
      opsStartIdx,
      opsEndIdx,
      axisLength: N,
      revenue,
    };

    const result = computeAssetOpex(inputs);
    byAsset.set(a.id, result);

    for (let t = 0; t < N; t++) {
      projectTotals.directCostsPerPeriod[t] += result.directCostsPerPeriod[t];
      projectTotals.indirectCostsPerPeriod[t] += result.indirectCostsPerPeriod[t];
      projectTotals.managementFeePerPeriod[t] += result.managementFeePerPeriod[t];
      projectTotals.otherOpexPerPeriod[t] += result.otherOpexPerPeriod[t];
      projectTotals.totalOpexPerPeriod[t] += result.totalOpexPerPeriod[t];
      projectTotals.gopPerPeriod[t] += result.gopPerPeriod[t];
      projectTotals.noiPerPeriod[t] += result.noiPerPeriod[t];
    }
  }

  // HQ opex: project-wide line list. Empty config means no HQ opex
  // (some projects don't carry HQ costs at all).
  const hqLines: OpexLine[] = project.hqOpex?.lines && project.hqOpex.lines.length > 0
    ? project.hqOpex.lines.map((l) => ({
        id: l.id,
        name: l.name,
        category: l.category,
        mode: l.mode,
        value: l.value,
        indexation: l.indexation,
        useAssetDefault: l.useAssetDefault,
        rateMode: l.rateMode,
        yoyRates: l.yoyRates,
        disabled: l.disabled,
      }))
    : defaultHQOpexLines();
  const hqDefaultIdx: IndexationConfig = (project.hqOpex?.defaultIndexation as IndexationConfig | undefined)
    ?? defaultOpexIndexation();

  // Project total revenue for pct_of_total_rev HQ lines.
  const projectTR = zeros(N);
  for (let t = 0; t < N; t++) {
    projectTR[t] = revenueSnap.projectTotals.presalesRevenuePerPeriod[t]
      + revenueSnap.projectTotals.postSalesRevenuePerPeriod[t];
    // Hospitality + Lease contribute their total revenue too.
    projectTR[t] += revenueSnap.hospitalityProjectTotals.totalRevenuePerPeriod[t] ?? 0;
    projectTR[t] += revenueSnap.leaseProjectTotals.totalRevenuePerPeriod[t] ?? 0;
  }

  const hqInputs: HQOpexInputs = {
    lines: hqLines,
    defaultIndexation: hqDefaultIdx,
    axisLength: N,
    projectTotalRevenuePerPeriod: projectTR,
  };
  const hq = computeHQOpex(hqInputs);

  const totalInclHQ = zeros(N);
  for (let t = 0; t < N; t++) {
    totalInclHQ[t] = projectTotals.totalOpexPerPeriod[t] + hq.totalOpexPerPeriod[t];
  }

  return {
    axisLength: N,
    projectStartYear: revenueSnap.projectStartYear,
    yearLabels: revenueSnap.yearLabels,
    byAsset,
    projectTotals,
    hq,
    totalOpexPerPeriodInclHQ: totalInclHQ,
  };
}

// ────────────────────────────────────────────────────────────────────
// M4 Pass 2a (2026-05-20): Accounts Payable snapshot.
//
// Composes the existing per-asset + HQ opex streams into a DPO-driven
// AP roll-forward. Per-asset apDays override > project default > 0.
// HQ uses the project default (no per-line HQ override yet — HQ is a
// single bucket).
// ────────────────────────────────────────────────────────────────────

export interface OpexApAssetRow {
  assetId: string;
  assetName: string;
  effectiveApDays: number;
  opexIncurredPerPeriod: number[];
  result: AccountsPayableResult;
}

export interface ProjectOpexApSnapshot {
  axisLength: number;
  projectStartYear: number;
  yearLabels: number[];
  /** Project default DPO actually used (after fallback). */
  projectDefaultApDays: number;
  /** Per-asset AP roll-forward. */
  byAsset: Map<string, OpexApAssetRow>;
  /** HQ AP roll-forward (single bucket). */
  hq: {
    opexIncurredPerPeriod: number[];
    apDays: number;
    result: AccountsPayableResult;
  };
  /** Project totals across every asset row + HQ. */
  projectTotals: {
    opexIncurredPerPeriod: number[];
    openingApPerPeriod: number[];
    closingApPerPeriod: number[];
    changeApPerPeriod: number[];
    cashPaidPerPeriod: number[];
  };
}

export function computeOpexApSnapshot(
  state: Pick<Module1Store, 'project' | 'assets'>,
  opexSnap: ProjectOpexSnapshot,
): ProjectOpexApSnapshot {
  const { project, assets } = state;
  const N = opexSnap.axisLength;
  const daysPerYear = Math.max(1, project.opexAp?.daysPerYear ?? 365);
  const projectDefaultApDays = Math.max(0, project.opexAp?.defaultApDays ?? 0);

  const byAsset = new Map<string, OpexApAssetRow>();
  const totals = {
    opexIncurredPerPeriod: zeros(N),
    openingApPerPeriod: zeros(N),
    closingApPerPeriod: zeros(N),
    changeApPerPeriod: zeros(N),
    cashPaidPerPeriod: zeros(N),
  };

  for (const a of assets) {
    if (a.strategy !== 'Operate' && a.strategy !== 'Lease') continue;
    const r = opexSnap.byAsset.get(a.id);
    if (!r) continue;
    const override = a.opex?.apDaysOverride;
    const effectiveApDays = override !== undefined && override >= 0
      ? override
      : projectDefaultApDays;
    const opexIncurred = r.totalOpexPerPeriod.slice(0, N);
    const ap = buildAccountsPayable({
      opexIncurredPerPeriod: opexIncurred,
      dpoDays: effectiveApDays,
      daysPerYear,
      axisLength: N,
    });
    byAsset.set(a.id, {
      assetId: a.id,
      assetName: a.name,
      effectiveApDays,
      opexIncurredPerPeriod: opexIncurred,
      result: ap,
    });
    for (let t = 0; t < N; t++) {
      totals.opexIncurredPerPeriod[t] += opexIncurred[t];
      totals.openingApPerPeriod[t] += ap.openingPerPeriod[t];
      totals.closingApPerPeriod[t] += ap.perPeriod[t];
      totals.changeApPerPeriod[t] += ap.changePerPeriod[t];
      totals.cashPaidPerPeriod[t] += ap.cashPaidPerPeriod[t];
    }
  }

  // HQ AP: uses the project default DPO (no HQ-specific override yet).
  const hqIncurred = opexSnap.hq.totalOpexPerPeriod.slice(0, N);
  const hqAp = buildAccountsPayable({
    opexIncurredPerPeriod: hqIncurred,
    dpoDays: projectDefaultApDays,
    daysPerYear,
    axisLength: N,
  });
  for (let t = 0; t < N; t++) {
    totals.opexIncurredPerPeriod[t] += hqIncurred[t];
    totals.openingApPerPeriod[t] += hqAp.openingPerPeriod[t];
    totals.closingApPerPeriod[t] += hqAp.perPeriod[t];
    totals.changeApPerPeriod[t] += hqAp.changePerPeriod[t];
    totals.cashPaidPerPeriod[t] += hqAp.cashPaidPerPeriod[t];
  }

  return {
    axisLength: N,
    projectStartYear: opexSnap.projectStartYear,
    yearLabels: opexSnap.yearLabels,
    projectDefaultApDays,
    byAsset,
    hq: { opexIncurredPerPeriod: hqIncurred, apDays: projectDefaultApDays, result: hqAp },
    projectTotals: totals,
  };
}
