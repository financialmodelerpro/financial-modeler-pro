/* eslint-disable no-console */
/**
 * verify-version-edit-choice.ts (2026-06-17)
 *
 * Guards the version edit-choice feature end to end at the sync layer (the
 * heart of the behaviour), driving the REAL module1-sync session functions
 * against an in-memory server (mocked fetch). Asserts the three Edit paths plus
 * mid-session save-as-new, and that every path is non-destructive to other
 * versions.
 *
 *   - Open lands in VIEW mode: no editing version, no churn.
 *   - Edit-in-place: edits PATCH the LOADED version row; NO POST; version count
 *     unchanged; other versions untouched.
 *   - Create-new: POSTs a NEW version branched off the base; base untouched;
 *     naming metadata (version_label / task_name / comment) preserved.
 *   - Save-as-new mid-session: POSTs a new version from the current state,
 *     continues editing the NEW row; the source version is untouched.
 *
 * Run: npx tsx scripts/verify-version-edit-choice.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useModule1Store } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { buildExcelSampleState } from './excelSampleState';
import {
  attachToProject,
  detach,
  startEditInPlace,
  startEditSession,
  saveAsNewVersion,
  flushAutoSaveForTest,
  getEditingVersionIdForDebug,
  getEditingEnabledForDebug,
  getSessionBaseVersionIdForDebug,
} from '../src/hubs/modeling/platforms/refm/lib/persistence/module1-sync';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

type Row = {
  id: string; version_number: number; snapshot: any; label: string | null;
  base_version_id: string | null; change_log: unknown[]; created_at: string;
  version_label: string | null; task_name: string | null; comment: string | null;
};

const realFetch = globalThis.fetch;

interface Server {
  versions: Row[];
  currentId: string;
  postCount: number;
  patchCount: number;
  lastPostBody: any;
}

// Install an in-memory project/version server as global fetch.
function installServer(initialSnapshot: any): Server {
  let nextNum = 2;
  const server: Server = {
    versions: [{
      id: 'v1', version_number: 1, snapshot: initialSnapshot, label: 'Base v1.0',
      base_version_id: null, change_log: [], created_at: '2026-01-01T00:00:00Z',
      version_label: '1.0', task_name: null, comment: null,
    }],
    currentId: 'v1', postCount: 0, patchCount: 0, lastPostBody: null,
  };
  const json = (obj: unknown, status = 200): Response =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const u = String(url);
    const one  = /\/api\/refm\/projects\/([^/]+)\/versions\/([^/?]+)/.exec(u);
    const vers = /\/api\/refm\/projects\/([^/]+)\/versions(?:\?|$)/.exec(u);
    const proj = /\/api\/refm\/projects\/([^/?]+)(?:\?|$)/.exec(u);

    if (one) {
      const row = server.versions.find((v) => v.id === one[2]);
      if (!row) return json({ error: 'not found' }, 404);
      if (method === 'PATCH') {
        server.patchCount++;
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.snapshot !== undefined) row.snapshot = body.snapshot;
        if (body.label !== undefined) row.label = body.label;
        if (body.versionLabel !== undefined) row.version_label = body.versionLabel;
        if (body.taskName !== undefined) row.task_name = body.taskName;
        if (body.comment !== undefined) row.comment = body.comment;
        return json({ version: row });
      }
      return json({ version: row }); // GET single
    }
    if (vers && method === 'POST') {
      server.postCount++;
      const body = JSON.parse(String(init?.body ?? '{}'));
      server.lastPostBody = body;
      const id = `v${nextNum}`; const num = nextNum; nextNum++;
      const row: Row = {
        id, version_number: num, snapshot: body.snapshot, label: body.label ?? null,
        base_version_id: body.baseVersionId ?? null, change_log: [], created_at: '2026-01-02T00:00:00Z',
        version_label: body.versionLabel ?? null, task_name: body.taskName ?? null, comment: body.comment ?? null,
      };
      server.versions.push(row); server.currentId = id;
      return json({ project: { id: vers[1] }, version: row });
    }
    if (vers && method === 'GET') {
      return json({ versions: server.versions });
    }
    if (proj && method === 'GET') {
      const cur = server.versions.find((v) => v.id === server.currentId);
      return json({ project: { id: proj[1], name: 'Test', current_version_id: server.currentId }, version: cur });
    }
    return json({ error: `unhandled ${method} ${u}` }, 500);
  }) as typeof globalThis.fetch;

  return server;
}

const clone = (o: unknown): any => JSON.parse(JSON.stringify(o));
// Make a real edit by hydrating a modified snapshot (changes project.name, a
// top-level field that round-trips, so the dirty comparison sees a change).
function editProjectName(name: string): void {
  const snap = clone(useModule1Store.getState().extractPersistSnapshot());
  snap.project = { ...snap.project, name };
  useModule1Store.getState().hydrate(snap);
}

async function main(): Promise<void> {
  const baseSnap = buildExcelSampleState();

  // ── 1. Open lands in VIEW mode (no churn) ──────────────────────────────────
  console.log('=== [1] Open lands in VIEW mode (no version churn) ===');
  let server = installServer(clone(baseSnap));
  await attachToProject('p1');
  check('after open: editing disabled (view mode)', getEditingEnabledForDebug() === false);
  check('after open: no editing version yet', getEditingVersionIdForDebug() === null);
  check('after open: session base anchored to the loaded version', getSessionBaseVersionIdForDebug() === 'v1');
  check('after open: still exactly 1 version (open created none)', server.versions.length === 1, `count=${server.versions.length}`);
  detach();

  // ── 2. Edit-in-place: PATCH the loaded row, NO new version ─────────────────
  console.log('\n=== [2] Edit-in-place overwrites the loaded version, spawns none ===');
  server = installServer(clone(baseSnap));
  await attachToProject('p1');
  const ip = startEditInPlace();
  check('startEditInPlace targets the LOADED version id', ip.versionId === 'v1' && getEditingVersionIdForDebug() === 'v1', `editingId=${getEditingVersionIdForDebug()}`);
  check('startEditInPlace enables editing', getEditingEnabledForDebug() === true);
  editProjectName('In-place Edit');
  await flushAutoSaveForTest();
  check('edit-in-place did NOT POST a new version', server.postCount === 0, `posts=${server.postCount}`);
  check('edit-in-place PATCHed the loaded row', server.patchCount >= 1, `patches=${server.patchCount}`);
  check('version count UNCHANGED after edit-in-place', server.versions.length === 1, `count=${server.versions.length}`);
  check('the loaded version snapshot was overwritten in place', server.versions[0].snapshot?.project?.name === 'In-place Edit', server.versions[0].snapshot?.project?.name);
  detach();

  // ── 3. Create-new: POST a new version, base untouched, naming preserved ────
  console.log('\n=== [3] Create-new produces a new version, base untouched ===');
  server = installServer(clone(baseSnap));
  await attachToProject('p1');
  const baseNameBefore = server.versions[0].snapshot?.project?.name;
  const cn = await startEditSession('Test_v1.1_06172026_New Work', { versionLabel: '1.1', taskName: 'New Work', comment: 'Branching a new version' });
  check('create-new POSTed exactly one new version', server.postCount === 1, `posts=${server.postCount}`);
  check('create-new bumped the version count to 2', server.versions.length === 2, `count=${server.versions.length}`);
  check('create-new editing id is the NEW row (not the base)', cn.versionId === 'v2' && getEditingVersionIdForDebug() === 'v2', `editingId=${getEditingVersionIdForDebug()}`);
  check('create-new branched off the base version', server.versions[1].base_version_id === 'v1', `base=${server.versions[1].base_version_id}`);
  check('naming metadata preserved on the new version', server.versions[1].version_label === '1.1' && server.versions[1].task_name === 'New Work' && server.versions[1].comment === 'Branching a new version');
  check('the source (base) version snapshot is UNTOUCHED', server.versions[0].snapshot?.project?.name === baseNameBefore, server.versions[0].snapshot?.project?.name);
  detach();

  // ── 4. Save-as-new mid-session: branch + continue on the new row ───────────
  console.log('\n=== [4] Mid-session save-as-new branches and continues on the new row ===');
  server = installServer(clone(baseSnap));
  await attachToProject('p1');
  startEditInPlace(); // editing v1 in place
  editProjectName('Working State');
  await flushAutoSaveForTest(); // v1 now carries "Working State"
  const v1SnapAfterWork = clone(server.versions[0].snapshot);
  const san = await saveAsNewVersion('Test_v1.2_06172026_Branch', { versionLabel: '1.2', taskName: 'Branch', comment: 'Save as new from working state' });
  check('save-as-new POSTed a new version', server.versions.length === 2, `count=${server.versions.length}`);
  check('save-as-new continues editing the NEW row', san.versionId === 'v2' && getEditingVersionIdForDebug() === 'v2', `editingId=${getEditingVersionIdForDebug()}`);
  check('save-as-new re-anchored the session base to the new row', getSessionBaseVersionIdForDebug() === 'v2');
  check('save-as-new branched off the version we were editing (v1)', server.versions[1].base_version_id === 'v1', `base=${server.versions[1].base_version_id}`);
  check('save-as-new captured the current working state', server.versions[1].snapshot?.project?.name === 'Working State', server.versions[1].snapshot?.project?.name);
  // Continue editing: a further edit must PATCH v2, leaving v1 (the source) frozen.
  const postsBefore = server.postCount;
  editProjectName('After Branch');
  await flushAutoSaveForTest();
  check('post-branch edits PATCH the new row (no further POST)', server.postCount === postsBefore, `posts=${server.postCount}`);
  check('the new row received the continued edit', server.versions[1].snapshot?.project?.name === 'After Branch', server.versions[1].snapshot?.project?.name);
  check('the SOURCE version is frozen after branching (non-destructive)', JSON.stringify(server.versions[0].snapshot) === JSON.stringify(v1SnapAfterWork), `srcName=${server.versions[0].snapshot?.project?.name}`);
  detach();

  // ── 5. UI wiring: Edit opens the choice step; choice routes correctly ──────
  console.log('\n=== [5] UI wiring (Edit -> choice step -> routes) ===');
  const ROOT = join(__dirname, '..');
  const REFM = join(ROOT, 'src/hubs/modeling/platforms/refm/components');
  const platform = readFileSync(join(REFM, 'RealEstatePlatform.tsx'), 'utf8');
  const choiceModal = readFileSync(join(REFM, 'modals/EditChoiceModal.tsx'), 'utf8');
  const topbar = readFileSync(join(REFM, 'Topbar.tsx'), 'utf8');

  // Clicking Edit opens the CHOICE step (not the create modal directly).
  check('handleEnableEditing opens the Edit choice step', /handleEnableEditing\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*setEditChoiceOpen\(true\)/.test(platform));
  check('EditChoiceModal is rendered with the open flag', /<EditChoiceModal[\s\S]*?open=\{editChoiceOpen\}/.test(platform));
  // The choice step shows the current version name.
  check('choice step is passed the current version name', /<EditChoiceModal[\s\S]*?currentVersionName=\{activeVersionData\?\.name/.test(platform));
  check('choice modal renders a current-version block', /data-testid="edit-choice-current-version"/.test(choiceModal));
  check('choice modal offers all three options', /data-testid=\{`edit-choice-option-\$\{opt\.value\}`\}/.test(choiceModal)
    && /value:\s*'in-place'/.test(choiceModal) && /value:\s*'different'/.test(choiceModal) && /value:\s*'create-new'/.test(choiceModal));
  check('in-place is the default when a version is loaded', /canEditInPlace\s*\?\s*'in-place'\s*:\s*'create-new'/.test(choiceModal));

  // handleEditChoice routes each choice.
  check('choice in-place calls startEditInPlace', /choice === 'in-place'[\s\S]*?startEditInPlace\(\)/.test(platform));
  check('choice different opens the history picker in edit intent', /choice === 'different'[\s\S]*?setVersionPickMode\('edit'\)[\s\S]*?setVersionModalOpen\(true\)/.test(platform));
  check('choice create-new opens the rich create flow', /\/\/ create-new[\s\S]*?setNameVersionModalMode\('start-session'\)/.test(platform));
  check('different-version load routes to edit-in-place', /mode === 'edit'\)?\s*void handleLoadVersionForEdit/.test(platform));
  check('handleLoadVersionForEdit loads then edits in place', /handleLoadVersionForEdit[\s\S]*?loadVersionInto\([\s\S]*?startEditInPlace\(\)/.test(platform));

  // Save-as-new mid-session.
  check('save-as-new handler opens the modal in save-as-new mode', /handleSaveAsNewVersion[\s\S]*?setNameVersionModalMode\('save-as-new'\)/.test(platform));
  check('confirm routes save-as-new mode to saveAsNewVersion', /nameVersionModalMode === 'save-as-new'[\s\S]*?saveAsNewVersion\(/.test(platform));
  check('Topbar shows a Save-as-new button only in edit mode', /editMode && onSaveAsNewVersion &&[\s\S]*?data-testid="topbar-save-as-new"/.test(topbar));

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
}

main()
  .then(() => {
    globalThis.fetch = realFetch;
    if (failed > 0) { console.log('FAILED: ' + fails.join('; ')); process.exit(1); }
  })
  .catch((e) => { globalThis.fetch = realFetch; console.error(e); process.exit(1); });
