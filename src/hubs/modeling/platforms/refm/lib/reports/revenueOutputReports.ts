/**
 * revenueOutputReports.ts (2026-09-17)
 *
 * PURE PRESENTATION BUILDERS FOR THE MODULE 2 OUTPUT, SCHEDULES AND PROJECT
 * TOTAL TABLES, lifted from the screens so the workbook prints the same rows
 * the platform shows rather than a hand-made summary of its own.
 *
 * WHY. The workbook's Revenue tab printed a flat per-line list with cash before
 * recognition, a single "Project Revenue Summary" of recognised revenue, and a
 * "Schedules" section that was really the Output tab's two roll-forwards. The
 * platform's Output tab reads share sold, units sold, closing inventory, price
 * per year, revenue, recognition and cash, in that order, closes on three
 * project tables grouped by section (sales value, recognised, cash collected),
 * and its Schedules tab is three feeds (income statement, balance sheet, cash
 * flow). These functions state each of those row sets once, so a surface that
 * renders them cannot re-word or re-order them.
 *
 * Every function here arranges engine results. Nothing computes a model value:
 * the line results are the sum of the plots' (`lineRevenueResults`), the cost of
 * sales is `sumAssetCostOfSales`, receivables use the engine's own builders.
 *
 * The screens still carry their own copies (Module2RevenueOutput's
 * buildProjectGroupedRows / buildShareSoldRows / buildPrePostRows and
 * Module2Schedules' feed memo); these are row-for-row the same and a screen can
 * switch to them without a visible change.
 *
 * No em dashes in this file.
 */

import type { M4Row } from '../../components/modules/_shared/m4Table';
import {
  buildAccountsReceivable, buildUnearnedRevenue, buildAccountsReceivableDSO,
} from '@/src/core/calculations/revenue';
import type { SellAssetResult } from '@/src/core/calculations/revenue/types';
import { lineRevenueResults, type ProjectRevenueSnapshot } from '../revenue-resolvers';
import { sumAssetCostOfSales, type AssetCostOfSales } from '../costOfSales';
import { REVENUE_SECTIONS, groupRevenueLines, type RevenueLine, type RevenueSection } from '../revenueLines';

/** THE LINE'S NAME on every Module 2 and Module 3 report table: its type label,
 *  then its phase. The Cost of Sales and Opex builders already name a line so. */
export function revenueLineName(line: Pick<RevenueLine, 'label' | 'phaseName'>): string {
  return line.phaseName ? `${line.label}, ${line.phaseName}` : line.label;
}

export interface TitledTable {
  title: string;
  /** One sentence stating what the table is, as the screen's caption does. */
  caption?: string;
  rows: M4Row[];
}

const sumArrays = (arrs: readonly (readonly number[])[], n: number): number[] => {
  const out = new Array<number>(n).fill(0);
  for (const a of arrs) for (let i = 0; i < n; i++) out[i] += a[i] ?? 0;
  return out;
};
const lastOf = (a: readonly number[], n: number): number => a[n - 1] ?? 0;

// ── Project Total (Module2RevenueOutput, "Project Total" section) ──────────

export type RevenueView = 'revenue' | 'recognition' | 'cash';

function pickSegment(r: SellAssetResult, view: RevenueView, segment: 'pre' | 'post'): number[] {
  if (view === 'revenue') return segment === 'pre' ? r.presalesRevenuePerPeriod : r.postSalesRevenuePerPeriod;
  if (view === 'recognition') return segment === 'pre' ? r.presalesRecognitionPerPeriod : r.postSalesRecognitionPerPeriod;
  return segment === 'pre' ? r.presalesCashPerPeriod : r.postSalesCashPerPeriod;
}

/** A project table grouped by section, each section the sum of its lines. A
 *  Sell line carries the Pre-Sales / Sales During Operation split on the
 *  recognition and cash views; an Operate or Lease line earns as it collects. */
