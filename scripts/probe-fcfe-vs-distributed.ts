/**
 * probe-fcfe-vs-distributed.ts (2026-09-30, export review item 11)
 *
 * Read-only measurement on the live project: does FCFE equal the Distributed
 * Equity stream per period, and if so, which settings make it so. Never writes.
 * No em dashes in this file.
 */
import { readLiveProjectVersion } from './fixtures/liveProject';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';

const quiet = <T,>(f: () => T): T => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };

(async () => {
  const live = await readLiveProjectVersion();
  if (!live.ok) { console.log('no live read', live); process.exit(1); }
  const model: any = quiet(() => loadStoredModel(live.snapshot).snapshot);
  const snap: any = quiet(() => computeFinancialsSnapshot(model));
  const rs: any = quiet(() => computeReturnsSnapshot(snap, model.project));
  const f: number[] = rs.fcfePerPeriod, d: number[] = rs.dividendStreamPerPeriod;
  const y0 = snap.years?.[0] ?? snap.startYear ?? 0;
  console.log(live.label, live.versionLabel);
  console.log('settings: dividends', JSON.stringify(model.financing?.dividendPolicy ?? model.project?.dividendPolicy ?? null), 'sweep', JSON.stringify(model.financing?.cashSweep ?? null));
  let maxDiff = 0;
  for (let i = 0; i < Math.max(f.length, d.length); i++) {
    const diff = (f[i] ?? 0) - (d[i] ?? 0); maxDiff = Math.max(maxDiff, Math.abs(diff));
    console.log(i, (f[i] ?? 0).toFixed(2), (d[i] ?? 0).toFixed(2), diff.toFixed(2));
  }
  console.log('IRR fcfe', rs.result.fcfe.irr, 'dist', rs.result.dividends.irr, 'MOIC', rs.result.fcfe.moic, rs.result.dividends.moic, 'maxDiff', maxDiff.toFixed(2), 'y0', y0);
})();

// Leg 2: the same model on a COPY with a 50% payout, to see whether the tie is
// an identity or a property of the 100% payout. The live project is untouched.
(async () => {
  const live = await readLiveProjectVersion();
  if (!live.ok) return;
  const model: any = quiet(() => loadStoredModel(live.snapshot).snapshot);
  const copy = JSON.parse(JSON.stringify(model));
  const where = copy.financing?.dividendPolicy ? 'financing' : 'project';
  (where === 'financing' ? copy.financing : copy.project).dividendPolicy.payoutRatio = 50;
  const snap: any = quiet(() => computeFinancialsSnapshot(copy));
  const rs: any = quiet(() => computeReturnsSnapshot(snap, copy.project));
  const f: number[] = rs.fcfePerPeriod, d: number[] = rs.dividendStreamPerPeriod;
  const md = Math.max(...f.map((v, i) => Math.abs(v - (d[i] ?? 0))));
  console.log('50% payout (policy on', where + '):', 'IRR fcfe', rs.result.fcfe.irr, 'dist', rs.result.dividends.irr, 'maxDiff', md.toFixed(2));
})();

// Leg 3: what the live project's facilities repay by.
(async () => {
  const live = await readLiveProjectVersion();
  if (!live.ok) return;
  const model: any = quiet(() => loadStoredModel(live.snapshot).snapshot);
  const tr = model.financingTranches ?? [];
  console.log('tranches', JSON.stringify(tr.map((t: any) => ({ n: t.name, rep: t.repaymentMethod, sweep: t.cashSweepConfig }))), 'divStart', model.project?.dividendStartYear, 'minCash', model.project?.financing?.minimumCashReserve);
})();
