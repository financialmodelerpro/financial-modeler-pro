/**
 * verify-scenario-levers.ts (2026-09-15, step 8)
 *
 * THE SCENARIO LEVERS THE REVIEW FOUND MISSING OR DEAD.
 *
 *  A  the pure levers: an occupancy shift touches operating periods only and
 *     holds 0 to 100%; a pace factor stretches time on the cumulative curve and
 *     keeps the total; both return their input at the neutral value
 *  B  the engine: an explicit neutral lever is byte-identical to none
 *  C  live, each lever moves the model as an active scenario, and a type price and
 *     a cost standard read the SAME figure in the comparison column as active
 *  D  a derived value is never stored as an override, so resetting a type price
 *     returns the scenario to the base
 *  E  Module 6 offers them: not inactive, curated by default, and every surface
 *     builds a case model through caseModelOf
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-scenario-levers.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { shiftOccupancy, scaleSalesPace } from '../src/core/calculations/revenue/scenarioLevers';
import { hydrationFromAnySnapshotChecked } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { createModule1Store, pickModel } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildCaseComparisonReport } from '../src/hubs/modeling/platforms/refm/lib/reports/caseComparisonReport';
import { inactiveLeverReason, curatedDefaultFields, leverNote } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';
import { caseModelOf } from '../src/hubs/modeling/platforms/refm/lib/cases/caseModel';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ''}`); }
};
const quiet = <T>(fn: () => T): T => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((t, x) => t + (x ?? 0), 0);
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const irr = (m: any): number | null => quiet(() => (computeReturnsSnapshot(computeFinancialsSnapshot(m) as any, m.project) as any).result.fcfe.irr);
const pat = (m: any): number => quiet(() => sum((computeFinancialsSnapshot(m) as any).pl.patPerPeriod));

async function main(): Promise<void> {
  console.log('A. The pure levers');
  const occ = [0, 0, 0.45, 0.7, 0.95];
  check('A1 an occupancy shift of 0 returns the same series', shiftOccupancy(occ, 0) === occ && shiftOccupancy(occ, undefined) === occ);
  check('A2 a shift moves operating periods only and holds 0 to 100%', JSON.stringify(shiftOccupancy(occ, -10)?.map((x) => +x.toFixed(4))) === JSON.stringify([0, 0, 0.35, 0.6, 0.85]) && shiftOccupancy(occ, 10)![4] === 1);
  const pre = [0.05, 0.1, 0.15, 0.2, 0, 0, 0, 0, 0, 0, 0, 0];
  const post = [0, 0, 0, 0, 0.2, 0.25, 0.05, 0, 0, 0, 0, 0];
  const same = scaleSalesPace(pre, post, 1);
  check('A3 a pace factor of 1 returns the same strips', same.pre === pre && same.post === post && scaleSalesPace(pre, post, undefined).pre === pre);
  const slow = scaleSalesPace(pre, post, 0.8);
  const fast = scaleSalesPace(pre, post, 1.25);
  check('A4 a slower pace sells the same total later', near(sum(slow.pre) + sum(slow.post), 1) && sum(slow.pre) < sum(pre) && slow.post!.findLastIndex((v) => v > 0) > post.findLastIndex((v) => v > 0));
  check('A5 a faster pace sells the same total sooner', near(sum(fast.pre) + sum(fast.post), 1) && sum(fast.pre) > sum(pre));
  check('A6 pre-sales stay before the first post-sales year', slow.pre!.slice(4).every((v) => v === 0) && fast.pre!.slice(4).every((v) => v === 0));

  // A scenario's cost window survives the settle (2026-09-15): the override marks the window stated.
  const sample: any = buildExcelSampleState();
  const winLine = (sample.costLines as any[]).find((l) => l.windowFollowsConstruction === true);
  if (winLine) {
    const target = (winLine.endPeriod ?? 1) + 2;
    const cm: any = caseModelOf(sample, { [`costLines[id=${winLine.id}].endPeriod`]: target });
    const got = cm.costLines.find((l: any) => l.id === winLine.id);
    check('A7 a scenario window override survives the settle and marks the window stated', got.endPeriod === target && got.windowFollowsConstruction === false, JSON.stringify({ endPeriod: got.endPeriod, follows: got.windowFollowsConstruction }));
  } else {
    check('A7 the fixture carries a following cost window to test', false);
  }

  const src = (p: string): string => readFileSync(p, 'utf8');
  console.log('\nE. Surfaces');
  const surfaces = ['src/hubs/modeling/platforms/refm/lib/reports/caseComparisonReport.ts', 'src/hubs/modeling/platforms/refm/lib/reports/caseYoYReport.ts', 'src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx'];
  check('E1 the comparison, the year-on-year report and the exports build a case model through caseModelOf',
    surfaces.every((p) => /caseModelOf\(/.test(src(p)) && !/applyOverrides\((baseModel|vBase), (c|chosen)\.overrides\)/.test(src(p))));
  const store = src('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts');
  check('E2 the store switches and edits cases through caseModelOf and never stores a derived value',
    !/applyOverrides\((s\.)?baseSnapshot, /.test(store) && !/[^(]buildOverrides\(s\.baseSnapshot, liveModel\)[^,]/.test(store) && /settleOnLoad = settleModel/.test(store));

  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('live sections need credentials (run with --env-file=.env.local)', false); return; }
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const get = async (p: string): Promise<any[]> => { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: h }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
  const [prj] = await get(`refm_projects?select=current_version_id&name=eq.${encodeURIComponent('FMP - MARINA GATE')}&deleted_at=is.null`);
  if (!prj) { check('live project present', false); return; }
  const [ver] = await get(`refm_project_versions?id=eq.${prj.current_version_id}&select=snapshot`);
  const raw = ver.snapshot;
  const down = raw.cases.find((c: any) => c.role === 'scenario').id;
  const open = (overrides: Record<string, unknown>, active = true): any => {
    const st = createModule1Store();
    quiet(() => st.getState().hydrate(hydrationFromAnySnapshotChecked({ ...raw, activeCaseId: active ? down : raw.cases.find((c: any) => c.role === 'base').id, cases: raw.cases.map((c: any) => (c.id === down ? { ...c, overrides } : c)) }).snapshot));
    return st;
  };
  const baseSt = open({}, false).getState();
  const base = pickModel(baseSt as any) as any;
  const baseIrr = irr(base);

  console.log('\nB. The engine at the neutral value');
  const neutral = JSON.parse(JSON.stringify(base));
  for (const a of neutral.assets) {
    if (a.revenue?.sell) a.revenue.sell.paceFactor = 1;
    if (a.revenue?.operate) a.revenue.operate.occupancyShiftPts = 0;
    if (a.revenue?.lease) a.revenue.lease.occupancyShiftPts = 0;
  }
  check('B1 an explicit neutral pace and occupancy is byte-identical to none', pat(neutral) === pat(base) && irr(neutral) === baseIrr);

  console.log('\nC. Each lever, live');
  const ids = (strat: string): string[] => base.assets.filter((a: any) => a.visible !== false && a.strategy === strat).map((a: any) => a.id);
  const levers: Record<string, Record<string, unknown>> = {
    occupancy: Object.fromEntries([...ids('Operate').map((id) => [`assets[id=${id}].revenue.operate.occupancyShiftPts`, -10]), ...ids('Lease').map((id) => [`assets[id=${id}].revenue.lease.occupancyShiftPts`, -10])]),
    pace: Object.fromEntries(ids('Sell').map((id) => [`assets[id=${id}].revenue.sell.paceFactor`, 0.8])),
    typePrice: Object.fromEntries(Object.entries(base.project.assetTypeValues ?? {}).flatMap(([t, v]: any) => ['pricePerUnit', 'pricePerSqm'].filter((k) => v[k] > 0).map((k) => [`project.assetTypeValues.${t}.${k}`, v[k] * 0.9]))),
    costDefault: Object.fromEntries((base.project.costStandardRows ?? []).filter((r: any) => r.rate > 0).map((r: any) => [`project.costStandardRows[id=${r.id}].rate`, r.rate * 1.1])),
  };
  const moved: Record<string, number> = {};
  for (const [name, ov] of Object.entries(levers)) {
    const active = pickModel(open(ov).getState() as any) as any;
    const activeIrr = irr(active);
    moved[name] = (activeIrr ?? 0) - (baseIrr ?? 0);
    check(`C1 ${name}: moves equity IRR as the active scenario`, activeIrr !== null && Math.abs(moved[name]) > 0.001, `${activeIrr} vs ${baseIrr}`);
    const nonActive = open(ov, false).getState();
    const rep: any = quiet(() => buildCaseComparisonReport({ baseModel: pickModel(nonActive as any), cases: nonActive.cases, activeCaseId: nonActive.activeCaseId, liveActiveModel: pickModel(nonActive as any) } as any));
    const col = rep.columns.find((c: any) => c.name === raw.cases.find((x: any) => x.id === down).name);
    check(`C2 ${name}: the comparison column reads the active scenario's equity IRR`, col && near(col.values['Equity IRR (FCFE)'], activeIrr ?? 0, 1e-6), `${col?.values['Equity IRR (FCFE)']} vs ${activeIrr}`);
  }
  console.log(`   equity IRR moves: ${Object.entries(moved).map(([k, v]) => `${k} ${(v * 100).toFixed(2)} pts`).join(', ')}`);

  console.log('\nD. Derived values are not overrides');
  const tpSt = open(levers.typePrice);
  const saved: any = quiet(() => tpSt.getState().extractPersistSnapshot());
  const ov = saved.cases.find((c: any) => c.id === down).overrides;
  check('D1 a type price scenario saves the type price and no row price it derived', Object.keys(ov).some((p) => p.startsWith('project.assetTypeValues.')) && !Object.keys(ov).some((p) => /^subUnits\[.*\]\.(unitPrice|pricePerSqm|pricePerUnit)$/.test(p)), Object.keys(ov).join(' | '));
  const cdSaved: any = quiet(() => open(levers.costDefault).getState().extractPersistSnapshot());
  const cdOv = cdSaved.cases.find((c: any) => c.id === down).overrides;
  check('D2 a cost standard scenario saves the standard and no standard-origin capex override', !Object.keys(cdOv).some((p) => p.startsWith('costOverrides[')), Object.keys(cdOv).filter((p) => p.startsWith('costOverrides[')).slice(0, 3).join(' | '));
  const st = tpSt;
  for (const p of Object.keys(levers.typePrice)) quiet(() => st.getState().resetCaseFieldValue(down, p));
  check('D3 resetting the type price returns the scenario to the base', near(irr(pickModel(st.getState() as any)) ?? 0, baseIrr ?? 0, 1e-9), `${irr(pickModel(st.getState() as any))} vs ${baseIrr}`);

  console.log('\nE. Module 6 offers them');
  const tp = Object.keys(levers.typePrice)[0];
  const cd = Object.keys(levers.costDefault)[0];
  check('E3 a type price and a cost standard are not marked inactive', inactiveLeverReason(tp, base) === null && inactiveLeverReason(cd, base) === null, `${inactiveLeverReason(tp, base)} | ${inactiveLeverReason(cd, base)}`);
  const curated = curatedDefaultFields(base).map((f) => f.path);
  check('E4 occupancy and sales pace are in the curated defaults', curated.some((p) => p.endsWith('.revenue.operate.occupancyShiftPts')) && curated.some((p) => p.endsWith('.revenue.sell.paceFactor')));
  check('E5 the used types\' prices and construction standards are in the curated defaults', curated.some((p) => /^project\.assetTypeValues\.[^.]+\.price/.test(p)) && curated.some((p) => /^project\.costStandardRows\[id=type:/.test(p)));
  const paceNote = leverNote(curated.find((p) => p.endsWith('.revenue.sell.paceFactor')) ?? '');
  const m6 = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module6Scenarios.tsx', 'utf8');
  check('E6 the sales pace lever says on its row that a slower pace can raise revenue and profit while lowering IRR and NPV',
    !!paceNote && /RAISE revenue and profit/.test(paceNote) && /LOWERING IRR and NPV/.test(paceNote) && /indexed prices/.test(paceNote)
    && m6.includes('m6-lever-note-') && /\{leverNote\(p\)\}/.test(m6) && leverNote('returns.discountRate') === null, String(paceNote));
}

main().then(() => { console.log(`\n=== ${pass} passed, ${fail} failed ===`); process.exit(fail ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
