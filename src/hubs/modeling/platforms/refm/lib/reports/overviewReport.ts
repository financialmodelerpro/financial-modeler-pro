/**
 * overviewReport.ts (2026-09-16)
 *
 * THE PROJECT OVERVIEW, BUILT ONCE AND READ BY THE SCREEN.
 *
 * The dashboard used to assemble its own figures inline, which is why it could
 * show four loose return figures and a Min DSCR chip while every other surface
 * had moved on. Everything it shows now comes from here, and everything here
 * comes from the SAME rules the rest of the platform uses: the returns snapshot
 * for the return pairs, `resolveAssetAreaMetrics` for area,
 * `computeAssetLandBreakdown` for land (so a retail strip carries the land its
 * hosts gave up), `revenueBySection` for the revenue mix, the capex report for
 * cost by phase, and the balance sheet for peak debt and the cash low point.
 *
 * RETURNS ARE THREE PAIRS (founder, 2026-09-16): a rate beside the multiple that
 * explains it, never a loose IRR and an unrelated multiple. The distributed
 * (DDM) pair reads POST-FEE and PRE-FEE where a fund layer exists, and as one
 * figure where there is none, because the two streams are identical without a
 * performance fee.
 *
 * No em dashes in this file.
 */
import {
  resolveAssetAreaMetrics, computeAssetLandBreakdown, computeAssetUnitCount, computePhaseTimeline,
} from '@/src/core/calculations';
import { normaliseAssetTypeId } from '@/src/core/calculations/typeKey';
import { resolveAssetKeys, resolveAssetLeasableSqm } from '../revenue-resolvers';
import { revenueBySection } from './revenueSections';
import { planReportLines, type LineState } from './lineRows';
import { buildCapexReport } from './capexReports';
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { ReturnsSnapshot } from '../returns-resolvers';
import type { Asset } from '../state/module1-types';

export interface ReturnPair {
  key: 'project' | 'equity' | 'distributed';
  label: string;
  /** "IRR" and "MOIC" of one stream, always together. */
  irr: number | null;
  moic: number | null;
  /** The pre-fee pair, present only where a fund layer takes a performance fee. */
  preFeeIrr?: number | null;
  preFeeMoic?: number | null;
  note?: string;
}

export interface TypeRow {
  typeId: string;
  label: string;
  landSqm: number;
  landPct: number;
  gfaSqm: number;
  units: number;
  keys: number;
  leasableSqm: number;
}

export interface PhaseRow {
  id: string;
  name: string;
  startYear: number | null;
  constructionEndYear: number | null;
  operationsStartYear: number | null;
  lines: number;
  landSqm: number;
  gfaSqm: number;
  capex: number;
  revenue: number;
  ebitda: number;
}

export interface OverviewReport {
  returns: ReturnPair[];
  fundLayer: boolean;
  /** THE FIRST NUMBER A DEVELOPER QUOTES (founder, 2026-09-16). */
  costPerSqm: {
    developmentCostPerGfa: number | null;
    constructionCostPerGfa: number | null;
    developmentCostPerSaleable: number | null;
    revenuePerSaleable: number | null;
    totalDevelopmentCost: number;
    constructionCost: number;
    gfaSqm: number;
    saleableSqm: number;
  };
  scheme: {
    landSqm: number;
    landValue: number;
    gfaSqm: number;
    buaSqm: number;
    saleableSqm: number;
    plotRatio: number | null;
    units: number;
    keys: number;
    leasableSqm: number;
    lines: number;
  };
  byType: TypeRow[];
  revenueMix: Array<{ label: string; value: number; pct: number }>;
  phases: PhaseRow[];
  exit: {
    year: number;
    terminalValue: number;
    gainOnDisposal: number;
    booked: boolean;
    peakDebt: number;
    cashLow: number;
    cashLowYear: number | null;
  };
}

