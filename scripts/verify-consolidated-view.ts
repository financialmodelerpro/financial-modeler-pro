/**
 * verify-consolidated-view.ts (2026-09-08, consolidation step 2)
 *
 * THE CONSOLIDATED VIEW IS A VIEW: the same money, grouped differently.
 *
 * What it proves:
 *   A. THE TOTAL IS THE SAME. The consolidated total equals the per-asset total
 *      to the cent, on a fixture and on every live project. A consolidated
 *      table whose total differs from the per-asset one is worse than no table,
 *      because both are on screen and a reader cannot tell which is wrong.
 *   B. NOTHING IS LOST OR COUNTED TWICE: every asset appears in exactly one
 *      row, and a merged row names its members.
 *   C. NOTHING READS IT. No calculation or resolver imports the builder; the
 *      Costs tab is its only consumer, and the engine is untouched.
 *   D. LIVE: the view on all six projects, with the reconciliation measured.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-consolidated-view.ts
 *
 * No em dashes in this file.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildConsolidatedReport, perAssetCostsFromCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/consolidatedReport';
import { buildCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { buildExcelSampleState } from './excelSampleState';
import { normaliseAssetTypeId } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };
const money = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function offlineChecks(): void {
  section('A. The same money, grouped differently');
  const state = buildExcelSampleState();
  const snap = computeFinancialsSnapshot(state);
  const capex = buildCapexReport(snap, state);
  const rep = buildConsolidatedReport(state.assets, state.phases, perAssetCostsFromCapexReport(capex.inputAssets), normaliseAssetTypeId);

  check('A0 the fixture produced per-asset capex to consolidate',
    capex.inputAssets.length >= 2 && rep.perAssetTotal > 0, `${capex.inputAssets.length} assets`);
  check('A1 the consolidated total EQUALS the per-asset total, to the cent',
    Math.abs(rep.difference) < 0.005,
    `consolidated ${money(rep.totals.total)} vs per-asset ${money(rep.perAssetTotal)}`);
  check('A2 every asset lands in exactly one row and none is dropped',
    rep.rows.reduce((s, r) => s + r.assetCount, 0) === state.assets.length
    && new Set(rep.rows.flatMap((r) => r.assetNames)).size <= state.assets.length);
  check('A3 a row names the assets inside it, so a merge is never anonymous',
    rep.rows.every((r) => r.assetNames.length === r.assetCount && r.assetNames.every((n) => n.trim() !== '')));

  // THE MERGE ITSELF, on a fixture built to merge: two assets, one phase, one
  // type, one strategy. The live projects do not merge, so without this the
  // merging path would never run.
  section('B. A row that actually merges');
  const twin = {
    ...state,
    assets: [
      { ...state.assets[0], id: 'M1', name: 'Villas A', type: 'Branded Villas', strategy: 'Sell' },
      { ...state.assets[0], id: 'M2', name: 'Villas B', type: 'Branded Villas', strategy: 'Sell' },
    ],
  };
  const merged = buildConsolidatedReport(twin.assets, twin.phases, [
    { assetId: 'M1', land: 10, hard: 100, soft: 20, marketing: 0, operating: 5, total: 135 },
    { assetId: 'M2', land: 20, hard: 200, soft: 40, marketing: 0, operating: 10, total: 270 },
  ], normaliseAssetTypeId);
  check('B1 two assets of one type and strategy in one phase become ONE row',
    merged.rows.length === 1 && merged.rows[0].assetCount === 2);
  check('B2 the merged row SUMS its members, and the total still reconciles',
    merged.rows[0].total === 405 && merged.rows[0].hard === 300
    && Math.abs(merged.difference) < 0.005);
  check('B3 the merged row names both members',
    merged.rows[0].assetNames.join(', ') === 'Villas A, Villas B');
  check('B4 the report says it is NOT a relabelling when something merges',
    !merged.isRelabellingOnly && merged.mergedRows.length === 1);
  const split = buildConsolidatedReport(
    [{ ...twin.assets[0] }, { ...twin.assets[1], strategy: 'Lease' }],
    twin.phases,
    [{ assetId: 'M1', land: 10, hard: 100, soft: 20, marketing: 0, operating: 5, total: 135 },
      { assetId: 'M2', land: 20, hard: 200, soft: 40, marketing: 0, operating: 10, total: 270 }],
    normaliseAssetTypeId,
  );
  check('B5 a different STRATEGY splits them again, and the total is unchanged',
    split.rows.length === 2 && Math.abs(split.perAssetTotal - merged.perAssetTotal) < 0.005);

  // An asset with no cost row at all must not silently vanish from the view.
  const orphan = buildConsolidatedReport(twin.assets, twin.phases, [
    { assetId: 'M1', land: 0, hard: 100, soft: 0, marketing: 0, operating: 0, total: 100 },
  ], normaliseAssetTypeId);
  check('B6 an asset with NO cost row still appears, contributing zero',
    orphan.rows[0].assetCount === 2 && orphan.rows[0].total === 100
    && Math.abs(orphan.difference) < 0.005);

  // B7 IS THE ONE THAT MATTERS, and it exists because a sabotage got past the
  // others. If `perAssetTotal` were computed from the GROUPS instead of the
  // source rows, the reconciliation would compare the view to itself and pass
  // no matter what: sourcing it from `totals.total` left every check green.
  //
  // So this feeds a cost row for an asset that is NOT in the list. The money
  // exists and no row shows it, which is exactly the real hazard, an asset
  // filtered out of the view while its cost still counts. Only a reconciliation
  // computed from the SOURCE can see it.
  const ghost = buildConsolidatedReport(twin.assets, twin.phases, [
    { assetId: 'M1', land: 0, hard: 100, soft: 0, marketing: 0, operating: 0, total: 100 },
    { assetId: 'M2', land: 0, hard: 200, soft: 0, marketing: 0, operating: 0, total: 200 },
    { assetId: 'GONE', land: 0, hard: 999, soft: 0, marketing: 0, operating: 0, total: 999 },
  ], normaliseAssetTypeId);
  check('B7 money belonging to an asset the view does not show BREAKS the reconciliation',
    Math.abs(ghost.difference - 999) < 0.005,
    `difference ${money(ghost.difference)}, expected 999`);

  section('C. Nothing reads it');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(p)) out.push(p.replace(/\\/g, '/'));
    }
    return out;
  };
  const engine = [
    ...walk('src/core/calculations'),
    'src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/opex-resolvers.ts',
    'src/hubs/modeling/platforms/refm/lib/costOfSales.ts',
  ];
  const engineReaders = engine.filter((f) => readFileSync(f, 'utf8').includes('consolidatedReport'));
  check('C1 no calculation or resolver imports the consolidated builder',
    engineReaders.length === 0, engineReaders.join(' | '));
  const consumers = walk('src/hubs/modeling/platforms/refm')
    .filter((f) => !f.endsWith('reports/consolidatedReport.ts'))
    .filter((f) => readFileSync(f, 'utf8').includes('buildConsolidatedReport'));
  check('C2 exactly ONE surface consumes it, the Costs tab',
    consumers.length === 1 && consumers[0].endsWith('Module1Costs.tsx'), consumers.join(' | '));
  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  check('C3 the tab feeds it the rows it ALREADY computed, rather than recomputing',
    /treatmentTable\.map\(\(r\) => \(\{/.test(tab) && tab.includes('assetId: r.id,'));
  check('C4 the screen states the reconciliation rather than hiding it',
    tab.includes('data-testid="capex-consolidated-check"')
    && tab.includes('Ties to the per-asset total below')
    && tab.includes('Treat the per-asset tables as authoritative'));
}

async function liveChecks(): Promise<void> {
  section('D. Live: the view on every project, reconciled');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('D0 credentials present', false, 'missing'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let withAssets = 0, worst = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as
      { snapshot: unknown }[];
    if (!vs[0]) continue;
    let state: ReturnType<typeof hydrationFromAnySnapshot>;
    try { state = hydrationFromAnySnapshot(vs[0].snapshot as never); } catch { continue; }
    if (!state.assets.length) { console.log(`  ${p.name}: no assets`); continue; }
    withAssets += 1;
    const snap = computeFinancialsSnapshot(state as never);
    const capex = buildCapexReport(snap, state as never);
    const rep = buildConsolidatedReport(state.assets, state.phases, perAssetCostsFromCapexReport(capex.inputAssets), normaliseAssetTypeId);
    worst = Math.max(worst, Math.abs(rep.difference));
    console.log(`  ${p.name}: ${state.assets.length} assets -> ${rep.rows.length} rows, `
      + `${rep.mergedRows.length} merged, total ${money(rep.totals.total)}, out by ${money(rep.difference)}`);
    check(`D1 ${p.name}: consolidated total ties to the per-asset total`,
      Math.abs(rep.difference) < 0.005,
      `${money(rep.totals.total)} vs ${money(rep.perAssetTotal)}`);
    check(`D2 ${p.name}: every asset appears exactly once`,
      rep.rows.reduce((s, r) => s + r.assetCount, 0) === state.assets.length);
  }
  check('D3 the census covered the projects that have assets', withAssets >= 2, `${withAssets}`);
  check('D4 the worst reconciliation gap across the platform is zero to the cent',
    worst < 0.005, `worst ${money(worst)}`);
}

async function main(): Promise<void> {
  console.log('=== verify-consolidated-view ===');
  offlineChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
