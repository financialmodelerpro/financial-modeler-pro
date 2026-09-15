/**
 * verify-stored-model-load.ts (2026-09-15)
 *
 * A SAVED VERSION READS THE SAME EVERYWHERE: through the store's load, never
 * through migration alone.
 *
 * The Portfolio dashboard route and the saved-version export ran the engine on
 * `hydrationFromAnySnapshot` output, which stops before the store's load steps,
 * so they priced a model without the Types and Standards defaults (live:
 * development cost 1,313.13m against the screen's 1,337.57m). This pins:
 *   A  the helper returns the model the store settles, defaults included
 *   B  the base case is the top-level model (a saved scenario is dropped by the
 *      legacy load route today; that is held for the load-route fix)
 *   C  no reader outside the load path runs on migration output alone
 *   D  live: every project's portfolio figures equal the screen's
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-stored-model-load.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { createModule1Store, type HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { DEFAULT_PHASE_ID, type Asset, type CostOverride } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { seedCostStandardRows } from '../src/hubs/modeling/platforms/refm/lib/state/costStandards';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { projectPortfolioMetrics } from '../src/hubs/modeling/platforms/refm/lib/portfolio/portfolioMetrics';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };
const quiet = <T>(fn: () => T): T => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };
const tdc = (m: HydrateSnapshot): number => quiet(() => computeReturnsSnapshot(computeFinancialsSnapshot(m as never), (m as never as { project: never }).project).totalDevelopmentCost);
const key = (o: CostOverride): string => `${o.assetId}::${o.lineId}`;
const sorted = (a: CostOverride[]): string => JSON.stringify([...a].sort((x, y) => key(x).localeCompare(key(y))));

// ── fixture: a project the store settled, saved the way the app saves ───────
const P = DEFAULT_PHASE_ID;
const st = createModule1Store();
quiet(() => {
  st.getState().setProject({ assetTypes: [{ id: 'branded-villas', label: 'Branded Villas' }] } as never);
  st.getState().addAsset({
    id: 'v1', phaseId: P, name: 'v1', type: 'Branded Villas', assetTypeId: 'branded-villas', strategy: 'Sell', visible: true,
    buaSqm: 10000, sellableBuaSqm: 10000,
  } as unknown as Asset);
  st.getState().setCostStandardRows(seedCostStandardRows([{ id: 'branded-villas', label: 'Branded Villas' }] as never, undefined));
});
const saved = quiet(() => st.getState().extractPersistSnapshot()) as HydrateSnapshot;

section('A. the helper returns the model the store settles');
{
  const standard = saved.costOverrides.filter((o) => o.origin === 'standard').length;
  const loaded = quiet(() => loadStoredModel(saved)).snapshot;
  const migOnly = quiet(() => hydrationFromAnySnapshot(saved));
  console.log(`   saved standard overrides ${standard}; migration alone keeps ${migOnly.costOverrides.filter((o) => o.origin === 'standard').length}; the helper keeps ${loaded.costOverrides.filter((o) => o.origin === 'standard').length}`);
  check('A1 the fixture carries Types and Standards defaults', standard > 0, String(standard));
  check('A2 the helper returns every override the store saved', sorted(loaded.costOverrides) === sorted(saved.costOverrides));
  const a = tdc(saved), b = tdc(loaded);
  check('A3 and prices the same development cost as the store model', a > 0 && Math.abs(a - b) < 0.005, `${a} vs ${b}`);
}

section('B. the base case is the top-level model');
{
  // A SAVED SCENARIO DOES NOT SURVIVE THE LOAD TODAY (found 2026-09-15, held for
  // the load-route fix): the legacy route rebuilds the snapshot without `cases`
  // and `activeCaseId`, and the store seeds fresh default cases. So this checks
  // what the helper itself guarantees: whatever case was active when the version
  // was saved, the top-level model the Portfolio and the export price is the base.
  const line = saved.costLines.find((l) => l.id === `construction-bua__${P}`)!;
  const withCase = {
    ...saved,
    cases: [
      ...(saved.cases ?? []).filter((c) => c.role === 'base'),
      { id: 'probe-case', name: 'Probe', role: 'scenario', overrides: { [`costLines[id=${line.id}].value`]: 99999 } },
    ],
    activeCaseId: 'probe-case',
  } as HydrateSnapshot;
  const baseOnly = quiet(() => loadStoredModel(saved)).snapshot.costLines.find((l) => l.id === line.id)?.value;
  const top = quiet(() => loadStoredModel(withCase)).snapshot.costLines.find((l) => l.id === line.id)?.value;
  check('B1 an active scenario never reaches the top-level model', top === baseOnly && top !== 99999, `${top} vs ${baseOnly}`);
}

section('C. no reader runs on migration output alone');
{
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules' || f.startsWith('.')) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p.replace(/\\/g, '/'));
    }
  };
  walk('src'); walk('app');
  // The load path itself: migration, the store, this helper, the screen's own
  // load (which hydrates the store) and the one-off local-to-server migrator.
  const ALLOWED = [
    'lib/state/module1-migrate.ts', 'lib/state/module1-store.ts', 'lib/state/loadStoredModel.ts',
    'lib/persistence/module1-sync.ts', 'lib/persistence/migrator.ts',
  ];
  const callers = files.filter((f) => /hydrationFromAnySnapshot(Checked)?\(/.test(readFileSync(f, 'utf8')) && !ALLOWED.some((a) => f.endsWith(a)));
  check('C1 nothing outside the load path calls migration alone', callers.length === 0, callers.join(', '));
  const route = readFileSync('app/api/refm/portfolio/route.ts', 'utf8');
  const exp = readFileSync('src/hubs/modeling/platforms/refm/components/modals/ExportModal.tsx', 'utf8');
  check('C2 the Portfolio route and the saved-version export load through the helper',
    route.includes('loadStoredModel(raw)') && exp.includes('loadStoredModel(row.snapshot)'));
}

async function live(): Promise<void> {
  section('D. live: every project\'s portfolio figures equal the screen\'s');
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('D0 credentials present', false, 'missing'); return; }
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const get = async (p: string): Promise<any[]> => { const r = await fetch(`${URL}/rest/v1/${p}`, { headers: h }); if (!r.ok) throw new Error(await r.text()); return r.json(); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ps = await get('refm_projects?select=id,name,current_version_id&deleted_at=is.null&archived=eq.false');
  let compared = 0, withMoney = 0;
  const wrong: string[] = [];
  for (const p of ps) {
    const vs = await get(p.current_version_id
      ? `refm_project_versions?id=eq.${p.current_version_id}&select=snapshot`
      : `refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`);
    if (!vs[0]?.snapshot) continue;
    // THE SCREEN'S LOAD, written out independently of the helper: migrate, hydrate, extract, base case active.
    const screen = quiet(() => {
      const s = createModule1Store();
      const m = hydrationFromAnySnapshot(vs[0].snapshot);
      const base = (m.cases ?? []).find((c) => c.role === 'base')?.id;
      s.getState().hydrate({ ...m, ...(base ? { activeCaseId: base } : {}) });
      return s.getState().extractPersistSnapshot() as HydrateSnapshot;
    });
    const dash = quiet(() => projectPortfolioMetrics(p.id, p.name, loadStoredModel(vs[0].snapshot).snapshot as never));
    const want = quiet(() => projectPortfolioMetrics(p.id, p.name, screen as never));
    compared += 1;
    if (want.totalDevelopmentCost > 0) withMoney += 1;
    for (const k of ['totalDevelopmentCost', 'gdv', 'equityInvested', 'equityDistributions', 'projectIrr', 'equityIrr', 'fundingRequirement'] as const) {
      const a = dash[k] as number | null, b = want[k] as number | null;
      if (a === b || (a !== null && b !== null && Math.abs(a - b) < 0.005)) continue;
      wrong.push(`${p.name} ${k}: ${a} vs ${b}`);
    }
    if (want.totalDevelopmentCost > 0) {
      const migOnly = quiet(() => projectPortfolioMetrics(p.id, p.name, hydrationFromAnySnapshot(vs[0].snapshot) as never));
      console.log(`   ${p.name}: development cost ${want.totalDevelopmentCost.toFixed(2)} (migration alone would read ${migOnly.totalDevelopmentCost.toFixed(2)})`);
    }
  }
  check('D1 the census reached the live projects, one priced at least', compared >= 1 && withMoney >= 1, `${compared} projects, ${withMoney} priced`);
  check('D2 every portfolio figure equals the screen\'s', wrong.length === 0, wrong.join(' | '));
}

live().then(() => {
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
