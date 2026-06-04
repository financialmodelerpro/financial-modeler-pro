/**
 * cosReports.ts
 *
 * Shared pure builder for the Module 2 Cost of Sales tab. The financials
 * snapshot only carries the reduced CoS result (per-period / gross-margin /
 * cumulative), so this recomputes the per-asset CoS-V2 result the platform tab
 * renders (buildCostOfSalesV2) with the SAME inputs (computeAssetCost projected
 * onto the axis + IDC + the literal recognition profile), then shapes it into
 * the platform's currency tables: a Capex basis driver, the Vintage Matrix
 * (with a Total row), the CoS Summary, and the Inventory roll-forward, per Sell
 * asset, plus the project totals. fmt-parametrised for last-balance cells.
 *
 * Pure: reads the snapshot + state only.
 */
import { computeAssetCost } from '@/src/core/calculations';
import { buildCostOfSalesV2, type CostOfSalesV2Result } from '@/src/core/calculations/revenue';
import { resolveLiteralRecognitionProfile } from '../revenue-resolvers';
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';

export interface ReportTable { title: string; rows: M4Row[] }

const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

export function buildCostOfSalesReport(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: (v: number) => string): ReportTable[] {
  const N = snap.axisLength;
  const yl = snap.yearLabels;
  const projectStartYear = yl[0] ?? 0;
  const sellAssets = state.assets.filter((a) => a.visible !== false && (a.strategy === 'Sell' || a.strategy === 'Sell + Manage'));
  const tables: ReportTable[] = [];

  const projConstruction = new Array<number>(N).fill(0);
  const projOperations = new Array<number>(N).fill(0);
  const projTotal = new Array<number>(N).fill(0);
  const perAssetCos: Array<{ name: string; cos: CostOfSalesV2Result }> = [];

  for (const a of sellAssets) {
    const r = snap.revenue.bySellAsset.get(a.id);
    const phase = state.phases.find((p) => p.id === a.phaseId);
    if (!phase) continue;
    const breakdown = computeAssetCost(
      a, state.project, phase, state.parcels, state.assets, state.subUnits, state.costLines, state.costOverrides, state.landAllocationMode,
      state.project.financing?.parcelFunding,
    );
    const phaseStartYear = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const offset = Math.max(0, phaseStartYear - projectStartYear);
    // Capex projection: CoS uses offset-1 for the Y0 lump (Phase 1 drops it),
    // matching Module2CostOfSales exactly.
    const capexPerPeriod = new Array<number>(N).fill(0);
    const perAll = breakdown.perPeriod ?? [];
    for (let i = 0; i < perAll.length; i++) {
      const projIdx = i === 0 ? offset - 1 : offset + i - 1;
      if (projIdx >= 0 && projIdx < N) capexPerPeriod[projIdx] += perAll[i] ?? 0;
    }
    const idcRow = snap.idc.byAsset.get(a.id);
    const idcPerPeriod = idcRow?.idcPerPeriod ?? new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) capexPerPeriod[i] += idcPerPeriod[i] ?? 0;

    const assetSubUnits = state.subUnits.filter((u) => u.assetId === a.id);
    const allUnits = assetSubUnits.length > 0 && assetSubUnits.every((u) => u.metric === 'units');
    const presales = r ? (allUnits ? r.presalesUnitsPerPeriod : r.presalesAreaPerPeriod) : new Array<number>(N).fill(0);
    const postSales = r ? (allUnits ? r.postSalesUnitsPerPeriod : r.postSalesAreaPerPeriod) : new Array<number>(N).fill(0);
    const totalInventory = presales.reduce((s, v) => s + Math.max(0, v), 0) + postSales.reduce((s, v) => s + Math.max(0, v), 0);
    const derivedFallback = r?.presalesRecognitionPerPeriod ?? new Array<number>(N).fill(0);
    const { profile } = resolveLiteralRecognitionProfile(a, phase, projectStartYear, N, derivedFallback);
    const cos = buildCostOfSalesV2({ capexPerPeriod, presalesPerPeriod: presales, postSalesPerPeriod: postSales, recognitionPerPeriod: profile, totalInventory, axisLength: N });

    if (!anyNonZero(cos.totalCosPerPeriod)) continue;
    perAssetCos.push({ name: a.name, cos });
    for (let t = 0; t < N; t++) {
      projConstruction[t] += cos.cosConstructionPerPeriod[t] ?? 0;
      projOperations[t] += cos.cosOperationsPerPeriod[t] ?? 0;
      projTotal[t] += cos.totalCosPerPeriod[t] ?? 0;
    }

    // Capex basis driver (currency).
    tables.push({ title: `Cost of Sales Driver, ${a.name} (capex basis incl. IDC)`, rows: [
      { label: 'Capex per period (incl. capitalised IDC)', values: capexPerPeriod, isTotal: true },
    ] });

    // Vintage Matrix with a Total row (per-year column sums).
    const vmRows: M4Row[] = cos.vintageMatrix
      .map((m, i) => ({ label: `Spent in ${yl[i] ?? i}`, values: m.slice(0, N) }))
      .filter((rr) => anyNonZero(rr.values));
    if (vmRows.length) {
      const totals = new Array<number>(N).fill(0);
      for (const m of cos.vintageMatrix) for (let i = 0; i < N; i++) totals[i] += m[i] ?? 0;
      vmRows.push({ label: 'Total', values: totals, isTotal: true });
      tables.push({ title: `Cost of Sales Vintage Matrix, ${a.name}`, rows: vmRows });
    }

    // Summary (currency).
    tables.push({ title: `Cost of Sales Summary, ${a.name}`, rows: [
      { label: 'CoS during construction (pre-sales cohort)', values: cos.cosConstructionPerPeriod },
      { label: 'CoS during operations (post-handover sales)', values: cos.cosOperationsPerPeriod },
      { label: 'Total Cost of Sales', values: cos.totalCosPerPeriod, isTotal: true },
    ] });

    // Inventory roll-forward (currency).
    const opening = new Array<number>(N).fill(0);
    const balance = new Array<number>(N).fill(0);
    for (let t = 0; t < N; t++) {
      opening[t] = t === 0 ? 0 : balance[t - 1];
      balance[t] = opening[t] + (capexPerPeriod[t] ?? 0) - (cos.cosConstructionPerPeriod[t] ?? 0) - (cos.cosOperationsPerPeriod[t] ?? 0);
    }
    tables.push({ title: `Inventory Roll-Forward, ${a.name}`, rows: [
      { label: 'Opening balance', values: opening, totalOverride: fmt(0) },
      { label: '(+) Capex', values: capexPerPeriod },
      { label: '(-) Cost of Sales during construction', values: cos.cosConstructionPerPeriod.map((v) => -v) },
      { label: '(-) Cost of Sales during operations', values: cos.cosOperationsPerPeriod.map((v) => -v) },
      { label: 'Inventory balance', values: balance, isTotal: true, totalOverride: fmt(balance[N - 1] ?? 0) },
    ] });
  }

  // Project totals (Residential / Sell), per-asset rows + total.
  if (perAssetCos.length) {
    const sumOf = (pick: (c: CostOfSalesV2Result) => number[]): number[] => {
      const out = new Array<number>(N).fill(0);
      for (const { cos } of perAssetCos) { const s = pick(cos); for (let t = 0; t < N; t++) out[t] += s[t] ?? 0; }
      return out;
    };
    const mk = (title: string, pick: (c: CostOfSalesV2Result) => number[], totalLabel: string): ReportTable => ({
      title,
      rows: [
        { label: 'Residential / Sell', values: [], isSection: true },
        ...perAssetCos.map(({ name, cos }): M4Row => ({ label: name, values: pick(cos), indent: 1 })),
        { label: totalLabel, values: sumOf(pick), isTotal: true },
      ],
    });
    tables.push(mk('Project Cost of Sales, During Construction', (c) => c.cosConstructionPerPeriod, 'Total CoS during construction'));
    tables.push(mk('Project Cost of Sales, During Operations', (c) => c.cosOperationsPerPeriod, 'Total CoS during operations'));
    tables.push(mk('Project Total Cost of Sales', (c) => c.totalCosPerPeriod, 'Total Cost of Sales'));
  }

  return tables;
}
