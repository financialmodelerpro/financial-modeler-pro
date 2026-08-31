/**
 * cosReports.ts
 *
 * Shared pure SHAPER for the Module 2 Cost of Sales tab. It computes nothing:
 * it reads `snap.byAssetCostOfSales`, the one result the Module 2 layer built
 * (lib/costOfSales), and arranges it into the platform's currency tables, so
 * the screen, both PDFs and the workbook render the same numbers the P&L and
 * the balance sheet are built from.
 *
 * THE BUILD TABLE (2026-08-31). The tab used to open with a basis table that
 * stated the asset capex and the capitalised IDC as two LIFETIME SCALARS and
 * then jumped straight to the charge. Every number was right and the reader
 * still could not see where 254,301,654 came from: there was no year-by-year
 * view of the base, and no way to check that the base shown was the base
 * charged. The first table is now the build, year by year: Module 1 capex, the
 * capitalised IDC, the total base, the revenue recognised, the share that
 * revenue is of the lifetime total, and the cost of sales that share produces.
 * It ends on a check row that foots the build to the charge (see buildRows).
 *
 * Nothing here computes any of it. Both halves of the base and the recognition
 * share are carried on the result by `buildAssetCostOfSales`, which took them
 * from the Module 1 cost engine and `computeIdcSnapshot` respectively. This
 * file only lays them out.
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
const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

/**
 * The year-by-year build of the base, and the charge it produces.
 *
 * THE CHECK ROW does two jobs in one line, which is why it is one row and not
 * two. Per period it is (total base x that period's recognition share) less the
 * cost of sales booked in that period: zero in every year, which is exactly the
 * arithmetic a reader does when they multiply the Total base by the share on
 * the row above. In the Total column it is the INDEPENDENT scalar identity,
 * total base less total cost of sales, supplied as a totalOverride rather than
 * as the sum of the cells, so the footing is asserted on the two lifetime
 * figures themselves and not merely on a column of zeroes.
 */
function buildRows(cos: AssetCostOfSales, fmt: (v: number) => string, N: number): M4Row[] {
  const check = new Array<number>(N).fill(0);
  for (let t = 0; t < N; t++) {
    check[t] = cos.capexBase * (cos.recognitionSharePerPeriod[t] ?? 0) - (cos.cos.perPeriod[t] ?? 0);
  }
  return [
    { label: costOfSalesBasisLabel(fmt, cos.basis.assetCost, cos.basis.idc), values: [], isSection: true },
    { label: 'Capex, from Module 1', values: cos.assetCapexPerPeriod, indent: 1 },
    { label: 'Capitalised IDC', values: cos.idcCapitalisedPerPeriod, indent: 1 },
    { label: 'Total base charged through cost of sales', values: cos.capexPerPeriod, isSubtotal: true },
    { label: 'Revenue recognised', values: cos.recognitionPerPeriod, indent: 1 },
    { label: 'Recognition share of lifetime revenue', values: cos.recognitionSharePerPeriod, isPercent: true, indent: 1 },
    { label: 'Cost of Sales, total base x recognition share', values: cos.cos.perPeriod, isTotal: true },
    {
      label: 'Check, base x share less cost of sales; Total = total base less total cost of sales',
      values: check,
      totalOverride: fmt(cos.capexBase - sum(cos.cos.perPeriod)),
    },
  ];
}

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

    // The build, year by year, ending on the check that foots it to the charge.
    // The basis sentence is the section header, so the table still states what
    // the charge is computed on, including the capitalised IDC inside it.
    tables.push({ title: `Cost of Sales Build, ${a.name}`, rows: buildRows(cos, fmt, N) });

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
