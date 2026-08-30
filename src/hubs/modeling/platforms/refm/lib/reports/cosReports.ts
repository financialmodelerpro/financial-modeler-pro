/**
 * cosReports.ts
 *
 * Shared pure SHAPER for the Module 2 Cost of Sales tab. It computes nothing:
 * it reads `snap.byAssetCostOfSales`, the one result the Module 2 layer built
 * (lib/costOfSales), and arranges it into the platform's currency tables, so
 * the screen, both PDFs and the workbook render the same numbers the P&L and
 * the balance sheet are built from.
 *
 * WHAT THIS FILE USED TO DO, and why it does not any more (2026-08-30): it
 * RE-COMPUTED cost of sales with a second engine (buildCostOfSalesV2) on a
 * capex base it assembled itself, including a hand-rolled Y0 placement rule
 * that dropped a phase-1 lump off the axis. On the live projects that put the
 * exports up to 407,131,731 away from the P&L in a single year. There is now
 * exactly one computation, upstream, and this file is downstream of it.
 *
 * Pure: reads the snapshot only.
 *
 * No em dashes in this file.
 */
import { costOfSalesBasisLabel, type AssetCostOfSales } from '../costOfSales';
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';

export interface ReportTable { title: string; rows: M4Row[] }

const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

export function buildCostOfSalesReport(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState, fmt: (v: number) => string): ReportTable[] {
  const N = snap.axisLength;
  const yl = snap.yearLabels;
  const tables: ReportTable[] = [];
  const perAsset: Array<{ name: string; cos: AssetCostOfSales }> = [];

  for (const a of state.assets) {
    if (a.visible === false) continue;
    const cos = snap.byAssetCostOfSales.get(a.id);
    if (!cos || !anyNonZero(cos.cos.perPeriod)) continue;
    perAsset.push({ name: a.name, cos });

    // The basis, stated on the row: what the charge is computed on, INCLUDING
    // the capitalised IDC inside it, the way a marketing line states its own.
    tables.push({ title: `Cost of Sales Basis, ${a.name}`, rows: [
      { label: costOfSalesBasisLabel(fmt, cos.basis.assetCost, cos.basis.idc), values: [], isSection: true },
      { label: 'Asset capex', values: [], totalOverride: fmt(cos.basis.assetCost) },
      { label: 'Capitalised IDC', values: [], totalOverride: fmt(cos.basis.idc) },
      { label: 'Capex base charged through cost of sales', values: cos.capexPerPeriod, isTotal: true },
    ] });

    // Vintage matrix (capex period x recognition period), with a Total row.
    const vmRows: M4Row[] = cos.vintageMatrix
      .map((m, i) => ({ label: `Spent in ${yl[i] ?? i}`, values: m.slice(0, N) }))
      .filter((rr) => anyNonZero(rr.values));
    if (vmRows.length) {
      const totals = new Array<number>(N).fill(0);
      for (const m of cos.vintageMatrix) for (let i = 0; i < N; i++) totals[i] += m[i] ?? 0;
      vmRows.push({ label: 'Total', values: totals, isTotal: true });
      tables.push({ title: `Cost of Sales Vintage Matrix, ${a.name}`, rows: vmRows });
    }

    // Summary. The split is by WHICH recognition drove the charge, and the two
    // rows sum to the total exactly; it is not a second computation.
    tables.push({ title: `Cost of Sales Summary, ${a.name}`, rows: [
      { label: 'On pre-sales recognition', values: cos.cosPresalesPerPeriod },
      { label: 'On post-handover sales', values: cos.cosPostSalesPerPeriod },
      { label: 'Total Cost of Sales', values: cos.cos.perPeriod, isTotal: true },
    ] });

    // Inventory roll-forward. THE SAME series the balance sheet carries.
    const opening = new Array<number>(N).fill(0);
    for (let t = 0; t < N; t++) opening[t] = t === 0 ? 0 : (cos.inventoryPerPeriod[t - 1] ?? 0);
    tables.push({ title: `Inventory Roll-Forward, ${a.name}`, rows: [
      { label: 'Opening balance', values: opening, totalOverride: fmt(0) },
      { label: '(+) Capex (incl. capitalised IDC)', values: cos.capexPerPeriod },
      { label: '(-) Cost of Sales', values: cos.cos.perPeriod.map((v) => -v) },
      { label: 'Inventory balance (as carried on the balance sheet)', values: cos.inventoryPerPeriod, isTotal: true, totalOverride: fmt(cos.inventoryPerPeriod[N - 1] ?? 0) },
    ] });
  }

  if (perAsset.length) {
    const sumOf = (pick: (c: AssetCostOfSales) => number[]): number[] => {
      const out = new Array<number>(N).fill(0);
      for (const { cos } of perAsset) { const s = pick(cos); for (let t = 0; t < N; t++) out[t] += s[t] ?? 0; }
      return out;
    };
    const mk = (title: string, pick: (c: AssetCostOfSales) => number[], totalLabel: string): ReportTable => ({
      title,
      rows: [
        { label: 'Residential / Sell', values: [], isSection: true },
        ...perAsset.map(({ name, cos }): M4Row => ({ label: name, values: pick(cos), indent: 1 })),
        { label: totalLabel, values: sumOf(pick), isTotal: true },
      ],
    });
    tables.push(mk('Project Cost of Sales, On Pre-Sales Recognition', (c) => c.cosPresalesPerPeriod, 'Total on pre-sales recognition'));
    tables.push(mk('Project Cost of Sales, On Post-Handover Sales', (c) => c.cosPostSalesPerPeriod, 'Total on post-handover sales'));
    tables.push(mk('Project Total Cost of Sales', (c) => c.cos.perPeriod, 'Total Cost of Sales'));
  }

  return tables;
}