export function buildProjectRevenueGroupedRows(
  view: RevenueView,
  lines: readonly RevenueLine[],
  lineResults: ReadonlyMap<string, ReturnType<typeof lineRevenueResults>>,
  axisLength: number,
): M4Row[] {
  const N = axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const rows: M4Row[] = [];
  const grand: number[][] = [];
  for (const g of groupRevenueLines(lines)) {
    rows.push({ label: g.section, values: [], isSection: true });
    const sectionSeries: number[][] = [];
    const sellLines = g.lines.filter((l) => l.form === 'sell');
    const operatingLines = g.lines.filter((l) => l.form !== 'sell');
    const operatingValues = (l: RevenueLine): number[] => {
      const res = lineResults.get(l.key);
      return res?.hospitality?.totalRevenuePerPeriod ?? res?.lease?.totalRevenuePerPeriod ?? zeros();
    };
    if (sellLines.length > 0 && view === 'revenue') {
      for (const l of sellLines) {
        const r = lineResults.get(l.key)?.sell;
        const pre = r ? pickSegment(r, 'revenue', 'pre') : zeros();
        const post = r ? pickSegment(r, 'revenue', 'post') : zeros();
        const combined = pre.slice(0, N).map((v, i) => v + (post[i] ?? 0));
        rows.push({ label: revenueLineName(l), values: combined, indent: 1 });
        sectionSeries.push(combined);
      }
    } else if (sellLines.length > 0) {
      rows.push({ label: 'Pre-Sales', values: [], isSection: true, indent: 1 });
      const preSeries: number[][] = [];
      for (const l of sellLines) {
        const r = lineResults.get(l.key)?.sell;
        const vals = r ? pickSegment(r, view, 'pre').slice(0, N) : zeros();
        rows.push({ label: revenueLineName(l), values: vals, indent: 2 });
        preSeries.push(vals);
      }
      const preTotal = sumArrays(preSeries, N);
      rows.push({ label: 'Total Pre-Sales', values: preTotal, isSubtotal: true, indent: 1 });
      rows.push({ label: 'Sales During Operation', values: [], isSection: true, indent: 1 });
      const postSeries: number[][] = [];
      for (const l of sellLines) {
        const r = lineResults.get(l.key)?.sell;
        const vals = r ? pickSegment(r, view, 'post').slice(0, N) : zeros();
        rows.push({ label: revenueLineName(l), values: vals, indent: 2 });
        postSeries.push(vals);
      }
      const postTotal = sumArrays(postSeries, N);
      rows.push({ label: 'Total Sales During Operation', values: postTotal, isSubtotal: true, indent: 1 });
      sectionSeries.push(preTotal, postTotal);
    }
    for (const l of operatingLines) {
      const vals = operatingValues(l).slice(0, N);
      rows.push({ label: revenueLineName(l), values: vals, indent: 1 });
      sectionSeries.push(vals);
    }
    const sectionTotal = sumArrays(sectionSeries, N);
    rows.push({ label: `Total ${g.section}`, values: sectionTotal, isTotal: true });
    grand.push(sectionTotal);
  }
  if (grand.length > 0) rows.push({ label: 'Total Project', values: sumArrays(grand, N), isTotal: true });
  return rows;
}

export const PROJECT_REVENUE_TABLES: ReadonlyArray<{ view: RevenueView; title: string; caption: string }> = [
  { view: 'revenue', title: 'Project Revenue (Sales Value year-on-year)', caption: 'Per-line breakdown grouped by section. A Sell line shows Pre-Sales + Sales During Operation combined; an Operate or Lease line its total revenue. Every line is the sum of its plots.' },
  { view: 'recognition', title: 'Project Revenue Recognised', caption: 'Per-line breakdown grouped by section. Sell Pre-Sales = recognition profile spread; Sales During Operation = same-period (operating); Operate and Lease lines recognise as earned.' },
  { view: 'cash', title: 'Project Cash Collected', caption: 'Per-line breakdown grouped by section. Sell Pre-Sales = sale cohort terms; Sales During Operation = same-period (operating); Operate and Lease lines collect as earned (receivable days apply on Schedules).' },
];

// ── Sell line blocks 1 and 2 (Module2RevenueOutput) ────────────────────────

/** 1a. Sold over total inventory per row and per year, pre and post in one row.
 *  The Total column states the lifetime share sold. */
