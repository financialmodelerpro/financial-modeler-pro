/**
 * apply-retail-slot-ratio-2026-09-27.ts, a one-off, founder-directed model edit.
 *
 * WHY. On FMP - MARINA GATE the retail parking figure the land chain reads (25
 * sqm of retail GFA per slot, `resolveRetailSlotArea`) came from the values of
 * `retail-combined`, a type NOT in the project's list, whose values outlived
 * it. The visible Retail Ground Floor row also said 25 but with basis
 * "slots per unit", which the rule does not read. So the number the model used
 * lived where nobody could see or edit it. This states it on Retail Ground
 * Floor (25, sqm per slot) and removes the orphan's values: the rule prefers the
 * catalog's ground-floor retail id ("Retail combined") BY NAME, so while they
 * exist it keeps reading them. With them gone, Retail Ground Floor is the one
 * type stating sqm per slot and the rule reads it.
 *
 * HOW. Exactly the platform's own save, done from a script: the latest saved
 * version is loaded through the store (`loadStoredModel` -> `hydrate`), the
 * edit is made with the store's own action (`setAssetTypeValue`, what the
 * Types and Standards tab calls), the snapshot is read through the save door
 * (`extractPersistSnapshot`), and it is written as a NEW version with a
 * comment, the change log diffed against the version it came from and a
 * `version.created` row in the activity log, as POST .../versions does. The
 * previous version is untouched, so the edit is reversible by opening it.
 *
 * It refuses while anyone holds the edit lock (a live heartbeat).
 *
 * Measured before it writes: every figure in the hardcoded workbook, built
 * from the model before and after, cell for cell.
 *
 * Run:  npx tsx --env-file=.env.local scripts/apply-retail-slot-ratio-2026-09-27.ts           (dry run)
 *       npx tsx --env-file=.env.local scripts/apply-retail-slot-ratio-2026-09-27.ts --apply   (writes)
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';
import type ExcelJS from 'exceljs';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { useModule1Store, modelFromSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { resolveRetailSlotArea, resolveRetailSlotTypeId } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { projectAssetTypeMix } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeMix';
import { diffSnapshots } from '../src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff';
import { insertVersion, nextVersionNumber, updateProject } from '../src/hubs/modeling/platforms/refm/lib/persistence/server';
import { appendChanges } from '../src/hubs/modeling/platforms/refm/lib/persistence/changeLog';
import { readLock } from '../src/hubs/modeling/platforms/refm/lib/persistence/lock';
import { SCHEMA_VERSION } from '../src/hubs/modeling/platforms/refm/lib/persistence/types';
import { getNextVersionNumber, buildVersionName } from '../src/hubs/modeling/platforms/refm/lib/persistence/versionNaming';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { LIVE_PROJECT_ID } from './fixtures/liveProject';

const TYPE_ID = 'retail-ground-floor';
const ORPHAN_ID = 'retail-combined';
const TASK = 'Retail parking ratio on its type';
const COMMENT = 'Retail Ground Floor now states its parking ratio as 25 sqm of retail GFA per slot. '
  + 'The land chain already used 25, read from the values of a type no longer in the list (retail-combined); '
  + 'this puts the figure on a type the project shows and removes the orphan type values, which the rule would otherwise keep reading first. Applied from a script at the founder\'s direction, 2026-09-27.';

function numbers(wb: ExcelJS.Workbook): Map<string, number> {
  const out = new Map<string, number>();
  for (const ws of wb.worksheets) ws.eachRow((row, r) => row.eachCell((cell, c) => {
    const raw = cell.value as unknown;
    const v = typeof raw === 'number' ? raw : raw && typeof raw === 'object' && 'result' in (raw as object) ? (raw as { result: unknown }).result : null;
    if (typeof v === 'number' && Number.isFinite(v)) out.set(`${ws.name}!R${r}C${c}`, v);
  }));
  return out;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: proj, error: pErr } = await sb.from('refm_projects').select('id, name, user_id').eq('id', LIVE_PROJECT_ID).single();
  if (pErr || !proj) throw new Error(`project read: ${pErr?.message}`);
  const { data: vers, error: vErr } = await sb.from('refm_project_versions')
    .select('id, snapshot, version_label, created_at').eq('project_id', LIVE_PROJECT_ID).order('created_at', { ascending: false });
  if (vErr || !vers?.length) throw new Error(`versions read: ${vErr?.message}`);
  const base = vers[0] as { id: string; snapshot: unknown; version_label: string | null; created_at: string };
  console.log(`Project: ${proj.name}; latest version ${base.version_label ?? '(none)'} (${base.id})`);

  const { lock } = await readLock(LIVE_PROJECT_ID, proj.user_id);
  if (lock && Date.now() - Date.parse(lock.heartbeatAt) < 5 * 60_000) {
    throw new Error(`REFUSED: ${lock.holderName ?? lock.holderUserId} holds the edit lock (heartbeat ${lock.heartbeatAt}). Nothing written.`);
  }

  const store = useModule1Store;
  store.getState().hydrate(structuredClone(loadStoredModel(base.snapshot).snapshot));
  const before = store.getState().extractPersistSnapshot();
  console.log(`Before: ${TYPE_ID} = ${JSON.stringify(before.project.assetTypeValues?.[TYPE_ID])}; the chain reads ${resolveRetailSlotArea(before.project.assetTypeValues)} from ${resolveRetailSlotTypeId(before.project.assetTypeValues)}`);

  store.getState().setAssetTypeValue(TYPE_ID, { parkingRatio: 25, parkingRatioBasis: 'sqm_per_slot' });
  // The rule prefers the catalog's own ground-floor retail id BY NAME, so while the
  // orphan's values exist it keeps reading them: they go in the same version.
  store.getState().setAssetTypeValue(ORPHAN_ID, { parkingRatio: undefined, parkingRatioBasis: undefined });
  if (store.getState().project.assetTypeValues?.[ORPHAN_ID]) throw new Error(`${ORPHAN_ID} still holds values: ${JSON.stringify(store.getState().project.assetTypeValues?.[ORPHAN_ID])}`);
  const after = store.getState().extractPersistSnapshot();
  console.log(`After:  ${TYPE_ID} = ${JSON.stringify(after.project.assetTypeValues?.[TYPE_ID])}; the chain reads ${resolveRetailSlotArea(after.project.assetTypeValues)} from ${resolveRetailSlotTypeId(after.project.assetTypeValues)}`);

  const edit = diffSnapshots(before, after);
  console.log(`\nThe edit, as the change log records it (${edit.length} path(s)):`);
  for (const e of edit) console.log(`  ${JSON.stringify(e)}`);

  // WHAT MOVES: every figure the workbook prints, before against after.
  const opts = (snap: typeof before) => ({ state: modelFromSnapshot(snap) as never, projectName: proj.name, dateLabel: 'measure' });
  const a = numbers(buildModelWorkbook(opts(before))), b = numbers(buildModelWorkbook(opts(after)));
  const moved = [...a].filter(([k, v]) => !b.has(k) || Math.abs((b.get(k) as number) - v) > 1e-9).map(([k, v]) => `${k}: ${v} -> ${b.get(k)}`);
  const added = [...b.keys()].filter((k) => !a.has(k));
  console.log(`\nWorkbook figures compared: ${a.size}; moved: ${moved.length}; appeared: ${added.length}`);
  for (const m of moved.slice(0, 40)) console.log(`  ${m}`);
  for (const k of added.slice(0, 20)) console.log(`  + ${k}: ${b.get(k)}`);

  if (!apply) { console.log('\nDRY RUN: nothing written. Re-run with --apply to save it as a new version.'); return; }

  const versionLabel = getNextVersionNumber(vers.map((v) => ({ versionLabel: v.version_label as string | null, createdAt: v.created_at as string })));
  const { next, error: nErr } = await nextVersionNumber(LIVE_PROJECT_ID);
  if (nErr) throw new Error(nErr);
  const label = buildVersionName(proj.name, versionLabel, TASK);
  const { row, error: iErr } = await insertVersion({
    project_id: LIVE_PROJECT_ID, version_number: next, schema_version: SCHEMA_VERSION, snapshot: after,
    label, base_version_id: base.id, change_log: diffSnapshots(base.snapshot as never, after),
    version_label: versionLabel, task_name: TASK, comment: COMMENT,
    // No session: attributed to the project owner, on whose direction it was made (the comment says so).
    created_by: proj.user_id,
  });
  if (iErr || !row) throw new Error(`insert: ${iErr}`);
  await appendChanges([{ projectId: LIVE_PROJECT_ID, versionId: row.id, userId: proj.user_id, action: 'version.created', path: null, before: null,
    after: { versionNumber: next, label: row.label ?? null, baseVersionId: base.id } }]);
  const { error: uErr } = await updateProject(proj.user_id, LIVE_PROJECT_ID, {
    current_version_id: row.id, schema_version: SCHEMA_VERSION, asset_mix: projectAssetTypeMix(after as never),
  });
  if (uErr) throw new Error(`project update: ${uErr}`);
  console.log(`\nWRITTEN: version ${versionLabel} (#${next}, ${row.id}) "${label}", now the project's current version.`);
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