const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((t, x) => t + (x ?? 0), 0);
const safeDiv = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function buildOverviewReport(
  snap: ProjectFinancialsSnapshot,
  rs: ReturnsSnapshot,
  state: FinancialsResolverState,
): OverviewReport {
  const visible = state.assets.filter((a) => a.visible !== false);
  const lineState: LineState = { assets: visible, phases: state.phases, parcels: state.parcels };
  const fundLayer = snap.fundFees?.active === true;

  // ── The three pairs ───────────────────────────────────────────────────────
  const returns: ReturnPair[] = [
    { key: 'project', label: 'Project (FCFF)', irr: rs.result.fcff.irr, moic: rs.result.fcff.moic },
    { key: 'equity', label: 'Equity (FCFE)', irr: rs.result.fcfe.irr, moic: rs.result.fcfe.moic },
    fundLayer
      ? {
        key: 'distributed', label: 'Distributed (DDM)',
        irr: rs.resultNetDividends.irr, moic: rs.resultNetDividends.moic,
        preFeeIrr: rs.result.dividends.irr, preFeeMoic: rs.result.dividends.moic,
        note: 'after the performance fee; pre-fee beneath',
      }
      : { key: 'distributed', label: 'Distributed (DDM)', irr: rs.result.dividends.irr, moic: rs.result.dividends.moic },
  ];

  // ── Area, land and the build mix, per asset then per type ────────────────
  const metricsOf = (a: Asset): ReturnType<typeof resolveAssetAreaMetrics> =>
    resolveAssetAreaMetrics(a, state.project, state.parcels, visible, state.subUnits, state.landAllocationMode);
  // A RETAIL STRIP IS ITS OWN TYPE, not its host's (2026-09-16). It carries the
  // land its hosts gave up and its own ground-floor area, so filing it under the
  // host's label would show the same type twice, once with leasable area it does
  // not have. This is the Revenue tab's own filing rule for a strip.
  const typeLabel = (a: Asset): { id: string; label: string } => {
    if (a.isCompanion === true && a.companionType === 'retail') return { id: 'retail-ground-floor', label: 'Retail Ground Floor' };
    // THE TYPE IS ONE ROW WHETHER THE ASSET CARRIES ITS ID OR ONLY ITS LABEL
    // (2026-09-16): an asset typed before the registry moved onto the project has
    // the label and no id, and keying on the raw id showed the same type twice.
    const label = (a.type ?? '').trim();
    const entry = (state.project.assetTypes ?? []).find((t) => t.id === a.assetTypeId)
      ?? (state.project.assetTypes ?? []).find((t) => t.label.trim() === label);
    const shown = entry?.label ?? label;
    return { id: entry?.id ?? normaliseAssetTypeId(shown) ?? 'other', label: shown || 'Not typed' };
  };
  const typeValuesOf = (a: Asset): ReturnType<typeof resolveAssetKeys> => resolveAssetKeys(
    a, state.subUnits, a.assetTypeId ? state.project.assetTypeValues?.[a.assetTypeId] : undefined,
  );

  const byTypeMap = new Map<string, TypeRow>();
  let landSqm = 0; let landValue = 0; let gfaSqm = 0; let buaSqm = 0; let saleableSqm = 0;
  let units = 0; let keys = 0; let leasableSqm = 0;
  for (const a of visible) {
    const m = metricsOf(a);
    const land = computeAssetLandBreakdown(a, state.parcels, visible, state.subUnits, state.landAllocationMode);
    const t = typeLabel(a);
    const assetKeys = a.strategy === 'Operate' ? typeValuesOf(a).keys : 0;
    const assetLeasable = a.strategy === 'Lease' ? resolveAssetLeasableSqm(a, state.subUnits) : 0;
    const assetUnits = a.strategy === 'Sell' || a.strategy === 'Sell + Manage' ? computeAssetUnitCount(a, state.subUnits) : 0;
    landSqm += land.landSqm; landValue += land.landValue;
    gfaSqm += m.gfa; buaSqm += m.bua; saleableSqm += m.nsa;
    units += assetUnits; keys += assetKeys; leasableSqm += assetLeasable;
    const row = byTypeMap.get(t.id) ?? { typeId: t.id, label: t.label, landSqm: 0, landPct: 0, gfaSqm: 0, units: 0, keys: 0, leasableSqm: 0 };
    row.landSqm += land.landSqm; row.gfaSqm += m.gfa;
    row.units += assetUnits; row.keys += assetKeys; row.leasableSqm += assetLeasable;
    byTypeMap.set(t.id, row);
  }
  const byType = [...byTypeMap.values()]
    .map((r) => ({ ...r, landPct: landSqm > 0 ? r.landSqm / landSqm : 0 }))
    .sort((a, b) => b.landSqm - a.landSqm);

  // ── Cost per sqm ─────────────────────────────────────────────────────────
  const constructionCost = rs.sourcesUses.construction;
  const totalDevelopmentCost = rs.totalDevelopmentCost;
  const totalRevenue = sum(snap.pl.totalRevenuePerPeriod);

  // ── Revenue mix, by the Revenue tab's own sections ───────────────────────
  const sections = revenueBySection(snap, state);
  const revenueMix = sections.map((s) => ({
    label: s.section, value: sum(s.values), pct: totalRevenue > 0 ? sum(s.values) / totalRevenue : 0,
  })).filter((r) => r.value !== 0);

  // ── Phases ───────────────────────────────────────────────────────────────
  const capex = buildCapexReport(snap, state);
  const capexOf = (assetId: string): number => capex.inputAssets.find((ia) => ia.assetId === assetId)?.total ?? 0;
  const yearOf = (iso: string | undefined): number | null => (iso && iso.length >= 4 ? Number(iso.slice(0, 4)) : null);
  const phases: PhaseRow[] = state.phases.map((ph) => {
    const members = visible.filter((a) => a.phaseId === ph.id);
    const timeline = computePhaseTimeline(ph, state.project);
    let revenue = 0; let ebitda = 0; let phaseLand = 0; let phaseGfa = 0; let phaseCapex = 0;
    for (const a of members) {
      const pl = snap.perAssetPL.get(a.id);
      revenue += sum(pl?.revenuePerPeriod);
      ebitda += sum(pl?.ebitdaPerPeriod);
      phaseLand += computeAssetLandBreakdown(a, state.parcels, visible, state.subUnits, state.landAllocationMode).landSqm;
      phaseGfa += metricsOf(a).gfa;
      phaseCapex += capexOf(a.id);
    }
    return {
      id: ph.id,
      name: ph.name,
      startYear: yearOf(timeline.constructionStart),
      constructionEndYear: yearOf(timeline.constructionEnd),
      operationsStartYear: yearOf(timeline.operationsStart),
      lines: planReportLines(lineState, (a) => a.phaseId === ph.id).length,
      landSqm: phaseLand,
      gfaSqm: phaseGfa,
      capex: phaseCapex,
      revenue,
      ebitda,
    };
  });

  // ── The exit, and the cash low point ─────────────────────────────────────
  const cash = snap.bs.cashPerPeriod ?? [];
  let cashLow = cash.length ? cash[0] : 0;
  let cashLowIdx = 0;
  cash.forEach((v, i) => { if (v < cashLow) { cashLow = v; cashLowIdx = i; } });

  return {
    returns,
    fundLayer,
    costPerSqm: {
      developmentCostPerGfa: safeDiv(totalDevelopmentCost, gfaSqm),
      constructionCostPerGfa: safeDiv(constructionCost, gfaSqm),
      developmentCostPerSaleable: safeDiv(totalDevelopmentCost, saleableSqm),
      revenuePerSaleable: safeDiv(totalRevenue, saleableSqm),
      totalDevelopmentCost,
      constructionCost,
      gfaSqm,
      saleableSqm,
    },
    scheme: {
      landSqm, landValue, gfaSqm, buaSqm, saleableSqm,
      plotRatio: safeDiv(gfaSqm, landSqm),
      units, keys, leasableSqm,
      lines: planReportLines(lineState).length,
    },
    byType,
    revenueMix,
    phases,
    exit: {
      year: rs.exitYearLabel,
      terminalValue: rs.terminalEnterpriseValue,
      gainOnDisposal: snap.disposal.gain,
      booked: snap.disposal.booked,
      peakDebt: Math.max(0, ...(snap.bs.debtOutstandingPerPeriod ?? [0])),
      cashLow,
      cashLowYear: snap.yearLabels[cashLowIdx] ?? null,
    },
  };
}
