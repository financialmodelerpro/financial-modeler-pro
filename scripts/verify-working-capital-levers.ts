/**
 * verify-working-capital-levers.ts (2026-10-05, export review group 4, founder)
 *
 * TWO INPUTS THAT WERE TYPED AND READ BY NOTHING NOW DRIVE THE MODEL.
 *   1. A hotel or lease line's own receivable days (revenue.operate.dso,
 *      revenue.lease.arDays): its receivable runs on them where stated, else
 *      on the project DSO (receivableDays.ts). Every surface agrees.
 *   2. tax.paymentDays: that share of each year's zakat / tax is still payable
 *      at the close and is paid the next year. 0 (the default) pays it in year.
 * Both must leave the balance sheet balanced, Direct = Indirect cash flow, and
 * the reconciliation bridge with nothing unexplained.
 *
 * Usage: npx tsx --env-file=.env.local scripts/verify-working-capital-levers.ts
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { lineReceivableDays } from '../src/hubs/modeling/platforms/refm/lib/receivableDays';
import { buildRevenueLineFeeds } from '../src/hubs/modeling/platforms/refm/lib/reports/revenueOutputReports';
import { buildExcelSampleState } from './excelSampleState';
import { planRevenueLines } from '../src/hubs/modeling/platforms/refm/lib/revenueLines';
import { readLiveProjectVersion } from './fixtures/liveProject';

let pass = 0, fail = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const maxAbs = (a: readonly number[]): number => Math.max(0, ...a.map((v) => Math.abs(v ?? 0)));
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
type Snap = ReturnType<typeof computeFinancialsSnapshot>;
const healthy = (s: Snap): { bs: number; cf: number; unexplained: number } => ({
  bs: maxAbs(s.bs.bsDifferencePerPeriod),
  cf: maxAbs(s.directCF.netCashFlowPerPeriod.map((v, t) => v - (s.indirectCF.netCashFlowPerPeriod[t] ?? 0))),
  unexplained: maxAbs(s.bsReconciliation.unexplainedPerPeriod),
});
const statementsHold = (label: string, s: Snap): void => {
  const h = healthy(s);
  const peak = Math.max(1, maxAbs(s.bs.totalAssetsPerPeriod));
  check(`${label}: balance sheet balances, Direct = Indirect, bridge explains everything`,
    h.bs / peak < 1e-9 && h.cf / peak < 1e-9 && h.unexplained / peak < 1e-9, JSON.stringify(h));
};

(async () => {
  console.log('=== 1. A line\'s own receivable days ===');
  const base: any = buildExcelSampleState();
  base.project.operatingAr = { dsoDays: 30 };
  const lease = base.assets.find((a: any) => a.strategy === 'Lease');
  check('the fixture has a lease line', !!lease);
  const withDays = (days: number | undefined): Snap => {
    const s: any = JSON.parse(JSON.stringify(base));
    const a = s.assets.find((x: any) => x.id === lease.id);
    a.revenue = { ...(a.revenue ?? {}), lease: { ...(a.revenue?.lease ?? {}), arDays: days } };
    return computeFinancialsSnapshot(s);
  };
  const sNone = withDays(undefined), sZero = withDays(0), s30 = withDays(30), s90 = withDays(90);
  const peak = (s: Snap): number => maxAbs(s.bs.arPerPeriod);
  check('a line stating no days takes the project DSO', near(peak(sNone), peak(s30)) && peak(sNone) > 0, `${peak(sNone)} vs ${peak(s30)}`);
  check('a typed 0 is cash basis on that line', peak(sZero) < peak(sNone));
  check('90 days hold three times the receivable of 30 (linear, not vacuous)', near(peak(s90) - peak(sZero), 3 * (peak(s30) - peak(sZero)), 1e-6), `${peak(s90)} ${peak(s30)} ${peak(sZero)}`);
  check('the line\'s days move operating cash (a real working-capital lever)',
    maxAbs(s90.directCF.cashFromOperationsPerPeriod.map((v, t) => v - (sNone.directCF.cashFromOperationsPerPeriod[t] ?? 0))) > 1);
  for (const [l, s] of [['no days', sNone], ['0 days', sZero], ['90 days', s90]] as const) statementsHold(`receivable ${l}`, s);
  check('the rule: own days win, else the project DSO',
    lineReceivableDays({ strategy: 'Lease', revenue: { lease: { arDays: 45 } } }, { operatingAr: { dsoDays: 30 } }) === 45
    && lineReceivableDays({ strategy: 'Lease', revenue: { lease: {} } }, { operatingAr: { dsoDays: 30 } }) === 30
    && lineReceivableDays({ strategy: 'Operate', revenue: { operate: { dso: 0 } } }, { operatingAr: { dsoDays: 30 } }) === 0);
  // The Schedules feed holds what the balance sheet holds.
  {
    const s: any = JSON.parse(JSON.stringify(base)); const a = s.assets.find((x: any) => x.id === lease.id); a.revenue.lease.arDays = 90;
    const snap = computeFinancialsSnapshot(s);
    const lines = planRevenueLines(s.assets.filter((x: any) => x.visible !== false), s.subUnits, s.phases, s.project);
    const feeds = buildRevenueLineFeeds(snap.revenue, lines, snap.byAssetCostOfSales, s.project.operatingAr);
    const opKeys = new Set(lines.filter((l) => l.form !== 'sell').map((l) => l.key));
    const opFeedAr = new Array<number>(snap.axisLength).fill(0);
    for (const fd of feeds) if (opKeys.has(fd.lineKey)) fd.ar.forEach((v, t) => { opFeedAr[t] += v ?? 0; });
    check('the Schedules feed\'s operating receivable is the balance sheet\'s',
      maxAbs(opFeedAr.map((v, t) => v - (snap.bs.arPerPeriod[t] ?? 0))) < 1e-6 * Math.max(1, peak(snap)), `${maxAbs(opFeedAr)} vs ${peak(snap)}`);
  }
  const R = 'src/hubs/modeling/platforms/refm/';
  const stale = ['components/modules/Module2Revenue.tsx', 'lib/pdf/generateProjectPdf.ts', 'lib/excel/buildModelWorkbook.ts', 'lib/excel/inputsSheetSections.ts', 'lib/cases/assumptionGrid.ts']
    .filter((f) => /not used: the (operating receivable|project DSO)|NOT USED: the operating receivable|Read by nothing: the operating receivable|dso \?\? 30|arDays \?\? 30/i.test(readFileSync(R + f, 'utf8')));
  check('no surface calls the line\'s days unused or shows an invented 30', stale.length === 0, stale.join(', '));

  console.log('\n=== 2. When zakat / tax is paid ===');
  const tax: any = JSON.parse(JSON.stringify(base)); tax.project.tax = { ...(tax.project.tax ?? {}), rate: 0.2 };
  const s0 = computeFinancialsSnapshot(tax);
  const t120: any = JSON.parse(JSON.stringify(tax)); t120.project.tax.paymentDays = 120;
  const s120 = computeFinancialsSnapshot(t120);
  check('the fixture charges tax (so the timing can bite)', maxAbs(s0.pl.taxPerPeriod) > 0);
  check('0 days: nothing is payable and the charge is paid in its year',
    maxAbs(s0.bs.taxPayablePerPeriod) === 0 && s0.directCF.taxPaidPerPeriod.every((v, t) => near(-v, s0.pl.taxPerPeriod[t] ?? 0)));
  check('120 days: the close holds 120/365 of the year\'s charge',
    s120.bs.taxPayablePerPeriod.every((v, t) => near(v, (s120.pl.taxPerPeriod[t] ?? 0) * 120 / 365)));
  check('120 days: paid = charge + last year\'s payable - this year\'s',
    s120.directCF.taxPaidPerPeriod.every((v, t) => near(-v, (s120.pl.taxPerPeriod[t] ?? 0) + (t ? s120.bs.taxPayablePerPeriod[t - 1] : 0) - s120.bs.taxPayablePerPeriod[t])));
  check('the charge itself does not move, only when it is paid', s120.pl.taxPerPeriod.every((v, t) => near(v, s0.pl.taxPerPeriod[t] ?? 0, 1e-4)));
  statementsHold('tax paid at 0 days', s0);
  statementsHold('tax paid at 120 days', s120);

  console.log('\n=== 3. The live project ===');
  const live = await readLiveProjectVersion();
  if (live.ok) {
    const ls = computeFinancialsSnapshot(live.snapshot as any);
    check(`${live.label}: nothing is payable (no payment days set)`, maxAbs(ls.bs.taxPayablePerPeriod) === 0);
    statementsHold(live.label, ls);
  } else if (live.noCredentials) console.log('  (live leg skipped: no credentials)');
  else check('the live project is readable', false, live.reason);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
