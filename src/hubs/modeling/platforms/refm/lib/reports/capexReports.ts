/**
 * capexReports.ts
 *
 * Shared pure builder for the Module 1 Capex tab (Input cost lines per asset +
 * the "Results" output tables), so the PDF export mirrors the platform and
 * stays in sync. Recomputes the per-asset cost breakdown with the SAME engine
 * call the financials resolver uses (computeAssetCost + project.financing
 * .parcelFunding) and projects each per-period series onto the project axis with
 * the SAME offset rule (capex.ts), so the per-asset rows reconcile to the
 * project capex totals on the snapshot.
 *
 * Pure: reads the financials snapshot + project state only; no engine mutation.
 */
import { computeAssetCost, resolveAssetAreaMetrics, type AssetAreaMetrics } from '@/src/core/calculations';
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';

export type MetricKind = 'area' | 'count' | 'none';

export interface CapexInputLine {
  name: string;
  stage: string;
  basis: string;
  /** Rate or fixed value the user entered. */
  rate: number;
  isFixed: boolean;
  /** Quantity the rate multiplies (BUA/NSA/GFA/land sqm, unit count, etc.). */
  metricValue: number | null;
  metricLabel: string;
  metricKind: MetricKind;
  /** Engine-computed amount for this line on this asset. */
  amount: number;
}
export interface CapexInputAsset { assetName: string; phaseName: string; lines: CapexInputLine[]; total: number }
export interface CapexResultTable { title: string; rows: M4Row[] }
export interface CapexReport { inputAssets: CapexInputAsset[]; results: CapexResultTable[] }

/** Human label for a cost line's method = what its rate multiplies. */
function basisLabel(method?: string): string {
  switch (method) {
    case 'fixed': return 'Fixed (lump sum)';
    case 'rate_per_land': return 'per Land sqm';
    case 'rate_per_nda': return 'per NDA sqm';
    case 'rate_per_roads': return 'per Roads sqm';
    case 'rate_per_gfa': return 'per GFA sqm';
    case 'rate_per_bua': return 'per BUA sqm';
    case 'rate_per_nsa': return 'per NSA sqm';
    case 'rate_per_unit': return 'per Unit';
    case 'rate_per_parking_bay': return 'per Parking bay';
    case 'percent_of_construction': return '% of Construction';
    case 'percent_of_selected': return '% of Selected lines';
    case 'percent_of_total_land': return '% of Total land';
    case 'percent_of_cash_land': return '% of Cash land';
    case 'percent_of_inkind_land': return '% of In-kind land';
    case 'percent_of_total_revenue': return '% of Total revenue';
    default: return method ?? '-';
  }
}
/** Quantity a rate-based method multiplies (for the Capex input "Quantity" column). */
function metricFor(method: string | undefined, m: AssetAreaMetrics): { value: number | null; label: string; kind: MetricKind } {
  switch (method) {
    case 'rate_per_land': return { value: m.landSqm, label: 'Land sqm', kind: 'area' };
    case 'rate_per_nda': return { value: m.ndaSqm, label: 'NDA sqm', kind: 'area' };
    case 'rate_per_roads': return { value: m.roadsSqm, label: 'Roads sqm', kind: 'area' };
    case 'rate_per_gfa': return { value: m.gfa, label: 'GFA sqm', kind: 'area' };
    case 'rate_per_bua': return { value: m.bua, label: 'BUA sqm', kind: 'area' };
    case 'rate_per_nsa': return { value: m.nsa, label: 'NSA sqm', kind: 'area' };
    case 'rate_per_unit': return { value: m.unitCount, label: 'units', kind: 'count' };
    case 'rate_per_parking_bay': return { value: m.parkingBays, label: 'bays', kind: 'count' };
    default: return { value: null, label: '', kind: 'none' };
  }
}

/** Project a phase-relative per-period series onto the project axis (same rule
 *  as financing/capex.ts: local i=0 -> max(0, offset-1); i>=1 -> offset+i-1). */
function projectOntoAxis(perPeriod: number[], offset: number, N: number): number[] {
  const out = new Array<number>(N).fill(0);
  for (let i = 0; i < perPeriod.length; i++) {
    const projIdx = i === 0 ? Math.max(0, offset - 1) : offset + i - 1;
    if (projIdx >= 0 && projIdx < N) out[projIdx] += perPeriod[i] ?? 0;
  }
  return out;
}

const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

