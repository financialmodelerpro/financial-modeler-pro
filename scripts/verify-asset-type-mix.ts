/**
 * verify-asset-type-mix.ts (2026-09-15)
 *
 * THE LIST A PROJECT CARD SHOWS (`refm_projects.asset_mix`) IS THE PROJECT'S
 * ASSET TYPES ONCE EACH, BUILT BY ONE FUNCTION, NEVER FROM `Asset.name`.
 *
 * It was built in two places, one entry per visible asset from the retired
 * name, and a live card read "Branded Villas, Branded Villas, Branded Villas -
 * Retail, Retail, ...". This pins:
 *   A  the rule: types a visible asset uses, once each, in Types and Standards
 *      order; a listed type with no asset is not shown; the name is never read
 *   B  one computation: no second builder anywhere in app/ or src/
 *   C  live: every project's saved list equals the rule over its current version
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-asset-type-mix.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectAssetTypeMix } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeMix';
import { createModule1Store, type HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import type { Asset } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

// ── A. the rule ─────────────────────────────────────────────────────────────
section('A. the types a visible asset uses, once each, in the list order');
{
  const TYPES = [
    { id: 'branded-villas', label: 'Branded Villas', sortOrder: 0 },
    { id: 'retail-ground-floor', label: 'Retail Ground Floor', sortOrder: 1 },
    { id: 'hotel', label: 'Hospitality', sortOrder: 2 },
    { id: 'offices', label: 'Offices', sortOrder: 3 },
  ];
  const a = (id: string, extra: Record<string, unknown>): Asset =>
    ({ id, phaseId: 'p', name: `OLD NAME ${id}`, type: '', strategy: 'Sell', visible: true, ...extra }) as unknown as Asset;
  const assets = [
    a('1', { assetTypeId: 'branded-villas', type: 'Branded Villas' }),
    a('2', { assetTypeId: 'branded-villas', type: 'Branded Villas' }),
    a('3', { type: 'Branded Villas' }),
    a('4', { isCompanion: true, companionType: 'retail', strategy: 'Lease', type: 'Branded Villas - Retail' }),
    a('5', { assetTypeId: 'hotel', strategy: 'Operate', type: 'Hospitality' }),
    a('6', { assetTypeId: 'offices', visible: false, type: 'Offices' }),
    a('7', { type: 'Serviced  Offices' }),
  ];
  const mix = projectAssetTypeMix({ assets, project: { assetTypes: TYPES } });
  check('A1 each type once, in the Types and Standards order, a type by label or by id alike, a strip as ground-floor retail',
    JSON.stringify(mix) === JSON.stringify(['Branded Villas', 'Retail Ground Floor', 'Hospitality', 'Serviced Offices']), JSON.stringify(mix));
  check('A2 a type whose only asset is hidden, or that has no asset, is not part of the project', !mix.includes('Offices'));
  check('A3 the stored asset name is never read', !mix.some((l) => l.includes('OLD NAME')));
  const loose = projectAssetTypeMix({ assets: [a('x', { type: 'Villa' }), a('y', { type: 'villa' })], project: {} });
  check('A4 a project with no types listed still shows each type once', JSON.stringify(loose) === JSON.stringify(['Villa']), JSON.stringify(loose));
  check('A5 no assets, no list', projectAssetTypeMix({ assets: [], project: { assetTypes: TYPES } }).length === 0);
}

// ── B. one computation ──────────────────────────────────────────────────────
section('B. the saved list is built in one place');
{
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules' || f.startsWith('.')) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk('src'); walk('app');
  const src = files.map((f) => [f, readFileSync(f, 'utf8')] as const);
  const legacy = src.filter(([, s]) => s.includes('computeAssetMix')).map(([f]) => f);
  check('B1 the old builder is gone', legacy.length === 0, legacy.join(', '));
  // The SAVED list's side only: persistence, the refm project routes and the
  // screens that show it. The IC report's own "assetMix" model is a different
  // table (labels through assetLabel) and is not this list.
  const saveSide = src.filter(([f]) => /lib[\\/]persistence[\\/]|app[\\/]api[\\/]refm[\\/]|components[\\/](RealEstatePlatform|Dashboard|ProjectsScreen)\.tsx$/.test(f));
  const built = saveSide.filter(([, s]) => /assetMix:\s*[^\n;]*\.(map|filter)\(/.test(s) || /asset_mix:\s*[^\n;]*\.(map|filter)\(/.test(s)).map(([f]) => f);
  check('B2 no file builds the list inline from the assets', built.length === 0, built.join(', '));
  const callers = src.filter(([, s]) => /assetMix:\s*projectAssetTypeMix\(/.test(s)).map(([f]) => f.replace(/\\/g, '/'));
  check('B3 the three sync save paths and the create path call the one function',
    callers.some((f) => f.endsWith('lib/persistence/module1-sync.ts')) && callers.some((f) => f.endsWith('components/RealEstatePlatform.tsx'))
    && (readFileSync('src/hubs/modeling/platforms/refm/lib/persistence/module1-sync.ts', 'utf8').match(/assetMix:\s*projectAssetTypeMix\(/g) ?? []).length === 3,
    callers.join(', '));
  const fn = readFileSync('src/hubs/modeling/platforms/refm/lib/state/assetTypeMix.ts', 'utf8');
  check('B4 the function never reads the asset name', !/\.name\b/.test(fn.replace(/\/\*[\s\S]*?\*\//g, '')));
}

// ── C. live ─────────────────────────────────────────────────────────────────
async function live(): Promise<void> {
  section('C. live: every saved list equals the rule over the project\'s current version');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('C0 credentials present', false, 'missing'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name,asset_mix,current_version_id&deleted_at=is.null') as
    { id: string; name: string; asset_mix: string[] | null; current_version_id: string | null }[];
  let checked = 0, withAssets = 0;
  const wrong: string[] = [];
  const warn = console.warn;
  for (const p of ps) {
    const vs = await q(p.current_version_id
      ? `refm_project_versions?id=eq.${p.current_version_id}&select=snapshot`
      : `refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as { snapshot: unknown }[];
    if (!vs[0]?.snapshot) continue;
    console.warn = () => {};
    const store = createModule1Store();
    store.getState().hydrate(hydrationFromAnySnapshot(vs[0].snapshot) as HydrateSnapshot);
    console.warn = warn;
    const want = projectAssetTypeMix(store.getState());
    checked += 1;
    if (want.length > 0) withAssets += 1;
    if (JSON.stringify(p.asset_mix ?? []) !== JSON.stringify(want)) wrong.push(`${p.name}: saved ${JSON.stringify(p.asset_mix)} want ${JSON.stringify(want)}`);
  }
  check('C1 the census reached the live projects, one with assets at least', checked >= 1 && withAssets >= 1, `${checked} projects, ${withAssets} with assets`);
  check('C2 every saved card list equals the project\'s types once each', wrong.length === 0, wrong.join(' | '));
}

live().then(() => {
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
