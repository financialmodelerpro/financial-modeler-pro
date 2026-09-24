/**
 * verify-cost-per-sqm.ts (2026-09-24)
 *
 * Pins Table 7 of the Capex results (`lib/reports/costPerSqmReport.ts`):
 *
 *   A. IT READS, IT NEVER COMPUTES. Hard, soft and land equal the Capex
 *      report's own treatment rows; IDC equals the IDC schedule (and, on Sell
 *      lines, cost of sales' IDC); GDV equals the engine's Sell revenue. The
 *      builder resolves no area, cost or massing of its own.
 *   B. THE ARITHMETIC IS THE STATED ARITHMETIC: every per-sqm figure is its
 *      cost over its area (n/a only where the area is zero), every margin is a
 *      price less a cost, escalation is realised less base.
 *   C. THE BASE PRICE IS BEFORE ESCALATION, MEASURED BOTH WAYS: on the stored
 *      model escalation is non-zero where indexation runs, and on a copy with
 *      every Sell asset's indexation switched off, GDV at base equals GDV
 *      exactly and escalation is zero.
 *   D. IT IS ON SCREEN, after Table 6, and Sell comparison rows exist only
 *      for Sell lines.
 *
 * LIVE: measured on FMP - MARINA GATE's stored model, read through
 * loadStoredModel. Missing credentials FAIL; they never skip.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-cost-per-sqm.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { computeFinancialsSnapshot, type FinancialsResolverState } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { buildCostPerSqmReport, COST_BASES, AREA_BASES } from '../src/hubs/modeling/platforms/refm/lib/reports/costPerSqmReport';

interface PgClient { connect(): Promise<void>; query(t: string, v?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; end(): Promise<void> }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: new (c: Record<string, unknown>) => PgClient };

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + (v ?? 0), 0);
const PROJECT = 'c417fc6a-4514-4438-857c-a72dc7472f65'; // FMP - MARINA GATE

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('FAIL: DATABASE_URL is not set; the live legs cannot run.'); process.exit(1); }
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const v = await c.query('select snapshot from public.refm_project_versions where project_id = $1 order by created_at desc limit 1', [PROJECT]);
  await c.end();
  const s = loadStoredModel(v.rows[0]?.snapshot).snapshot as unknown as FinancialsResolverState & Record<string, unknown>;
  const state: FinancialsResolverState = {
    project: s.project, phases: s.phases, assets: s.assets, subUnits: s.subUnits, parcels: s.parcels,
    costLines: s.costLines, costOverrides: s.costOverrides, landAllocationMode: s.landAllocationMode,
    financingTranches: s.financingTranches, equityContributions: s.equityContributions,
  } as FinancialsResolverState;
  const snap = computeFinancialsSnapshot(state);
  const rep = buildCostPerSqmReport(snap, state);
  const cap = buildCapexReport(snap, state);

  console.log('=== A. It reads, it never computes ===');
  check('A0 the report has lines to measure', rep.lines.length > 0 && rep.lines.some((l) => l.sale));
  const T = (k: 'hard' | 'soft' | 'landStage'): number => cap.treatment.reduce((a, r) => a + r[k], 0);
  const L = (k: 'hard' | 'soft' | 'land' | 'idc'): number => rep.lines.reduce((a, r) => a + r[k], 0);
  check('A1 hard, soft and land equal the Capex report\'s own rows',
    near(T('hard'), L('hard')) && near(T('soft'), L('soft')) && near(T('landStage'), L('land')),
    `${T('hard') - L('hard')} / ${T('soft') - L('soft')} / ${T('landStage') - L('land')}`);
  const schedIdc = [...snap.idc.byAsset.values()].reduce((a, r) => a + r.idcPerPeriod.reduce((x, y) => x + Math.max(0, y), 0), 0);
  check('A2 IDC equals the IDC schedule', near(L('idc'), schedIdc), `${L('idc')} vs ${schedIdc}`);
  const cosIdc = [...snap.byAssetCostOfSales.values()].reduce((a, r) => a + r.idc, 0);
  check('A3 and on Sell lines equals cost of sales\' IDC', near(rep.lines.filter((l) => l.sale).reduce((a, l) => a + l.idc, 0), cosIdc));
  const engineGdv = [...snap.revenue.bySellAsset.values()].reduce((a, r) => a + sum(r.presalesRevenuePerPeriod) + sum(r.postSalesRevenuePerPeriod), 0);
  check('A4 GDV equals the engine\'s Sell revenue', near(rep.lines.reduce((a, l) => a + (l.sale?.gdv ?? 0), 0), engineGdv));
  const code = src('src/hubs/modeling/platforms/refm/lib/reports/costPerSqmReport.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('A5 the builder resolves no cost, area or massing of its own',
    !/computeAssetCost|resolveAssetAreaMetrics|withInheritedMassingAll|computeFinancialsSnapshot/.test(code) && /buildCapexReport\(snap, state\)/.test(code));

  console.log('\n=== B. The arithmetic is the stated arithmetic ===');
  let divOk = true, marginOk = true;
  for (const l of rep.lines) {
    const con = l.hard + l.soft + l.operating;
    if (!near(l.cost.construction, con) || !near(l.cost.withIdc, con + l.idc) || !near(l.cost.withLand, con + l.idc + l.land)) divOk = false;
    for (const b of COST_BASES) for (const a of AREA_BASES) {
      const got = l.perSqm[b.key][a.key];
      const want = l.area[a.key] > 0 ? l.cost[b.key] / l.area[a.key] : null;
      if (want === null ? got !== null : got === null || !near(got, want, 1e-6)) divOk = false;
    }
    if (l.sale) {
      const s2 = l.sale;
      for (const b of COST_BASES) {
        if (!near((s2.marginAtBase[b.key] ?? NaN), (s2.basePrice ?? NaN) - (s2.costPerSqm[b.key] ?? NaN), 1e-6)) marginOk = false;
        if (!near((s2.marginAtRealised[b.key] ?? NaN), (s2.realisedPrice ?? NaN) - (s2.costPerSqm[b.key] ?? NaN), 1e-6)) marginOk = false;
      }
      if (!near(s2.escalationPerSqm ?? NaN, (s2.realisedPrice ?? NaN) - (s2.basePrice ?? NaN), 1e-6)) marginOk = false;
      if (!near(s2.realisedPrice ?? NaN, s2.gdv / s2.areaSold, 1e-6)) marginOk = false;
    }
  }
  check('B1 the three bases build up, and every per-sqm figure is cost over area (n/a only on zero area)', divOk);
  // ONE DEFINITION OF CONSTRUCTION (founder, 2026-09-24): hard + soft +
  // operating, the same rule the stage subtotals' exclLand uses, by name.
  const capexSrc = src('src/hubs/modeling/platforms/refm/lib/reports/capexReports.ts');
  check('B1b "construction" is ONE rule: the report and the stage subtotals both call constructionCostOf',
    /constructionCostOf\(\{ hard, soft, operating \}\)/.test(code)
    && (capexSrc.match(/exclLand = constructionCostOf\(out\)/g) ?? []).length === 2
    && !/out\.exclLand = out\.hard/.test(capexSrc));
  // The live model has NO pre-opening cost, so the branch is made to FIRE on a
  // copy: one soft line re-filed to the operating stage through its own
  // stageOverride. Construction must not move (both stages are inside it), while
  // hard + soft alone would drop by exactly what moved.
  const softLine = state.costLines.find((cl) => (cl as { stage?: string }).stage === 'soft');
  const moved = { ...state, costLines: state.costLines.map((cl) => (cl === softLine ? { ...cl, stageOverride: 'operating' } : cl)) } as FinancialsResolverState;
  const movedRep = buildCostPerSqmReport(computeFinancialsSnapshot(moved), moved);
  const opLines = movedRep.lines.filter((l) => l.operating > 0);
  const sameConstruction = movedRep.lines.every((l) => {
    const o = rep.lines.find((x) => x.key === l.key);
    return !!o && near(l.cost.construction, o.cost.construction);
  });
  const hardSoftDropped = opLines.some((l) => {
    const o = rep.lines.find((x) => x.key === l.key)!;
    return near((o.hard + o.soft) - (l.hard + l.soft), l.operating);
  });
  check('B1c the pre-opening stage is INSIDE construction (measured on a copy with a line re-filed to it)',
    !!softLine && opLines.length > 0 && sameConstruction && hardSoftDropped,
    `${softLine ? softLine.id : 'no soft line'}; ${opLines.length} lines with pre-opening`);
  const T2 = (k: 'operating'): number => cap.treatment.reduce((a, r) => a + r[k], 0);
  check('B1d and it reconciles to the Capex rows', near(T2('operating'), rep.lines.reduce((a, l) => a + l.operating, 0)));
  check('B2 every margin is a price less a cost, and escalation is realised less base', marginOk);

  console.log('\n=== C. The base price is before escalation, measured both ways ===');
  const escalating = rep.lines.filter((l) => l.sale && (l.sale.escalationPerSqm ?? 0) > 1);
  check('C1 on the stored model escalation is earned where indexation runs', escalating.length > 0,
    rep.lines.filter((l) => l.sale).map((l) => `${l.label}: ${l.sale!.escalationPerSqm}`).join('; '));
  const flat = {
    ...state,
    assets: state.assets.map((a) => (a.revenue?.sell ? { ...a, revenue: { ...a.revenue, sell: { ...a.revenue.sell, indexation: { method: 'none' } } } } : a)),
  } as FinancialsResolverState;
  const flatRep = buildCostPerSqmReport(computeFinancialsSnapshot(flat), flat);
  const flatSell = flatRep.lines.filter((l) => l.sale);
  check('C2 with indexation switched off, GDV at base equals GDV exactly and escalation is zero',
    flatSell.length > 0 && flatSell.every((l) => near(l.sale!.gdvAtBase, l.sale!.gdv, 0.5) && Math.abs(l.sale!.escalationPerSqm ?? 1) < 1e-6),
    flatSell.map((l) => `${l.label}: ${l.sale!.gdv - l.sale!.gdvAtBase}`).join('; '));

  console.log('\n=== D. On screen, Sell comparison for Sell lines only ===');
  const nonSell = rep.lines.filter((l) => !l.sale);
  check('D1 a line with no Sell result has no sale comparison, and every Sell line has one',
    nonSell.every((l) => !snap.revenue.bySellAsset.has(l.memberIds[0])) && rep.lines.filter((l) => l.sale).every((l) => l.memberIds.some((id) => snap.revenue.bySellAsset.has(id))));
  const costs = src('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
  const t6 = costs.indexOf('{renderCategoryTable()}');
  const t7 = costs.indexOf('<CostPerSqmTables');
  check('D2 Table 7 renders at the END of the Capex results, after Table 6', t6 > 0 && t7 > t6);
  const table = src('src/hubs/modeling/platforms/refm/components/modules/_shared/CostPerSqmTables.tsx');
  check('D3 the screen renders the builder and computes nothing itself',
    /buildCostPerSqmReport\(computeFinancialsSnapshot\(state\), state\)/.test(table) && !/\/ l\.area|\/ s\.areaSold/.test(table));
  for (const f of ['src/hubs/modeling/platforms/refm/lib/reports/costPerSqmReport.ts', 'src/hubs/modeling/platforms/refm/components/modules/_shared/CostPerSqmTables.tsx']) {
    check(`G ${f} has no em dashes`, !src(f).includes('—'));
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
})();
