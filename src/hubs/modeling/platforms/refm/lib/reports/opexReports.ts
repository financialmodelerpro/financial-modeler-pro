/**
 * opexReports.ts
 *
 * Shared pure builder for the Module 3 Opex Output structure. The Opex Output
 * tab, the PDF and the workbook all render THIS list of titled tables, so the
 * three cannot disagree about what a line's operating costs are.
 *
 * PER LINE, FILED BY SECTION (2026-09-14). A line is one type in one phase
 * across its plots (lib/revenueLines), and each table carries the line's
 * `section` and `lineKey` so a screen can group it. Until this rewrite the
 * builder walked assets, and the tab beside it filed by `strategy === 'Operate'
 * || isCompanion`, which put both retail ground-floor strips under Hospitality
 * as well as Retail and counted their property management twice.
 *
 * HOSPITALITY is the hotel operating statement (lib/reports/hospitalityStatement):
 * operating statistics, then revenue by department down to GOP and EBITDA.
 *
 * LEASE counts every enabled line. The old routing mapped `mgmt_base`,
 * `repairs_maintenance`, `rent_insurance` and `utilities` to property
 * operating costs and dropped `indirect_*` on the floor, and the default lease
 * seed's property management line IS `indirect_ga`: on the live project that
 * was 21.46m on one line's tables, missing from the only tables that showed
 * lease costs.
 *
 * Pure: reads the revenue and opex snapshots and the project state only.
 */
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';
import { planRevenueLines, type RevenueSection } from '../revenueLines';
import {
  buildHospitalityStatement, hospitalityStatisticsRows, hospitalityStatementRows,
} from './hospitalityStatement';

export interface ReportTable {
  title: string;
  rows: M4Row[];
  /** The section and line a per-line table belongs to; absent on the project rollup. */
  section?: RevenueSection;
  lineKey?: string;
}

export type LeaseCostBucket = 'operating' | 'recoveries' | 'other_charges';

/** THE ONE ROUTING of a lease opex line. Service charge (`cam`) is the
 *  recoverable memo; charges on the property are other charges; everything
 *  that runs the property, `indirect_*` included, is operating. */
export function leaseCostBucket(category: string): LeaseCostBucket {
  if (category === 'cam') return 'recoveries';
  if (category === 'property_tax' || category === 'replacement_reserve' || category === 'other') return 'other_charges';
  return 'operating';
}

export type OpexReportSnap = Pick<ProjectFinancialsSnapshot, 'opex' | 'revenue' | 'axisLength'>;
export type OpexReportState = Pick<FinancialsResolverState, 'assets' | 'subUnits' | 'phases' | 'project'>;

