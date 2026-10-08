/**
 * verify-model-capex.ts (2026-10-07, founder)
 *
 * AN ASSET ON AN OPERATIONAL PHASE COSTS NOTHING IN THE MODEL, ON EVERY READER,
 * AND EVERY OTHER ASSET'S ADDITIONS EQUAL ITS MODEL CAPEX, ASSET BY ASSET.
 *
 * The existing-operations balance sheet was out by 1,350.7m from its first year
 * because the capex aggregate skipped an operational phase while the fixed
 * asset schedule (and five other readers of an asset's cost) priced the
 * operational hotel's plot anyway: land on the balance sheet that no capex,
 * cash or equity entry funded. `phaseHasModelCapex` (core/modelCapex.ts) is now
 * the ONE rule and `computeAssetCost` applies it first (TRAPS 7.63).
 *
 * PER ASSET, NOT IN TOTAL: a total can hide a transfer between assets, which
 * is how the gap above sat behind a land TOTAL that looked plausible. So each
 * asset's fixed asset additions (land + building), its cost of sales base and
 * its capex report row are each tied to that asset's own model capex, and only
 * then is the sum tied to the capex aggregate.
 *
 * Fixtures: the committed existing-operations capture (an Operate hotel on the
 * operational phase), the same with a SELL asset on it (inventory and cost of
 * sales, existingOperationsSellState.ts), the greenfield sample, and the live
 * project when credentials are loaded.
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { buildExistingOperationsState, EXISTING_OPS_LABEL } from './fixtures/existingOperationsState';
import { buildExistingOperationsSellState, EXISTING_OPS_SELL_LABEL, OPERATIONAL_SELL_ASSET_ID } from './fixtures/existingOperationsSellState';
import { buildExcelSampleState } from './excelSampleState';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { createFinancingHooks } from '../src/hubs/modeling/platforms/refm/lib/financing-hooks';
import { computeAssetCost } from '../src/core/calculations';
import { phaseHasModelCapex } from '../src/core/calculations/modelCapex';
import { buildAssetNotes } from '../src/hubs/modeling/platforms/refm/lib/reports/assetNotes';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const sum = (a: ArrayLike<number> | undefined): number => Array.from(a ?? []).reduce((x, v) => x + (v ?? 0), 0);
const near = (a: number, b: number, scale = 1): boolean => Math.abs(a - b) <= Math.max(1, 1e-9 * Math.max(Math.abs(scale), Math.abs(a), Math.abs(b)));
const M = (v: number): string => (v / 1e6).toFixed(1);

/** An asset's model capex: computeAssetCost with the revenue snapshot every production reader passes
 *  (a selling-cost line is priced on revenue, so leaving it out understates a Sell asset). */
function modelCapexOf(st: any, asset: any, revenue?: unknown): number {
  const phase = st.phases.find((p: any) => p.id === asset.phaseId);
  return computeAssetCost({
    asset, project: st.project, phase, parcels: st.parcels, assets: st.assets, subUnits: st.subUnits,
    costLines: st.costLines, costOverrides: st.costOverrides, landAllocationMode: st.landAllocationMode,
    parcelFunding: st.project.financing?.parcelFunding, revenue,
  } as any).total;
}

