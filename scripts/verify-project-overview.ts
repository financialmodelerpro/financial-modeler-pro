/**
 * verify-project-overview.ts (2026-09-16)
 *
 * THE PROJECT OVERVIEW: three return pairs, cost per sqm, and project detail.
 *
 *  A  the three pairs: a rate beside the multiple that explains it, and the
 *     distributed pair post-fee with pre-fee beside it only where a fund exists
 *  B  the figures tie: land by type to the scheme land, revenue mix to the P&L,
 *     phase capex to total development cost, phase revenue to total revenue
 *  C  cost per sqm is there, and is cost over the area it is charged on
 *  D  DSCR and ICR are gone from the surface entirely (founder: they belong on
 *     the financing surfaces)
 *  E  the screen reads the shared builder and renders each section
 *
 * Live where credentials allow, so the ties are proved on real data.
 * Run: npx tsx --env-file=.env.local scripts/verify-project-overview.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildOverviewReport } from '../src/hubs/modeling/platforms/refm/lib/reports/overviewReport';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? `: ${detail}` : ''}`); }
};
const quiet = <T>(fn: () => T): T => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
const sum = (a: readonly number[] | undefined): number => (a ?? []).reduce((t, x) => t + (x ?? 0), 0);

async function main(): Promise<void> {
  console.log('D. DSCR and ICR are off the dashboard');
  const src = readFileSync('src/hubs/modeling/platforms/refm/components/Overview.tsx', 'utf8');
  check('D1 no DSCR and no ICR anywhere on the overview', !/dscr/i.test(src) && !/\bicr\b/i.test(src), (src.match(/dscr\w*/gi) ?? []).join(','));

  console.log('\nE. The screen reads the shared builder');
  check('E1 the overview builds its figures through buildOverviewReport', /buildOverviewReport\(/.test(src));
  check('E2 it renders the three pairs, cost per sqm, the type table, the phases and the exit',
    /overview-return-\$\{r\.key\}/.test(src) && src.includes('overview-cost-per-sqm') && src.includes('overview-by-type')
    && src.includes('overview-phases') && src.includes('overview-revenue-mix'));
  check('E3 the hero carries the pairs and nothing else', !/Equity Multiple/.test(src));

  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('live sections need credentials (run with --env-file=.env.local)', false); return; }
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const get = async (p: string): Promise<any[]> => { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: h }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
  const projects = await get('refm_projects?select=id,name,current_version_id&deleted_at=is.null&order=name');
  let covered = 0;
  for (const p of projects) {
    if (!p.current_version_id) continue;
    const [v] = await get(`refm_project_versions?id=eq.${p.current_version_id}&select=snapshot`);
    if (!v?.snapshot) continue;
    const model: any = quiet(() => loadStoredModel(v.snapshot).snapshot);
    if (!(model.assets ?? []).filter((a: any) => a.visible !== false).length) continue;
    const snap: any = quiet(() => computeFinancialsSnapshot(model));
    const rs: any = quiet(() => computeReturnsSnapshot(snap, model.project));
    const ov = quiet(() => buildOverviewReport(snap, rs, model));
    covered++;
    console.log(`\n${p.name}`);

    console.log('A. The three pairs');
    check('A1 three pairs, project then equity then distributed', ov.returns.map((r) => r.key).join(',') === 'project,equity,distributed');
    check('A2 each pair carries its own MOIC beside its IRR',
      ov.returns.every((r) => typeof r.moic === 'number') && ov.returns[0].irr === rs.result.fcff.irr && ov.returns[1].moic === rs.result.fcfe.moic);
    check('A3 the distributed pair is post-fee with pre-fee beside it where a fund exists, and one figure where there is none',
      ov.fundLayer
        ? (ov.returns[2].irr === rs.resultNetDividends.irr && ov.returns[2].preFeeIrr === rs.result.dividends.irr)
        : (ov.returns[2].irr === rs.result.dividends.irr && ov.returns[2].preFeeIrr === undefined),
      `fund ${ov.fundLayer}`);

    console.log('B. The figures tie');
    check('B1 land by type sums to the scheme land', near(ov.byType.reduce((s, t) => s + t.landSqm, 0), ov.scheme.landSqm));
    check('B2 the land shares sum to one', ov.byType.length === 0 || near(ov.byType.reduce((s, t) => s + t.landPct, 0), 1, 1e-6));
    check('B3 the revenue mix sums to the P&L revenue', near(ov.revenueMix.reduce((s, r) => s + r.value, 0), sum(snap.pl.totalRevenuePerPeriod)));
    check('B4 phase capex sums to total development cost', near(ov.phases.reduce((s, ph) => s + ph.capex, 0), ov.costPerSqm.totalDevelopmentCost, 1));
    check('B5 phase revenue sums to the P&L revenue', near(ov.phases.reduce((s, ph) => s + ph.revenue, 0), sum(snap.pl.totalRevenuePerPeriod), 1));
    check('B6 every phase names its own construction years', ov.phases.every((ph) => ph.startYear !== null && ph.constructionEndYear !== null));
    check('B7 a type appears once', new Set(ov.byType.map((t) => t.typeId)).size === ov.byType.length, ov.byType.map((t) => t.label).join(' | '));

    console.log('C. Cost per sqm');
    const c = ov.costPerSqm;
    check('C1 development cost per GFA is the cost over the area', c.gfaSqm > 0 && near(c.developmentCostPerGfa ?? 0, c.totalDevelopmentCost / c.gfaSqm, 1e-6));
    check('C2 construction cost per GFA excludes land, so it is lower', (c.constructionCostPerGfa ?? 0) < (c.developmentCostPerGfa ?? 0));
    check('C3 cost per saleable sqm is charged on the saleable area', c.saleableSqm > 0 && near(c.developmentCostPerSaleable ?? 0, c.totalDevelopmentCost / c.saleableSqm, 1e-6));
    check('C4 the scheme states land, GFA and the plot ratio between them',
      ov.scheme.landSqm > 0 && ov.scheme.gfaSqm > 0 && near(ov.scheme.plotRatio ?? 0, ov.scheme.gfaSqm / ov.scheme.landSqm, 1e-9));
  }
  check(`\nlive coverage: at least one project with assets (covered ${covered})`, covered > 0);
}

main().then(() => { console.log(`\n=== ${pass} passed, ${fail} failed ===`); process.exit(fail ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