export function buildShareSoldRows(
  subUnits: ReadonlyArray<{ id: string; name: string }>,
  inventoryPerSU: readonly number[],
  preSU: Readonly<Record<string, number[]>>,
  postSU: Readonly<Record<string, number[]>>,
  assetInventory: number,
  axisLength: number,
): M4Row[] {
  const N = axisLength;
  const rows: M4Row[] = [];
  const assetSold = new Array<number>(N).fill(0);
  subUnits.forEach((su, idx) => {
    const inv = Math.max(0, inventoryPerSU[idx] ?? 0);
    const pre = preSU[su.id] ?? [];
    const post = postSU[su.id] ?? [];
    const share = new Array<number>(N).fill(0);
    let sold = 0;
    for (let i = 0; i < N; i++) {
      const v = (pre[i] ?? 0) + (post[i] ?? 0);
      assetSold[i] += v;
      sold += v;
      share[i] = inv > 0 ? v / inv : 0;
    }
    rows.push({ label: su.name || 'sub-unit', values: share, isPercent: true, totalValue: inv > 0 ? sold / inv : 0 });
  });
  const soldTotal = assetSold.reduce((s, v) => s + v, 0);
  rows.push({
    label: 'Asset Total', values: assetSold.map((v) => (assetInventory > 0 ? v / assetInventory : 0)),
    isPercent: true, isTotal: true, totalValue: assetInventory > 0 ? soldTotal / assetInventory : 0,
  });
  return rows;
}

/** 1b and 2b. One row per sub-unit (pre + post), the two totals, the grand total. */
export function buildPrePostRows(
  subUnits: ReadonlyArray<{ id: string; name: string }>,
  preSU: Readonly<Record<string, number[]>>,
  postSU: Readonly<Record<string, number[]>>,
  preTotal: readonly number[],
  postTotal: readonly number[],
  axisLength: number,
  labels: { preLabel: string; postLabel: string; grandLabel: string },
  valueKind?: M4Row['valueKind'],
): M4Row[] {
  const N = axisLength;
  const rows: M4Row[] = [];
  for (const su of subUnits) {
    const pre = preSU[su.id] ?? [];
    const post = postSU[su.id] ?? [];
    rows.push({ label: su.name || 'sub-unit', values: Array.from({ length: N }, (_, i) => (pre[i] ?? 0) + (post[i] ?? 0)), valueKind });
  }
  rows.push({ label: labels.preLabel, values: preTotal.slice(0, N), isSubtotal: true, valueKind });
  rows.push({ label: labels.postLabel, values: postTotal.slice(0, N), isSubtotal: true, valueKind });
  rows.push({ label: labels.grandLabel, values: Array.from({ length: N }, (_, i) => (preTotal[i] ?? 0) + (postTotal[i] ?? 0)), isTotal: true, valueKind });
  return rows;
}

// ── Schedules (Module2Schedules: three feeds) ──────────────────────────────

/** Below this a feed value is residue, not a balance (the screen's snap). */
const FEED_ZERO = 1;

interface LineFeed {
  name: string;
  section: RevenueSection;
  revenue: number[]; cashCollected: number[];
  cosConstr: number[]; cosOps: number[]; totalCos: number[];
  inventory: number[]; ar: number[]; ur: number[]; capex: number[];
}

/** The per-line feed the Schedules tab reads: revenue, cash, cost of sales,
 *  inventory, receivables, unearned and capex, the SUM of each line's plots. */
