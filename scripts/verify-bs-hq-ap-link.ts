/**
 * verify-bs-hq-ap-link.ts
 *
 * Pins the 2026-06-01 BS reconciliation fix: the Balance Sheet tab
 * (Module4BalanceSheet) must LINK its Accounts Payable to the canonical
 * project-wide AP (snap.ap.projectTotals.closingApPerPeriod), which
 * INCLUDES the HQ / head-office AP. The previous per-asset sum
 * (snap.ap.byAsset) covered Operate/Lease assets only and OMITTED HQ AP,
 * so the UI's re-summed BS Check drifted by (HQ opex × DPO / 365),
 * compounding at the HQ inflation rate, even though the financials
 * snapshot balanced every period.
 *
 * This replicates the component's BS-Check re-summation (non-filtered
 * path) both ways and asserts:
 *   1. The snapshot itself balances every period (bsDifference ~ 0).
 *   2. NEW (canonical AP): the re-summed BS Check ~ 0 every period.
 *   3. OLD (per-asset AP): the re-summed BS Check drifts by HQ AP and
 *      grows at ~3% (proves the fix is load-bearing).
 *
 * Run: npx tsx scripts/verify-bs-hq-ap-link.ts
 */
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { makeDefaultPhase, makeDefaultProject } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const near0 = (a: number[]) => a.every((v) => Math.abs(v) < 0.5);

function buildState(): any {
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.opexAp = { defaultApDays: 90, daysPerYear: 365 };
  project.hqOpex = {
    defaultIndexation: { method: 'yoy_compound', rate: 0.03 },
    lines: [{ id: 'hq1', name: 'Head office G&A', category: 'indirect_ga', mode: 'fixed_baseline', value: 6_660_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }],
  };
  const p1: any = { ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01', constructionPeriods: 1, operationsPeriods: 14, overlapPeriods: 0 };
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 800, adrIndexation: { method: 'none' }, occupancyPerPeriodByPhase: Array(15).fill(0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(15).fill(0), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(15).fill(0), indexation: { method: 'none' } } } },
  };
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 800, startingAdr: 800 };
  return { project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [], costLines: [], costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [], equityContributions: [] };
}

// Replicate Module4BalanceSheet's non-filtered BS-Check re-summation.
function reSummedBsDiff(snap: any, apMode: 'canonical' | 'perAsset'): number[] {
  const N = snap.axisLength;
  const z = () => new Array<number>(N).fill(0);
  const sumAssets = (pick: (id: string) => number[] | undefined) => {
    const out = z();
    for (const a of snap.perAssetCF.keys()) { const s = pick(a); if (s) for (let t = 0; t < N; t++) out[t] += s[t] ?? 0; }
    return out;
  };
  const bs = snap.bs;
  const land = sumAssets((id) => snap.fixedAssets.byAsset.get(id)?.land.closingPerPeriod);
  const nbv = sumAssets((id) => snap.fixedAssets.byAsset.get(id)?.depreciable.closingNBVPerPeriod);
  const inv = sumAssets((id) => snap.perAssetCF.get(id)?.inventoryPerPeriod);
  const resAr = sumAssets((id) => snap.byAssetSchedules.get(id)?.ar.perPeriod);
  const unearned = sumAssets((id) => snap.byAssetSchedules.get(id)?.unearned.perPeriod);
  const ap = apMode === 'canonical'
    ? bs.apPerPeriod.slice(0, N)
    : sumAssets((id) => snap.ap.byAsset.get(id)?.result.perPeriod);
  const idcNbv = snap.idc.idcNbvPerPeriod.slice(0, N);
  const out = z();
  for (let t = 0; t < N; t++) {
    const totalFA = land[t] + nbv[t] + idcNbv[t];
    const totalCA = bs.cashPerPeriod[t] + (snap.escrow.projectTotals.cumulativeBalancePerPeriod[t] ?? 0) + bs.arPerPeriod[t] + resAr[t] + inv[t];
    const totalAssets = totalFA + totalCA;
    const totalLiab = ap[t] + unearned[t] + bs.debtOutstandingPerPeriod[t];
    const totalEq = bs.shareCapitalPerPeriod[t] + bs.statutoryReservePerPeriod[t] + bs.retainedEarningsPerPeriod[t];
    out[t] = totalAssets - (totalLiab + totalEq);
  }
  return out;
}

const snap = computeFinancialsSnapshot(buildState());
const N = snap.axisLength;

// 1. Snapshot balances.
check('snapshot bsDifferencePerPeriod ~ 0 every period', near0(snap.bs.bsDifferencePerPeriod.slice(0, N)));

// 2. NEW (canonical AP): re-summed BS Check ~ 0.
const newDiff = reSummedBsDiff(snap, 'canonical');
check('FIXED: re-summed BS Check ~ 0 every period (AP linked to canonical)', near0(newDiff), `worst=${Math.max(...newDiff.map(Math.abs)).toFixed(1)}`);

// 3. OLD (per-asset AP): drifts by HQ AP, growing ~3%.
const oldDiff = reSummedBsDiff(snap, 'perAsset');
const hqAp = snap.ap.hq.result.perPeriod.slice(0, N);
check('OLD bug reproduced: per-asset BS Check drift == HQ AP', oldDiff.every((v, i) => Math.abs(v - (hqAp[i] ?? 0)) < 0.5));
const opsDrift = oldDiff.filter((v) => v > 1);
check('OLD bug drift compounds at ~3%/yr', opsDrift.length > 3 && Math.abs(opsDrift[opsDrift.length - 1] / opsDrift[opsDrift.length - 2] - 1.03) < 0.01);
check('FIX changes the outcome (old drift is material, new is ~0)', Math.max(...oldDiff.map(Math.abs)) > 1000 && near0(newDiff));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