const anyNonZero = (a: readonly number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

export function buildOpexReport(snap: OpexReportSnap, state: OpexReportState): ReportTable[] {
  const opex = snap.opex;
  const rev = snap.revenue;
  const N = snap.axisLength;
  const z = (): number[] => new Array<number>(N).fill(0);
  const tables: ReportTable[] = [];
  const hospitalitySummary: Array<{ name: string; revenue: number[]; gop: number[]; ebitda: number[] }> = [];

  for (const line of planRevenueLines(state.assets, state.subUnits, state.phases, state.project)) {
    const name = line.phaseName ? `${line.label}, ${line.phaseName}` : line.label;
    const tag = { section: line.section, lineKey: line.key };

    if (line.form === 'operate') {
      const members = line.members.filter((a) => a.strategy === 'Operate' && opex.byAsset.has(a.id));
      if (members.length === 0) continue;
      const st = buildHospitalityStatement(
        members.map((a) => ({ asset: a, opex: opex.byAsset.get(a.id), revenue: rev.byHospitalityAsset.get(a.id) })),
        N, line.key,
      );
      if (!anyNonZero(st.revenue.totalRevenuePerPeriod) && !anyNonZero(st.totalOpex)) continue;
      const stats = hospitalityStatisticsRows(st);
      if (stats.length > 0) tables.push({ ...tag, title: `${name}: Operating statistics`, rows: stats });
      tables.push({ ...tag, title: `${name}: Operating statement`, rows: hospitalityStatementRows(st) });
      hospitalitySummary.push({ name, revenue: st.revenue.totalRevenuePerPeriod, gop: st.gop, ebitda: st.ebitda });
      continue;
    }

    if (line.form !== 'lease') continue;
    const members = line.members.filter((a) => a.strategy === 'Lease' && opex.byAsset.has(a.id));
    if (members.length === 0) continue;
    const revenue = z();
    const totalOpex = z();
    const buckets: Record<LeaseCostBucket, Map<string, number[]>> = {
      operating: new Map(), recoveries: new Map(), other_charges: new Map(),
    };
    for (const a of members) {
      const lr = rev.byLeaseAsset.get(a.id);
      const r = opex.byAsset.get(a.id);
      for (let t = 0; t < N; t++) {
        revenue[t] += lr?.totalRevenuePerPeriod[t] ?? 0;
        totalOpex[t] += r?.totalOpexPerPeriod[t] ?? 0;
      }
      const per = r?.perLinePerPeriod ?? [];
      (a.opex?.lines ?? []).forEach((ln, i) => {
        if (ln.disabled) return;
        const bucket = buckets[leaseCostBucket(String(ln.category))];
        const acc = bucket.get(ln.name) ?? z();
        const src = per[i] ?? [];
        for (let t = 0; t < N; t++) acc[t] += src[t] ?? 0;
        bucket.set(ln.name, acc);
      });
    }
    if (!anyNonZero(revenue) && !anyNonZero(totalOpex)) continue;
    tables.push({ ...tag, title: `${name}: Revenue breakdown`, rows: [
      { label: 'Lease revenue', values: revenue, indent: 1 },
      { label: 'Total revenue', values: revenue, isTotal: true },
    ] });
    const defs: Array<[LeaseCostBucket, string, string]> = [
      ['operating', 'Property operating costs', 'Total property operating costs'],
      ['recoveries', 'Pass-through and recoveries, memo', 'Total recoveries'],
      ['other_charges', 'Other charges', 'Total other charges'],
    ];
    for (const [bucket, title, totalLabel] of defs) {
      const entries = [...buckets[bucket].entries()];
      if (entries.length === 0) continue;
      const subtotal = z();
      const rows: M4Row[] = entries.map(([label, values]) => {
        for (let t = 0; t < N; t++) subtotal[t] += values[t] ?? 0;
        return { label, values, indent: 1 };
      });
      rows.push({ label: totalLabel, values: subtotal, isTotal: true });
      tables.push({ ...tag, title: `${name}: ${title}`, rows });
    }
    tables.push({ ...tag, title: `${name}: Operating summary`, rows: [
      { label: 'Total revenue', values: revenue, indent: 1 },
      { label: 'Total operating expenses', values: totalOpex, indent: 1 },
      { label: 'Net operating income', values: revenue.map((v, t) => v - (totalOpex[t] ?? 0)), isTotal: true },
    ] });
  }

  // ── Project rollup ─────────────────────────────────────────────────────────
  if (hospitalitySummary.length > 0) {
    const rows: M4Row[] = [];
    const block = (label: string, totalLabel: string, pick: (s: typeof hospitalitySummary[number]) => number[]): void => {
      rows.push({ label, values: [], isSection: true });
      const total = z();
      for (const s of hospitalitySummary) {
        const v = pick(s);
        for (let t = 0; t < N; t++) total[t] += v[t] ?? 0;
        rows.push({ label: s.name, values: v, indent: 1 });
      }
      rows.push({ label: totalLabel, values: total, isSubtotal: true });
    };
    block('Total revenue', 'Hospitality total revenue', (s) => s.revenue);
    block('Gross operating profit, GOP', 'Hospitality GOP', (s) => s.gop);
    block('EBITDA, net operating income', 'Hospitality EBITDA', (s) => s.ebitda);
    tables.push({ title: 'Hospitality operating summary', rows });
  }

  const hqLines = state.project.hqOpex?.lines ?? [];
  if (hqLines.length && anyNonZero(opex.hq.totalOpexPerPeriod)) {
    const rows: M4Row[] = hqLines.map((ln, i) => ({ label: ln.disabled ? `${ln.name} (off)` : ln.name, values: (opex.hq.perLinePerPeriod[i] ?? []).slice(0, N), indent: 1 }));
    rows.push({ label: 'Total HQ Opex', values: opex.hq.totalOpexPerPeriod, isTotal: true });
    tables.push({ title: 'HQ & Corporate Overheads (project-wide)', rows });
  }
  const pt = opex.projectTotals;
  tables.push({ title: 'Project Total Opex', rows: [
    { label: 'Direct costs', values: pt.directCostsPerPeriod, indent: 1 },
    { label: 'Indirect costs', values: pt.indirectCostsPerPeriod, indent: 1 },
    { label: 'Management fees and replacement reserve', values: pt.managementFeePerPeriod, indent: 1 },
    { label: 'Other charges', values: pt.otherOpexPerPeriod, indent: 1 },
    { label: 'All asset opex', values: pt.totalOpexPerPeriod, isSubtotal: true },
    { label: 'HQ overheads', values: opex.hq.totalOpexPerPeriod, indent: 1 },
    { label: 'Total Project Opex', values: opex.totalOpexPerPeriodInclHQ, isTotal: true },
  ] });

  return tables;
}