export function buildRevenueLineFeeds(
  revenue: ProjectRevenueSnapshot,
  lines: readonly RevenueLine[],
  byAssetCostOfSales: ReadonlyMap<string, AssetCostOfSales> | undefined,
): LineFeed[] {
  const N = revenue.axisLength;
  const zeros = (): number[] => new Array<number>(N).fill(0);
  const snap = (a: readonly number[]): number[] => a.slice(0, N).map((v) => (Math.abs(v) < FEED_ZERO ? 0 : Math.max(0, v)));
  const out: LineFeed[] = [];
  for (const line of lines) {
    const a = line.host;
    const memberIds = line.members.map((m) => m.id);
    const res = lineRevenueResults(memberIds, revenue, line.key);
    const base = { name: revenueLineName(line), section: line.section };
    if (line.form === 'sell') {
      const r = res.sell;
      if (!r) continue;
      const cos = byAssetCostOfSales
        ? sumAssetCostOfSales(memberIds.map((id) => byAssetCostOfSales.get(id)).filter((c): c is AssetCostOfSales => !!c), line.key, N)
        : null;
      const ar = buildAccountsReceivable(r.presalesRevenuePerPeriod, r.presalesCashPerPeriod, N);
      const ur = buildUnearnedRevenue(r.presalesRecognitionPerPeriod, r.presalesRevenuePerPeriod, N);
      out.push({
        ...base,
        revenue: r.recognitionPerPeriod.slice(0, N),
        cashCollected: r.cashCollectedPerPeriod.slice(0, N),
        cosConstr: cos ? cos.cosPresalesPerPeriod.slice(0, N) : zeros(),
        cosOps: cos ? cos.cosPostSalesPerPeriod.slice(0, N) : zeros(),
        totalCos: cos ? cos.cos.perPeriod.slice(0, N) : zeros(),
        inventory: cos ? cos.inventoryPerPeriod.slice(0, N) : zeros(),
        ar: snap(ar.perPeriod), ur: snap(ur.perPeriod),
        capex: cos ? cos.capexPerPeriod.slice(0, N) : zeros(),
      });
      continue;
    }
    const operating = line.form === 'operate' ? res.hospitality : res.lease;
    if (!operating) continue;
    const arDso = buildAccountsReceivableDSO({
      revenuePerPeriod: operating.totalRevenuePerPeriod,
      dsoDays: line.form === 'operate' ? (a.revenue?.operate?.dso ?? 30) : (a.revenue?.lease?.arDays ?? 30),
      daysPerYear: line.form === 'operate' ? (a.revenue?.operate?.daysPerYear ?? 365) : 365,
      axisLength: N,
    });
    out.push({
      ...base,
      revenue: operating.totalRevenuePerPeriod.slice(0, N),
      cashCollected: arDso.cashReceivedPerPeriod.slice(0, N),
      cosConstr: zeros(), cosOps: zeros(), totalCos: zeros(), inventory: zeros(),
      ar: snap(arDso.perPeriod), ur: zeros(), capex: zeros(),
    });
  }
  return out;
}

/** THE THREE FEEDS, in the Schedules tab's order and wording. A flow row's
 *  Total is its sum; a stock row's is its closing balance. */