function runFor(label: string, st: any, opts: { expectOperational: boolean; operationalSellId?: string }): void {
  console.log(`\n=== ${label} ===`);
  const s: any = computeFinancialsSnapshot(st);
  const cr = buildCapexReport(s, st);
  const hooks = createFinancingHooks(st);
  const opPhaseIds = new Set(st.phases.filter((p: any) => !phaseHasModelCapex(p)).map((p: any) => p.id));
  const visible = st.assets.filter((a: any) => a.visible !== false);
  const opAssets = visible.filter((a: any) => opPhaseIds.has(a.phaseId));
  check('the fixture has the shape it is for', opts.expectOperational ? opAssets.length > 0 : opAssets.length === 0, `${opAssets.length} assets on an operational phase`);

  // 1. THE RULE, ON EVERY READER, for each asset on an operational phase.
  for (const a of opAssets) {
    const fa = s.fixedAssets.byAsset.get(a.id);
    const cos = s.byAssetCostOfSales?.get?.(a.id);
    const series = cr.assetSeries.find((x) => x.assetId === a.id);
    const readers: Array<[string, number]> = [
      ['computeAssetCost', modelCapexOf(st, a, s.revenue)],
      ['fixed asset additions (land + building)', fa ? sum(fa.land.additionsPerPeriod) + sum(fa.depreciable.additionsPerPeriod) : 0],
      ['cost of sales base', cos?.assetCost ?? 0],
      ['capex report row', series ? sum(series.inclAll) : 0],
      ['financing hooks schedule', sum(hooks.getCapexSchedule(a.id))],
    ];
    const bad = readers.filter(([, v]) => Math.abs(v) > 0.5);
    check(`${a.name} (operational phase): every reader charges 0 model capex`, bad.length === 0, bad.map(([n, v]) => `${n} ${M(v)}m`).join('; '));
    // NOT VACUOUS: the same asset, on a phase that is not operational, prices to something.
    const asBuilt = JSON.parse(JSON.stringify(st));
    for (const p of asBuilt.phases) if (p.id === a.phaseId) p.status = 'construction';
    const priced = modelCapexOf(asBuilt, asBuilt.assets.find((x: any) => x.id === a.id));
    check(`${a.name}: the zero is the rule, not an unpriced asset (on a construction phase it costs ${M(priced)}m)`, priced > 0.5);
  }

  // 2. PER ASSET: each reader's figure for an asset equals that asset's model capex.
  let totalModel = 0;
  const perAssetBad: string[] = [];
  for (const a of visible) {
    const model = modelCapexOf(st, a, s.revenue);
    totalModel += model;
    const fa = s.fixedAssets.byAsset.get(a.id);
    if (fa) {
      const adds = sum(fa.land.additionsPerPeriod) + sum(fa.depreciable.additionsPerPeriod);
      if (!near(adds, model, model)) perAssetBad.push(`${a.name}: fixed asset additions ${M(adds)}m vs model capex ${M(model)}m`);
    }
    const cos = s.byAssetCostOfSales?.get?.(a.id);
    if (cos && !near(cos.assetCost, model, model)) perAssetBad.push(`${a.name}: cost of sales base ${M(cos.assetCost)}m vs ${M(model)}m`);
    const series = cr.assetSeries.find((x) => x.assetId === a.id);
    if (series && !near(sum(series.inclAll), model, model)) perAssetBad.push(`${a.name}: capex report ${M(sum(series.inclAll))}m vs ${M(model)}m`);
  }
  check('per asset: fixed asset additions, cost of sales base and the capex report row each equal that asset\'s model capex', perAssetBad.length === 0, perAssetBad.slice(0, 6).join('; '));
  const agg = sum(s.financing.capex.perPeriod.inclAllLand);
  check('and only then in total: the assets\' model capex sums to the capex aggregate the financing funds', near(totalModel, agg, agg), `${M(totalModel)}m vs ${M(agg)}m`);

  // 3. THE BALANCE SHEET BALANCES, every year, and the bridge explains every move.
  const peak = Math.max(1, ...s.bs.totalAssetsPerPeriod.map(Math.abs));
  const worst = Math.max(...s.bs.bsDifferencePerPeriod.map(Math.abs));
  const unexplained = Math.max(...s.bsReconciliation.unexplainedPerPeriod.map(Math.abs));
  check('the balance sheet balances in every year', worst / peak < 1e-9, `worst ${M(worst)}m`);
  check('the reconciliation bridge explains every year', unexplained / peak < 1e-9, `${M(unexplained)}m`);

  if (opts.operationalSellId) {
    const cos = s.byAssetCostOfSales?.get?.(opts.operationalSellId);
    check('the operational Sell asset reaches cost of sales (the Sell half is exercised, not skipped)', !!cos);
  }
}

