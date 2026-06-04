/**
 * opexReports.ts
 *
 * Shared pure builder for the Module 3 Opex Output structure, so the PDF export
 * mirrors the on-screen Opex tab (revenue breakdown + per-category cost tables
 * per operating asset, then the project rollup) and stays in sync as the
 * structure evolves. Returns a list of titled tables (M4Row models); the PDF
 * renders each as a period table, and the platform tab can adopt the same model.
 *
 * Pure: reads the financials snapshot + project state only.
 */
import type { ProjectFinancialsSnapshot, FinancialsResolverState } from '../financials-resolvers';
import type { M4Row } from '../../components/modules/_shared/m4Table';

export interface ReportTable { title: string; rows: M4Row[] }

type HospBucket = 'direct' | 'indirect' | 'mgmt' | 'reserves';
type LeaseBucket = 'operating' | 'recoveries' | 'other_charges';

/** Hospitality cost-line category routing (mirrors Module3OpexOutput). */
function hospBucketFor(category: string): HospBucket {
  if (category === 'direct_rooms' || category === 'direct_fb' || category === 'direct_other') return 'direct';
  if (category.startsWith('indirect_')) return 'indirect';
  if (category === 'mgmt_base' || category === 'mgmt_tech' || category === 'mgmt_incentive') return 'mgmt';
  return 'reserves';
}
/** Lease cost-line category routing (mirrors Module3OpexOutput). */
function leaseBucketFor(category: string): LeaseBucket {
  if (category === 'mgmt_base' || category === 'repairs_maintenance' || category === 'rent_insurance' || category === 'utilities') return 'operating';
  if (category === 'cam') return 'recoveries';
  return 'other_charges';
}

const isHospitality = (a: { strategy: string; isCompanion?: boolean }): boolean => a.strategy === 'Operate' || a.isCompanion === true;
const anyNonZero = (a: number[] | undefined): boolean => !!a && a.some((v) => (v ?? 0) !== 0);

export function buildOpexReport(snap: ProjectFinancialsSnapshot, state: FinancialsResolverState): ReportTable[] {
  const opex = snap.opex;
  const rev = snap.revenue;
  const assetName = (id: string): string => state.assets.find((a) => a.id === id)?.name ?? id;
  const tables: ReportTable[] = [];

  for (const [id, r] of opex.byAsset) {
    if (!anyNonZero(r.totalOpexPerPeriod)) continue;
    const asset = state.assets.find((x) => x.id === id);
    if (!asset) continue;
    const lines = asset.opex?.lines ?? [];
    const perLine = r.perLinePerPeriod ?? [];
    const name = assetName(id);

    // Category tables: one per bucket, listing each contributing line then a
    // subtotal. `defs` keeps the platform's section order + titles.
    type Def = { bucket: string; title: string; subtotalLabel: string; routed: (cat: string) => string; total?: number[] };
    const hospDefs: Def[] = [
      { bucket: 'direct', title: `${name}: Direct Costs`, subtotalLabel: 'Total Direct Costs', routed: hospBucketFor, total: r.directCostsPerPeriod },
      { bucket: 'indirect', title: `${name}: Indirect / Undistributed Costs`, subtotalLabel: 'Total Indirect Costs', routed: hospBucketFor, total: r.indirectCostsPerPeriod },
      { bucket: 'mgmt', title: `${name}: Management Fees`, subtotalLabel: 'Total Management Fees', routed: hospBucketFor },
      { bucket: 'reserves', title: `${name}: Reserves & Other Charges`, subtotalLabel: 'Total Reserves & Other', routed: hospBucketFor },
    ];
    const leaseDefs: Def[] = [
      { bucket: 'operating', title: `${name}: Property Operating Costs`, subtotalLabel: 'Total Property Operating Costs', routed: leaseBucketFor },
      { bucket: 'recoveries', title: `${name}: Pass-Through / Recoveries (memo)`, subtotalLabel: 'Total Recoveries', routed: leaseBucketFor },
      { bucket: 'other_charges', title: `${name}: Other Charges`, subtotalLabel: 'Total Other Charges', routed: leaseBucketFor },
    ];

    // Revenue Breakdown leads each operating asset.
    if (isHospitality(asset)) {
      const hr = rev.byHospitalityAsset.get(id);
      if (hr) {
        tables.push({ title: `${name}: Revenue Breakdown`, rows: [
          { label: 'Rooms Revenue', values: hr.roomsRevenuePerPeriod },
          { label: 'F&B Revenue', values: hr.fbRevenuePerPeriod },
          { label: 'Other Department Revenue', values: hr.otherRevenuePerPeriod },
          { label: 'Total Revenue', values: hr.totalRevenuePerPeriod, isTotal: true },
        ] });
      }
    } else if (asset.strategy === 'Lease') {
      const lr = rev.byLeaseAsset.get(id);
      if (lr) {
        tables.push({ title: `${name}: Revenue Breakdown`, rows: [
          { label: 'Lease Revenue', values: lr.totalRevenuePerPeriod },
          { label: 'Total Revenue', values: lr.totalRevenuePerPeriod, isTotal: true },
        ] });
      }
    }

    const defs = isHospitality(asset) ? hospDefs : asset.strategy === 'Lease' ? leaseDefs : [];
    const N = snap.axisLength;
    for (const def of defs) {
      const rows: M4Row[] = [];
      const bucketSum = new Array<number>(N).fill(0);
      lines.forEach((ln, i) => {
        if (def.routed(String(ln.category)) !== def.bucket) return;
        const values = (perLine[i] ?? []).slice(0, N);
        if (!values.some((v) => v !== 0) && ln.disabled) return;
        for (let t = 0; t < N; t++) bucketSum[t] += values[t] ?? 0;
        rows.push({ label: ln.disabled ? `${ln.name} (off)` : ln.name, values });
      });
      if (!rows.length) continue;
      rows.push({ label: def.subtotalLabel, values: def.total ?? bucketSum, isTotal: true });
      tables.push({ title: def.title, rows });
    }
  }

  // Project rollup.
  const hqLines = state.project.hqOpex?.lines ?? [];
  if (hqLines.length && anyNonZero(opex.hq.totalOpexPerPeriod)) {
    const rows: M4Row[] = hqLines.map((ln, i) => ({ label: ln.disabled ? `${ln.name} (off)` : ln.name, values: (opex.hq.perLinePerPeriod[i] ?? []).slice(0, snap.axisLength), indent: 1 }));
    rows.push({ label: 'Total HQ Opex', values: opex.hq.totalOpexPerPeriod, isTotal: true });
    tables.push({ title: 'HQ & Corporate Overheads (project-wide)', rows });
  }
  const pt = opex.projectTotals;
  tables.push({ title: 'Project Total Opex', rows: [
    { label: 'Direct costs', values: pt.directCostsPerPeriod, indent: 1 },
    { label: 'Indirect costs', values: pt.indirectCostsPerPeriod, indent: 1 },
    { label: 'Management fees', values: pt.managementFeePerPeriod, indent: 1 },
    { label: 'Other charges', values: pt.otherOpexPerPeriod, indent: 1 },
    { label: 'All asset opex', values: pt.totalOpexPerPeriod, isSubtotal: true },
    { label: 'HQ overheads', values: opex.hq.totalOpexPerPeriod, indent: 1 },
    { label: 'Total Project Opex', values: opex.totalOpexPerPeriodInclHQ, isTotal: true },
  ] });

  return tables;
}