export function buildRevenueScheduleFeeds(
  revenue: ProjectRevenueSnapshot,
  lines: readonly RevenueLine[],
  byAssetCostOfSales: ReadonlyMap<string, AssetCostOfSales> | undefined,
): Array<{ group: string; meta: string; tables: TitledTable[] }> {
  const N = revenue.axisLength;
  const feeds = buildRevenueLineFeeds(revenue, lines, byAssetCostOfSales);
  const bySection = REVENUE_SECTIONS
    .map((section) => ({ section, lines: feeds.filter((f) => f.section === section) }))
    .filter((g) => g.lines.length > 0);
  const has = (a: readonly number[]): boolean => a.some((v) => Math.abs(v) >= FEED_ZERO);
  type Field = 'revenue' | 'cashCollected' | 'ar' | 'inventory' | 'ur' | 'capex';
  const stock = (f: Field): boolean => f === 'ar' || f === 'inventory' || f === 'ur';
  const row = (label: string, values: number[], f: Field, extra: Partial<M4Row> = {}): M4Row => (
    stock(f) ? { label, values, totalValue: lastOf(values, N), totalIsBalance: true, ...extra } : { label, values, ...extra }
  );
  const total = (f: Field): number[] => sumArrays(feeds.map((x) => x[f]), N);

  const grouped = (f: Field, grandLabel: string): M4Row[] => {
    const rows: M4Row[] = [];
    for (const g of bySection) {
      const active = g.lines.filter((x) => has(x[f]));
      if (active.length === 0) continue;
      rows.push({ label: g.section, values: [], isSection: true });
      for (const x of active) rows.push(row(x.name, x[f], f, { indent: 1 }));
      rows.push(row(`Total ${g.section}`, sumArrays(active.map((x) => x[f]), N), f, { isSubtotal: true }));
    }
    const grand = total(f);
    if (has(grand)) rows.push(row(grandLabel, grand, f, { isTotal: true }));
    return rows;
  };
  const sectioned = (f: Field, labelOf: (x: LineFeed) => string, totalLabel: string): M4Row[] => {
    const rows: M4Row[] = [];
    for (const g of bySection) {
      const active = g.lines.filter((x) => has(x[f]));
      if (active.length === 0) continue;
      rows.push({ label: g.section, values: [], isSection: true });
      for (const x of active) rows.push(row(labelOf(x), x[f], f, { indent: 1 }));
    }
    if (rows.length > 0) rows.push(row(totalLabel, total(f), f, { isTotal: true }));
    return rows;
  };

  const totalRevenue = total('revenue');
  const totalCos = sumArrays(feeds.map((x) => x.totalCos), N);
  const cosRows: M4Row[] = [];
  for (const g of bySection) {
    const active = g.lines.filter((x) => has(x.totalCos));
    if (active.length === 0) continue;
    cosRows.push({ label: g.section, values: [], isSection: true });
    for (const x of active) {
      cosRows.push({ label: `${x.name}, CoS during construction`, values: x.cosConstr, indent: 1 });
      cosRows.push({ label: `${x.name}, CoS during operations`, values: x.cosOps, indent: 1 });
      cosRows.push({ label: `${x.name}, Total Cost of Sales`, values: x.totalCos, indent: 1, isSubtotal: true });
    }
  }
  if (cosRows.length > 0) cosRows.push({ label: 'Total Cost of Sales', values: totalCos, isTotal: true });

  const pl: TitledTable[] = [
    { title: 'Revenue (P&L)', caption: 'Per-line revenue grouped by section. Hospitality, Lease and Sales During Operation recognise revenue = cash in the same period; Sell pre-sales follow the recognition profile on Inputs.', rows: grouped('revenue', 'Total Revenue') },
  ];
  if (cosRows.length > 0) pl.push({ title: 'Cost of Sales (P&L)', caption: 'Per-line cost of sales for Sell lines. Hospitality and Lease lines carry no cost of sales (their capex stays on the balance sheet and is depreciated).', rows: cosRows });
  pl.push({ title: 'Gross Margin (P&L)', caption: 'Revenue less Cost of Sales.', rows: [
    { label: 'Revenue', values: totalRevenue },
    { label: '(-) Cost of Sales', values: totalCos.map((v) => -v) },
    { label: 'Gross Margin', values: totalRevenue.map((v, i) => v - (totalCos[i] ?? 0)), isTotal: true },
  ] });

  const bs: TitledTable[] = [];
  const inv = sectioned('inventory', (x) => x.name, 'Total Inventory');
  if (inv.length > 0) bs.push({ title: 'Inventory (closing balances)', caption: 'Sell-strategy work in progress and completed but unsold inventory. Settles to 0 once cumulative cost of sales recognises all of the capex.', rows: inv });
  bs.push({ title: 'Accounts Receivable (closing balances)', caption: 'Sell AR: pre-sales sale value not yet collected. Hospitality and Lease AR: revenue x receivable days / 365.', rows: grouped('ar', 'Total Accounts Receivable') });
  const ur = sectioned('ur', (x) => x.name, 'Total Unearned Revenue');
  if (ur.length > 0) bs.push({ title: 'Unearned Revenue (closing balances)', caption: 'Pre-sales sale value not yet recognised. Sell lines only; Hospitality and Lease recognise revenue in the period it is earned.', rows: ur });

  const cf: TitledTable[] = [
    { title: 'Cash Collected from Customers (per line)', caption: 'Sell: the sale cohort terms. Hospitality and Lease: revenue less the movement in receivables (receivable days).', rows: grouped('cashCollected', 'Total Cash from Customers') },
  ];
  const capex = sectioned('capex', (x) => `${x.name}, Capex`, 'Total Capex');
  if (capex.length > 0) cf.push({ title: 'Capex (per Sell line)', caption: 'Module 1 capex including the capitalised IDC, on the project axis: the base cost of sales is spread on.', rows: capex });

  return [
    { group: 'Income Statement Feed', meta: 'Revenue, Cost of Sales and Gross Margin (per line, grouped, total)', tables: pl },
    { group: 'Balance Sheet Feed', meta: 'Per-line closing balances per period', tables: bs },
    { group: 'Cash Flow Feed', meta: 'Cash collected and capex per line, composed into the full cash flow statement in Module 4', tables: cf },
  ];
}