export function buildCapexReport(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState): CapexReport {
  const { project, phases, assets, parcels, subUnits, costLines, costOverrides, landAllocationMode } = state;
  const N = snap.yearLabels.length;
  const projectStartYear = snap.projectStartYear;
  const lineById = new Map(costLines.map((c) => [c.id, c] as const));

  interface AssetCapex {
    name: string;
    phaseName: string;
    inclAll: number[];
    exclInKind: number[];
    exclAll: number[];
    perLine: Array<{ name: string; values: number[] }>;
  }
  const inputAssets: CapexInputAsset[] = [];
  const assetCapex: AssetCapex[] = [];

  for (const a of assets) {
    if (a.visible === false) continue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;
    const breakdown = computeAssetCost(
      a, project, phase, parcels, assets, subUnits, costLines, costOverrides, landAllocationMode,
      project.financing?.parcelFunding,
    );
    if ((breakdown.total ?? 0) === 0) continue;
    const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    const metrics = resolveAssetAreaMetrics(a, project, parcels, assets.filter((x) => x.phaseId === a.phaseId), subUnits, landAllocationMode);

    // Input: one row per contributing cost line, with the per-metric quantity
    // and the engine amount.
    const lines: CapexInputLine[] = [];
    for (const [lineId, amount] of Object.entries(breakdown.byLineId)) {
      if (!amount) continue;
      const cl = lineById.get(lineId);
      if (!cl) continue;
      const met = metricFor(cl.method, metrics);
      lines.push({
        name: cl.name,
        stage: String(cl.stage ?? '-'),
        basis: basisLabel(cl.method),
        rate: cl.value,
        isFixed: cl.method === 'fixed',
        metricValue: met.value,
        metricLabel: met.label,
        metricKind: met.kind,
        amount,
      });
    }
    if (lines.length) inputAssets.push({ assetName: a.name, phaseName: phase.name, lines, total: breakdown.total });

    // Results: project each per-period variant onto the axis.
    const inclAll = projectOntoAxis(breakdown.perPeriod ?? [], offset, N);
    const landTotal = projectOntoAxis(breakdown.perPeriodLandTotal ?? [], offset, N);
    const landInKind = projectOntoAxis(breakdown.perPeriodLandInKind ?? [], offset, N);
    const exclInKind = inclAll.map((v, i) => v - (landInKind[i] ?? 0));
    const exclAll = inclAll.map((v, i) => v - (landTotal[i] ?? 0));
    const perLine = Object.entries(breakdown.perLinePerPeriod ?? {})
      .map(([lineId, series]) => ({ name: lineById.get(lineId)?.name ?? lineId, values: projectOntoAxis(series, offset, N) }))
      .filter((r) => anyNonZero(r.values));
    assetCapex.push({ name: a.name, phaseName: phase.name, inclAll, exclInKind, exclAll, perLine });
  }

  // Project totals from the snapshot (authoritative; per-asset rows reconcile).
  const cap = snap.financing.capex.perPeriod;
  const totalInclAll = cap.inclAllLand.slice(0, N);
  const totalExclInKind = cap.exclLandInKind.slice(0, N);
  const totalExclAll = cap.exclAllLand.slice(0, N);

  const results: CapexResultTable[] = [];

  // Table 1: per-cost-line, per-asset schedule.
  const t1Rows: M4Row[] = [];
  for (const ac of assetCapex) {
    if (!anyNonZero(ac.inclAll)) continue;
    t1Rows.push({ label: ac.name, values: [], isSection: true });
    for (const ln of ac.perLine) t1Rows.push({ label: ln.name, values: ln.values, indent: 1 });
    t1Rows.push({ label: `Subtotal, ${ac.name}`, values: ac.inclAll, isSubtotal: true });
  }
  if (t1Rows.length) {
    t1Rows.push({ label: 'Project Total (incl. all land)', values: totalInclAll, isTotal: true });
    results.push({ title: 'Capex Schedule by Period (per cost line, per asset)', rows: t1Rows });
  }

  // Tables 2-4: per-asset rows + project total.
  const summaryTable = (title: string, pick: (ac: AssetCapex) => number[], total: number[], totalLabel: string): CapexResultTable => ({
    title,
    rows: [
      ...assetCapex.filter((ac) => anyNonZero(pick(ac))).map((ac): M4Row => ({ label: ac.name, values: pick(ac), indent: 1 })),
      { label: totalLabel, values: total, isTotal: true },
    ],
  });
  results.push(summaryTable('Total Capex (incl. all land)', (ac) => ac.inclAll, totalInclAll, 'Total Capex (incl. all land)'));
  results.push(summaryTable('Capex excl. Land In-Kind (cash-impact schedule)', (ac) => ac.exclInKind, totalExclInKind, 'Total Capex (excl. land in-kind)'));
  results.push(summaryTable('Capex excl. Total Land (pure development cost)', (ac) => ac.exclAll, totalExclAll, 'Total Capex (excl. all land)'));

  return { inputAssets, results };
}
