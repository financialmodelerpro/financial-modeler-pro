/**
 * verify-land-allocation-sqm.ts (2026-09-14)
 *
 * LAND IS ALLOCATED BY SQM, AND ONLY BY SQM (founder: "land is feeding by sqm,
 * so percent or BUA is not applicable"). The A / B / C land allocation mode
 * selector is retired from the Assets tab and the Project Wizard; every
 * project defaults to, loads on and saves 'sqm'.
 *
 *   A. A new project and the wizard's draft start on 'sqm'.
 *   B. A snapshot stored on 'autoByBua' or 'percent' loads on 'sqm', through
 *      both the normaliser and the store, base model included.
 *   C. A save writes 'sqm' whatever the live state holds.
 *   D. No selector survives on either surface, and the sqm input is unconditional.
 *   E. Live: every project loads on 'sqm' and no asset's land moves, because
 *      every live asset with land already draws a named plot in sqm.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-land-allocation-sqm.ts
 * No em dashes in this file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useModule1Store, DEFAULT_MODULE1_STATE } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeAssetLandSqm } from '../src/core/calculations';
import type { Asset, Parcel, SubUnit } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0;
const failures: string[] = [];
function check(id: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  [PASS] ${id}`); }
  else { failures.push(id); console.log(`  [FAIL] ${id}${detail ? `: ${detail}` : ''}`); }
}
function section(title: string): void { console.log(`\n--- ${title} ---`); }
const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const stripComments = (s: string): string => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

section('A. A new project starts on sqm');
check('A1 DEFAULT_MODULE1_STATE allocates land by sqm', DEFAULT_MODULE1_STATE.landAllocationMode === 'sqm', String(DEFAULT_MODULE1_STATE.landAllocationMode));

section('B. A stored non-sqm mode loads on sqm');
for (const stored of ['autoByBua', 'percent'] as const) {
  const snap = { ...DEFAULT_MODULE1_STATE, landAllocationMode: stored } as unknown as Record<string, unknown>;
  const normalised = hydrationFromAnySnapshot(snap);
  check(`B1 the normaliser reads a stored '${stored}' as 'sqm'`, normalised.landAllocationMode === 'sqm', String(normalised.landAllocationMode));
  useModule1Store.getState().hydrate({ ...normalised, landAllocationMode: stored } as never);
  const st = useModule1Store.getState();
  check(`B2 the store loads a '${stored}' snapshot on 'sqm', live and base model alike`,
    st.landAllocationMode === 'sqm' && (st.baseSnapshot as { landAllocationMode?: string }).landAllocationMode === 'sqm');
}

section('C. A save writes sqm');
{
  useModule1Store.getState().hydrate(hydrationFromAnySnapshot(DEFAULT_MODULE1_STATE as never));
  useModule1Store.setState({ landAllocationMode: 'autoByBua' } as never);
  const out = useModule1Store.getState().extractPersistSnapshot();
  check('C1 extractPersistSnapshot writes sqm even when the live state was set to another mode', out.landAllocationMode === 'sqm', String(out.landAllocationMode));
}

section('D. No selector survives');
{
  const tab = stripComments(read('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'));
  const wiz = stripComments(read('src/hubs/modeling/platforms/refm/components/modals/ProjectWizard.tsx'));
  check('D1 the Assets tab renders no mode selector (no radio, no A / B / C labels, no setter)',
    !tab.includes('land-allocation-mode') && !tab.includes('Percent split per asset') && !tab.includes('Auto, weight by BUA')
    && !tab.includes('setLandAllocationMode') && !tab.includes('LAND_ALLOCATION_MODES'));
  check('D2 the Assets tab has no percent or auto-by-BUA land block and no mode-conditioned land cell',
    !tab.includes("landAllocationMode === 'percent'") && !tab.includes("landAllocationMode === 'autoByBua'") && !tab.includes("landAllocationMode === 'sqm'"));
  check('D3 the sqm land inputs are unconditional: the Table 2 cell and the drawer field both render',
    tab.includes('testId={`asset-row-${asset.id}-land`}') && tab.includes('data-testid={`asset-${asset.id}-landAreaSqm`}'));
  check('D4 the Project Wizard renders no mode selector', !wiz.includes('wiz-land-mode') && !wiz.includes('LAND_ALLOCATION_MODES'));
}

async function live(): Promise<void> {
  section('E. Live: every project loads on sqm and no land moves');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('E0 credentials present', false, 'missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let projects = 0, onSqm = 0, unmoved = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as { snapshot: Record<string, unknown> }[];
    const raw = vs[0]?.snapshot;
    if (!raw) continue;
    projects += 1;
    const stored = (raw.landAllocationMode as 'sqm' | 'percent' | 'autoByBua' | undefined) ?? 'autoByBua';
    const hs = hydrationFromAnySnapshot(raw as never);
    if (hs.landAllocationMode === 'sqm') onSqm += 1;
    const assets = (hs.assets ?? []) as Asset[];
    const parcels = (hs.parcels ?? []) as Parcel[];
    const subUnits = (hs.subUnits ?? []) as SubUnit[];
    const moved = assets.filter((a) => Math.abs(computeAssetLandSqm(a, parcels, assets, subUnits, stored) - computeAssetLandSqm(a, parcels, assets, subUnits, 'sqm')) > 1e-6);
    if (moved.length === 0) unmoved += 1;
    console.log(`    ${p.name}: stored '${stored}', ${assets.length} asset(s), ${moved.length} moved`);
  }
  check(`E1 loaded live projects (${projects})`, projects > 0);
  check(`E2 every live project loads on sqm (${onSqm}/${projects})`, onSqm === projects);
  check(`E3 no live asset's land moves between its stored mode and sqm (${unmoved}/${projects} projects unmoved)`, unmoved === projects);
}

live().then(() => {
  console.log('');
  if (failures.length === 0) console.log(`verify-land-allocation-sqm: ${passed} passed, 0 failed`);
  else {
    console.log(`verify-land-allocation-sqm: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}).catch((e) => { console.error(e); process.exit(1); });
