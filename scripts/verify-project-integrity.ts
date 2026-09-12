/**
 * verify-project-integrity.ts (2026-09-12)
 *
 * EVERY REFERENCE IN A MODEL POINTS AT SOMETHING THAT EXISTS.
 *
 * Born from a measured defect: `removeParcel` deleted the plot row and cascaded
 * to nothing, so an asset created on that plot kept pointing at it. On
 * FMP - MARINA GATE that left asset_1789041611899 pointing at a parcel deleted
 * on 2026-09-10, and because the label resolver falls back to the phase when it
 * cannot find the plot, the row reappeared downstream under a new name.
 *
 * TWO HALVES, and the second is what makes the first safe to run everywhere:
 * the plot delete REFUSES and says how many assets the plot carries, and the
 * repair pass SETTLES, so hydrating a clean project returns the object it was
 * given and opening a project can never mark it dirty.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-project-integrity.ts
 * No em dashes in this file.
 */
/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { cascadeAssetRemoval,  repairProjectIntegrity, assetsOnParcel, describeRepairs } from '../src/core/calculations/projectIntegrity';
import { hydrationFromAnySnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 58 - t.length))}`);

interface A { id: string; landAllocation?: { parcelId?: string; sqm?: number } }
const st = (assets: A[], parcelIds: string[]): { assets: A[]; parcels: { id: string }[] } =>
  ({ assets, parcels: parcelIds.map((id) => ({ id })) });

function offline(): void {
  section('A. The repair');
  {
    const clean = st([{ id: 'a1', landAllocation: { parcelId: 'p1', sqm: 500 } }], ['p1']);
    const r = repairProjectIntegrity(clean);
    // IDENTITY, not equality. A clean model must come back as the SAME OBJECT,
    // or hydrate would hand the store a new one on every open, the autosave
    // diff would see a change, and every open would write a version.
    check('A1 a clean model returns the SAME OBJECT, so opening one cannot mark it dirty',
      r.changed === false && r.state === clean && r.repairs.length === 0);
  }
  {
    const broken = st([
      { id: 'a1', landAllocation: { parcelId: 'gone', sqm: 500 } },
      { id: 'a2', landAllocation: { parcelId: 'p1', sqm: 200 } },
    ], ['p1']);
    const r = repairProjectIntegrity(broken);
    check('A2 a dangling plot reference is cleared, and named',
      r.changed && r.repairs.length === 1 && r.repairs[0].ownerId === 'a1' && r.repairs[0].missingId === 'gone',
      JSON.stringify(r.repairs));
    check('A3 the asset keeps its AREA, because this repairs references and never values',
      r.state.assets[0].landAllocation?.sqm === 500 && r.state.assets[0].landAllocation?.parcelId === undefined,
      JSON.stringify(r.state.assets[0].landAllocation));
    check('A4 the asset that was fine is untouched',
      r.state.assets[1].landAllocation?.parcelId === 'p1');
    // IT SETTLES. Running it again must find nothing, or a project would be
    // repaired, saved, reopened and repaired again for ever.
    const again = repairProjectIntegrity(r.state);
    check('A5 running it twice changes nothing the second time',
      again.changed === false && again.state === r.state);
    check('A6 a repair is describable, so a save can say what it did',
      describeRepairs(r.repairs)[0].includes('a1') && describeRepairs(r.repairs)[0].includes('gone'));
  }
  {
    // A SENTINEL IS NOT A DANGLING REFERENCE. The weighted-average and
    // custom-rate ids say "no plot", which is a real answer; repairing one away
    // would change what an asset means. The label resolver uses the same test.
    const sentinel = st([{ id: 'a1', landAllocation: { parcelId: '__weighted_average__', sqm: 9 } }], ['p1']);
    const r = repairProjectIntegrity(sentinel);
    check('A7 a sentinel draw is left alone, because it is an answer and not a pointer',
      r.changed === false && r.state === sentinel);
  }
  {
    const none = st([{ id: 'a1' }, { id: 'a2', landAllocation: {} }], []);
    check('A8 an asset with no plot at all is not a repair',
      repairProjectIntegrity(none).changed === false);
  }

  section('D. Deletes cascade, orphans are repaired');
  {
    const model = {
      assets: [
        { id: 'h1', landAllocation: { parcelId: 'p1', sqm: 500 } },
        { id: 'h2', landAllocation: { parcelId: 'p2', sqm: 300 } },
        { id: 'op', parentAssetId: 'h1', isCompanion: true },
        { id: 'strip', isCompanion: true, companionType: 'retail', retailHostAssetIds: ['h1', 'h2'] },
      ],
      parcels: [{ id: 'p1' }, { id: 'p2' }],
      subUnits: [{ id: 'u1', assetId: 'h1' }, { id: 'u2', assetId: 'h2' }, { id: 'us', assetId: 'strip' }, { id: 'uo', assetId: 'op' }],
      costLines: [{ id: 'construction-bua__p', targetAssetId: undefined }, { id: 'custom-1__p', targetAssetId: 'h1' }],
      costOverrides: [{ assetId: 'h1', lineId: 'construction-bua__p' }, { assetId: 'strip', lineId: 'construction-bua__p' }, { assetId: 'h2', lineId: 'construction-bua__p' }],
      financingTranches: [{ assetId: 'h1' }, { assetId: undefined }],
      equityContributions: [{ assetId: 'h2' }],
      cases: [{ overrides: { 'assets[id=h1].buaSqm': 1, 'subUnits[id=u1].unitPrice': 2, 'assets[id=h2].buaSqm': 3, 'phases[id=p].name': 'x' } }],
    };
    const r = cascadeAssetRemoval(model, ['h1']);
    const ids = new Set(r.state.assets.map((a) => a.id));
    check('D1 removing a host takes its Operate companion, its sub-units, its per-asset line, its overrides and its scenario overrides',
      !ids.has('h1') && !ids.has('op') && ids.has('h2') && ids.has('strip')
      && r.state.subUnits!.map((u) => u.id).join() === 'u2,us'
      && r.state.costLines!.length === 1 && r.state.costOverrides!.map((o) => o.assetId).join() === 'strip,h2'
      && Object.keys(r.state.cases![0].overrides!).join() === 'assets[id=h2].buaSqm,phases[id=p].name',
      JSON.stringify(r.report));
    check('D2 the strip is DETACHED from a removed host and kept while another host remains; a tranche scoped to the host now finances its phase',
      r.state.assets.find((a) => a.id === 'strip')!.retailHostAssetIds!.join() === 'h2'
      && r.state.financingTranches![0].assetId === undefined && r.report.tranchesRescoped === 1 && r.report.stripsDetached.join() === 'strip');
    const r2 = cascadeAssetRemoval(r.state, ['h2']);
    check('D3 removing the last host removes the strip, its sub-unit and its override, and clears the equity scope',
      r2.state.assets.length === 0 && r2.state.subUnits!.length === 0 && r2.state.costOverrides!.length === 0
      && r2.report.stripsRemoved.join() === 'strip' && r2.state.equityContributions![0].assetId === undefined,
      JSON.stringify(r2.report));
    // A plot delete is the same rule on the plot's assets.
    const plot = cascadeAssetRemoval(model, assetsOnParcel(model.assets, 'p1'));
    check('D4 a plot delete cascades through the same rule: the assets on the plot and everything of theirs',
      plot.report.assetIds.sort().join() === 'h1,op' && plot.state.subUnits!.length === 2);
    // Orphans left by any older path are repaired on load, and the repair settles.
    const orphaned = {
      assets: [{ id: 'h2', landAllocation: { parcelId: 'p2', sqm: 300 } }, { id: 'strip', isCompanion: true, companionType: 'retail', retailHostAssetIds: ['gone'] }],
      parcels: [{ id: 'p2' }],
      subUnits: [{ id: 'u2', assetId: 'h2' }, { id: 'ux', assetId: 'gone' }, { id: 'us', assetId: 'strip' }],
      costOverrides: [{ assetId: 'gone', lineId: 'l' }, { assetId: 'h2', lineId: 'l' }],
      costLines: [{ id: 'custom-2__p', targetAssetId: 'gone' }, { id: 'construction-bua__p' }],
      financingTranches: [{ assetId: 'gone' }],
      equityContributions: [{ assetId: 'h2' }],
    };
    const rep = repairProjectIntegrity(orphaned);
    check('D5 the load repair drops an orphan sub-unit, override and per-asset line, clears an orphan tranche scope, and removes a strip with no host',
      rep.changed && rep.state.subUnits!.map((u) => u.id).join() === 'u2'
      && rep.state.costOverrides!.length === 1 && rep.state.costLines!.length === 1
      && rep.state.financingTranches![0].assetId === undefined
      && rep.state.equityContributions![0].assetId === 'h2'
      && !rep.state.assets.some((a) => a.id === 'strip'),
      rep.repairs.map((x) => x.kind).join(','));
    const again = repairProjectIntegrity(rep.state);
    check('D6 and it settles', again.changed === false && again.state === rep.state);
    const storeSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
    check('D7 the store deletes an asset and a plot through the ONE cascade rule',
      (storeSrc.match(/cascadeAssetRemoval\(/g) ?? []).length === 2
      && !storeSrc.includes("return { removed: false, assetCount: carried.length, assetIds: carried };"));
    const tabSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
    check('D8 the plot Remove button confirms and cascades instead of refusing, and Table 5 offers the sell basis per line',
      !tabSrc.includes('disabled={assetCount > 0}')
      && tabSrc.includes('window.confirm(' + String.fromCharCode(96) + 'Remove ' + '$' + '{parcel.name')
      && tabSrc.includes('onSetMetric(line.assetIds, m)')
      && tabSrc.includes("for (const id of assetIds) updateAsset(id, { subUnitMetric: next });"));
  }

  section('B. The refusal reads the same rule');
  {
    const assets: A[] = [
      { id: 'a1', landAllocation: { parcelId: 'p1' } },
      { id: 'a2', landAllocation: { parcelId: 'p1' } },
      { id: 'a3', landAllocation: { parcelId: 'p2' } },
    ];
    check('B1 the count a refusal states is the assets that draw that plot',
      assetsOnParcel(assets, 'p1').length === 2 && assetsOnParcel(assets, 'p2').length === 1
      && assetsOnParcel(assets, 'p3').length === 0);
    // THE TWO MUST BE THE SAME QUESTION. A plot refused for carrying an asset
    // whose pointer the repair would then clear is two rules disagreeing.
    const afterRepair = repairProjectIntegrity(st(assets, ['p1', 'p2']));
    check('B2 nothing the refusal counts is something the repair would clear',
      afterRepair.changed === false);
  }
}

async function live(): Promise<void> {
  section('C. Live: every stored snapshot');
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('C0 credentials present', false, 'missing'); return; }
  const q = async (path: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let checked = 0, repaired = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as { snapshot: unknown }[];
    if (!vs[0]) continue;
    let state: { assets: A[]; parcels: { id: string }[] };
    try { state = hydrationFromAnySnapshot(vs[0].snapshot as never) as never; } catch { continue; }
    if (!state.assets?.length) continue;
    checked += 1;
    const r = repairProjectIntegrity(state);
    if (r.changed) { repaired += 1; console.log(`  ${p.name}: ${describeRepairs(r.repairs).join('; ')}`); }
    // THE GUARANTEE THAT MATTERS ON LIVE DATA: it settles on the second run,
    // whatever the first one found.
    const again = repairProjectIntegrity(r.state);
    check(`C1 ${p.name}: the repair settles`, again.changed === false, JSON.stringify(again.repairs));
  }
  // RE-AIMED 2026-09-12: the founder deleted FMP RE HUB, so one live project carries assets; the census asks for at least one.
  check('C2 the census reached the projects that have assets', checked >= 1, `${checked}`);
  console.log(`  (${repaired} of ${checked} carried a dangling reference before the pass)`);
}

async function main(): Promise<void> {
  console.log('=== project integrity ===');
  offline();
  await live();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}
void main();