(async () => {
  console.log('=== An operational phase has no model capex, on every reader (phaseHasModelCapex) ===');
  check('the rule: operational is false, construction and absent status are true',
    phaseHasModelCapex({ status: 'operational' }) === false && phaseHasModelCapex({ status: 'construction' }) === true && phaseHasModelCapex({}) === true);

  runFor(EXISTING_OPS_LABEL, loadStoredModel(buildExistingOperationsState()).snapshot, { expectOperational: true });
  runFor(EXISTING_OPS_SELL_LABEL, loadStoredModel(buildExistingOperationsSellState()).snapshot, { expectOperational: true, operationalSellId: OPERATIONAL_SELL_ASSET_ID });
  runFor('FIXTURE (greenfield sample)', buildExcelSampleState(), { expectOperational: false });
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { loadLiveExportInputs } = await import('./fixtures/liveExportInputs');
    const l = await loadLiveExportInputs();
    runFor(`LIVE (${l.projectName})`, l.state, { expectOperational: false });
  } else {
    console.log('\n  (live project skipped: no credentials; the committed fixtures above still run)');
  }

  // 3b. ONE OPENING POSITION (2026-10-07): the screen's land + building, the engine and the exports'
  // existing-operations note all read getAssetPreCapexTotal; the legacy single figure is a fallback only.
  console.log('\n=== One opening position for an existing asset ===');
  {
    const st: any = loadStoredModel(buildExistingOperationsState()).snapshot;
    const hotel = st.assets.find((a: any) => (a.historicalPreCapexLand ?? 0) + (a.historicalPreCapexBuilding ?? 0) > 0);
    const split = (hotel.historicalPreCapexLand ?? 0) + (hotel.historicalPreCapexBuilding ?? 0);
    check('the capture carries a stale legacy total beside its split (not vacuous)', Math.abs((hotel.historicalPreCapex ?? 0) - split) > 1e6, `${M(hotel.historicalPreCapex ?? 0)}m vs ${M(split)}m`);
    const money = (v: number): string => `${M(v)}m`;
    const forced = { ...st, assets: st.assets.map((a: any) => (a.id === hotel.id ? { ...a, status: 'operational' } : a)) };
    const note = buildAssetNotes(forced, money).byAssetId.get(hotel.id);
    check('the exports\' existing-operations note states the split (land + building), the figure the model runs on', !!note && note.reason.includes(money(split)) && !note.reason.includes(money(hotel.historicalPreCapex)), note?.reason.slice(0, 160));
    const walk2 = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk2(p) : /\.tsx?$/.test(f) ? [p] : []; });
    const bare = walk2('src').flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /\.historicalPreCapex\b(?!Land|Building)/.test(l) && !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => `${f}: ${l.trim()}`));
    // The resolver's own fallback and the pass 56 migration that seeds the split are the only readers.
    const allowed = bare.filter((l) => !/module1-types\.ts: return Math\.max\(0, a\.historicalPreCapex \?\? 0\);/.test(l) && !/module1-migrate\.ts: const legacy = Math\.max\(0, a\.historicalPreCapex \?\? 0\);/.test(l));
    check('nothing reads the legacy single figure except the one resolver and the migration that seeds the split', allowed.length === 0, allowed.join(' | '));
  }

  // 4. ONE RULE IN SOURCE: nothing decides "operational" for an asset's cost by itself.
  console.log('\n=== One rule in source ===');
  const core = readFileSync('src/core/calculations/index.ts', 'utf8');
  check('computeAssetCost applies phaseHasModelCapex before any pricing',
    /export function computeAssetCost[\s\S]{0,4000}?if \(!phaseHasModelCapex\(phase\)\) return emptyAssetCostBreakdown\(phase\);/.test(core));
  check('the capex aggregate calls the same predicate', /if \(!phaseHasModelCapex\(phase\)\) continue;/.test(readFileSync('src/core/calculations/financing/capex.ts', 'utf8')));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
  const readers = [...walk('src/core'), ...walk('src/hubs/modeling/platforms/refm/lib')].filter((f) => /computeAssetCost\(/.test(readFileSync(f, 'utf8')));
  // ONE NAMED ALLOWANCE, with its obligation enforced: financials-resolvers reads the status for the
  // DIVIDEND DEFAULT START YEAR (an operating phase pays from the project start), not for what an asset
  // costs, and that is the only line in it allowed to.
  const ALLOWED = (file: string, line: string): boolean =>
    /financials-resolvers\.ts$/.test(file) && /return ph\.status === 'operational' \? projectStartYear : psy \+ cp;/.test(line);
  const ownRule = readers.flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/)
    .filter((l) => /status\s*===\s*'operational'/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !ALLOWED(f, l)).map((l) => `${f}: ${l.trim()}`));
  check(`no reader of computeAssetCost decides "operational" for an asset's cost by itself (${readers.length} readers)`, ownRule.length === 0, ownRule.join(' | '));
  check('the one allowance is still the dividend start year (not stale)', readers.some((f) => readFileSync(f, 'utf8').split(/\r?\n/).some((l) => ALLOWED(f, l))));

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`); }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
