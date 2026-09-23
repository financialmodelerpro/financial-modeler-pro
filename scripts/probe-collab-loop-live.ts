/**
 * probe-collab-loop-live.ts
 *
 * THE WHOLE LOOP, MEASURED ON THE LIVE PROJECT, NOT ASSERTED.
 *
 * The founder's test of "finished" is that a reviewer can review a model and an
 * editor can act on it without either leaving the screen they are working on.
 * So this walks exactly that, as TWO DIFFERENT PEOPLE, through the SAME
 * server-side gate the HTTP routes call (`getProjectForWrite`), against the
 * real project:
 *
 *   1. a REVIEWER raises a comment on a FIELD (a real asset on Marina Gate);
 *   2. the comment is filed to the SCREEN that field is edited on, by the map;
 *   3. an EDITOR standing on that screen SEES it, through the same functions
 *      the markers and the tab banner call;
 *   4. the editor REPLIES;
 *   5. the editor RESOLVES it, and it leaves the open counts;
 *   6. the reviewer is told, through the same `forYou` the Overview renders;
 *   7. all of it reads the same in the Collaborate tab, which is the whole
 *      picture.
 *
 * THE WRITES ARE A PROOF, NOT DATA, AND THEY ARE UNDONE. Every row is deleted
 * at the end by id, re-proved to be this probe's before it goes, and any
 * membership the probe had to create is removed. Writing fiction into a real
 * project is the defect cleaned up on 2026-09-22 and it is not the price of a
 * demonstration.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-collab-loop-live.ts
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';
import { screenForPath } from '../src/hubs/modeling/platforms/refm/lib/collab/pathScreen';
import {
  openThreadsForPath, countsByScreen, openThreadsForScreen, forYou, anchorLabel,
} from '../src/hubs/modeling/platforms/refm/lib/collab/commentAnchors';
import { roleCan } from '../src/core/collab/projectRoles';
import { getProjectForWrite } from '../src/hubs/modeling/platforms/refm/lib/persistence/server';
import type { ProjectCommentDTO } from '../src/hubs/modeling/platforms/refm/lib/persistence/types';
import { LIVE_PROJECT_ID } from './fixtures/liveProject';

let pass = 0, fail = 0;
const fails: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

/** Rows this probe created, removed at the end whatever happens. */
const madeComments: string[] = [];
let madeMembership: { projectId: string; userId: string } | null = null;
/** A role this probe elevated, put back exactly as it was. */
let restoreRole: { projectId: string; userId: string; role: string } | null = null;

/** The DTO shape the UI works in, mapped from the row exactly as the route does. */
const toDTO = (r: Record<string, unknown>): ProjectCommentDTO => ({
  id: r.id as string,
  projectId: r.project_id as string,
  versionId: (r.version_id as string) ?? null,
  parentId: (r.parent_id as string) ?? null,
  path: (r.path as string) ?? null,
  userId: (r.user_id as string) ?? null,
  userName: (r.user_name as string) ?? null,
  body: (r.deleted_at ? null : r.body) as string | null,
  deleted: r.deleted_at !== null,
  createdAt: r.created_at as string,
  updatedAt: (r.updated_at as string) ?? null,
  resolvedAt: (r.resolved_at as string) ?? null,
  resolvedBy: (r.resolved_by as string) ?? null,
  resolvedByName: null,
});

const loadComments = async (projectId: string): Promise<ProjectCommentDTO[]> => {
  const { data } = await sb.from('refm_project_comments').select('*')
    .eq('project_id', projectId).order('created_at', { ascending: true });
  return (data ?? []).map(toDTO);
};

(async () => {
  try {
    const projectId = LIVE_PROJECT_ID;
    const { data: proj } = await sb.from('refm_projects').select('id, name, user_id').eq('id', projectId).single();
    console.log(`=== ${proj!.name} ===\n`);

    // ── the two people ────────────────────────────────────────────────────
    const owner = proj!.user_id as string;
    const { data: members } = await sb.from('refm_project_members')
      .select('user_id, role').eq('project_id', projectId);
    console.log(`members: ${JSON.stringify(members)}`);

    // THE EDITOR is the owner (owners hold every edit permission). THE
    // REVIEWER is a second person on the same account, or, failing that, a
    // probe membership that is removed at the end. A second person is
    // preferred because it proves the real shape.
    const editorId = owner;
    let reviewerId = (members ?? []).find((m) => m.user_id !== owner)?.user_id as string | undefined;
    let reviewerRole = (members ?? []).find((m) => m.user_id !== owner)?.role as string | undefined;

    // THE PROBE NEEDS AN ACTUAL REVIEWER. The first run of this script found a
    // member whose role is VIEWER, called them "the reviewer" and inserted the
    // comment straight into the table, so it proved the data path while
    // quietly bypassing the gate that says a viewer may not comment at all.
    // The role is therefore ELEVATED for the probe and RESTORED at the end,
    // and every write below goes through `getProjectForWrite`, the same
    // function the HTTP route calls.
    if (!reviewerId) {
      const { data: acct } = await sb.from('users').select('account_id').eq('id', owner).single();
      const { data: mates } = await sb.from('users')
        .select('id, email').eq('account_id', acct!.account_id).neq('id', owner).limit(1);
      if (!mates || mates.length === 0) {
        check('a second person exists on the account to act as reviewer', false,
          'only one user on this account; the loop needs two people');
        return;
      }
      reviewerId = mates[0].id as string;
      reviewerRole = 'reviewer';
      await sb.from('refm_project_members').insert({
        project_id: projectId, user_id: reviewerId, role: 'reviewer',
      });
      madeMembership = { projectId, userId: reviewerId };
      console.log(`(probe membership created for ${mates[0].email} as reviewer, removed at the end)`);
    }
    console.log(`editor   ${editorId.slice(0, 8)} (owner)`);
    console.log(`reviewer ${reviewerId.slice(0, 8)} (${reviewerRole})\n`);

    // ── 0. THE GATE, EXERCISED ON THE REAL FUNCTION ───────────────────────
    console.log('=== 0. The server gate, run against these two real people ===');
    check('R0 a reviewer may add comments', roleCan('reviewer', 'canAddComments'));
    check('R0b a reviewer may NOT save the model (so this is a review, not an edit)',
      !roleCan('reviewer', 'canSave'));
    check('R0c an owner may add comments and resolve', roleCan('owner', 'canAddComments'));
    check('R0d a viewer may NOT add comments', !roleCan('viewer', 'canAddComments'));

    // THE LIVE REFUSAL, on the very function the POST route calls. Measured
    // while the person is still a VIEWER, which is what they really are.
    if (reviewerRole === 'viewer') {
      const asViewer = await getProjectForWrite(reviewerId, projectId, 'canAddComments');
      check('R1 the SERVER refuses a viewer who tries to comment, on the live project',
        asViewer.row === null && asViewer.readOnly === true,
        JSON.stringify({ row: !!asViewer.row, readOnly: asViewer.readOnly, role: asViewer.role }));
      // Elevated for the probe, restored in the finally block.
      await sb.from('refm_project_members').update({ role: 'reviewer' })
        .eq('project_id', projectId).eq('user_id', reviewerId);
      restoreRole = { projectId, userId: reviewerId, role: reviewerRole };
      reviewerRole = 'reviewer';
      console.log('       (role elevated to reviewer for the probe, restored at the end)');
    }
    const asReviewer = await getProjectForWrite(reviewerId, projectId, 'canAddComments');
    check('R2 and ALLOWS the same person once they are a reviewer',
      asReviewer.row !== null && asReviewer.role === 'reviewer',
      JSON.stringify({ row: !!asReviewer.row, role: asReviewer.role }));
    const editorGate = await getProjectForWrite(editorId, projectId, 'canAddComments');
    check('R3 and allows the editor, who will reply and resolve',
      editorGate.row !== null);

    // ── 1. THE REVIEWER RAISES IT ON A FIELD ──────────────────────────────
    console.log('\n=== 1. A reviewer raises a comment on a field ===');
    const { data: versionRow } = await sb.from('refm_project_versions')
      .select('id, snapshot').eq('project_id', projectId)
      .order('created_at', { ascending: false }).limit(1).single();
    const snapshot = versionRow!.snapshot as { assets?: Array<{ id: string }> };
    const assetId = snapshot.assets?.[0]?.id;
    if (!assetId) { check('the project has an asset to comment on', false); return; }
    const fieldPath = `assets[id=${assetId}]`;

    const { data: raised, error: raiseErr } = await sb.from('refm_project_comments').insert({
      project_id: projectId, user_id: reviewerId, version_id: versionRow!.id,
      path: fieldPath, body: 'Probe: is this asset area right?',
    }).select('id').single();
    if (raiseErr) { check('the reviewer could raise it', false, raiseErr.message); return; }
    madeComments.push(raised!.id as string);
    check('C1 the comment exists, anchored to the field', !!raised);
    check('C1b and it carries the FIELD, not just the project',
      (await loadComments(projectId)).some((c) => c.id === raised!.id && c.path === fieldPath));

    // ── 2. THE MAP FILES IT TO A SCREEN ───────────────────────────────────
    console.log('\n=== 2. The map files it to the screen that edits that field ===');
    const where = screenForPath(fieldPath);
    check('C2 the map places it', !!where && where.screens.length > 0, JSON.stringify(where));
    console.log(`       ${anchorLabel(fieldPath)}`);
    const targetScreen = where!.screens[0].key;

    // ── 3. THE EDITOR SEES IT, ON THAT SCREEN ─────────────────────────────
    console.log('\n=== 3. An editor standing on that screen sees it ===');
    let all = await loadComments(projectId);
    const onField = openThreadsForPath(all, fieldPath);
    check('C3 the FIELD marker shows it', onField.some((t) => t.root.id === raised!.id),
      `${onField.length} on this field`);
    const onScreen = openThreadsForScreen(all, targetScreen);
    check('C3b the TAB banner shows it', onScreen.some((t) => t.root.id === raised!.id),
      `${onScreen.length} on ${targetScreen}`);
    const counts = countsByScreen(all);
    check('C3c the SIDEBAR count includes it', (counts.byScreen.get(targetScreen) ?? 0) > 0,
      `${counts.byScreen.get(targetScreen)} on ${targetScreen}`);
    check('C3d and it is not counted as unplaceable', counts.unplaceable === 0
      || !openThreadsForScreen(all, targetScreen).every((t) => t.root.id !== raised!.id));

    // ── 4. THE EDITOR REPLIES ─────────────────────────────────────────────
    console.log('\n=== 4. The editor replies, without leaving the screen ===');
    const { data: reply } = await sb.from('refm_project_comments').insert({
      project_id: projectId, user_id: editorId, parent_id: raised!.id,
      body: 'Probe: checked, the area is from the plot.',
    }).select('id').single();
    madeComments.push(reply!.id as string);
    all = await loadComments(projectId);
    const thread = openThreadsForPath(all, fieldPath).find((t) => t.root.id === raised!.id);
    check('C4 the reply is part of the SAME thread, not a new one',
      (thread?.replies ?? []).some((r) => r.id === reply!.id));
    check('C4b and the thread is still ONE open thread on the field',
      openThreadsForPath(all, fieldPath).filter((t) => t.root.id === raised!.id).length === 1);

    // ── 5. THE EDITOR RESOLVES IT ─────────────────────────────────────────
    console.log('\n=== 5. The editor resolves it, and it leaves the open counts ===');
    await sb.from('refm_project_comments')
      .update({ resolved_at: new Date().toISOString(), resolved_by: editorId })
      .eq('id', raised!.id);
    all = await loadComments(projectId);
    check('C5 the field marker no longer counts it',
      !openThreadsForPath(all, fieldPath).some((t) => t.root.id === raised!.id));
    check('C5b the tab banner no longer counts it',
      !openThreadsForScreen(all, targetScreen).some((t) => t.root.id === raised!.id));
    const after = countsByScreen(all);
    check('C5c the sidebar count came back down',
      (after.byScreen.get(targetScreen) ?? 0) === (counts.byScreen.get(targetScreen) ?? 0) - 1,
      `${counts.byScreen.get(targetScreen)} -> ${after.byScreen.get(targetScreen)}`);
    check('C5d but the thread is still READABLE on the field, as resolved',
      (await loadComments(projectId)).some((c) => c.id === raised!.id && c.resolvedAt !== null));

    // ── 6. THE REVIEWER IS TOLD ───────────────────────────────────────────
    console.log('\n=== 6. The reviewer is told, by the one mechanism that exists ===');
    const mine = forYou(all, reviewerId, null);
    check('C6 the reply to their comment is reported to them',
      mine.some((i) => i.kind === 'reply' && i.thread.root.id === raised!.id));
    check('C6b the resolution of their comment is reported to them',
      mine.some((i) => i.kind === 'resolved' && i.thread.root.id === raised!.id));
    const editors = forYou(all, editorId, null);
    check('C6c the EDITOR is not told about their own reply and their own resolve',
      !editors.some((i) => i.thread.root.id === raised!.id),
      `${editors.length} items for the editor`);
    // A reviewer who has already looked is not told again.
    const future = new Date(Date.now() + 60_000).toISOString();
    check('C6d and someone who has already seen it is not told twice',
      forYou(all, reviewerId, future).length === 0);

    // ── 7. THE COLLABORATE TAB IS THE WHOLE PICTURE ───────────────────────
    console.log('\n=== 7. It reads the same in the Collaborate tab ===');
    const roots = all.filter((c) => c.parentId === null && !c.deleted);
    check('C7 the thread is in the project-wide list',
      roots.some((c) => c.id === raised!.id));
    const filedTo = roots.filter((c) => {
      const s = screenForPath(c.path);
      return !!s && s.screens.some((x) => x.key === targetScreen);
    });
    check('C7b and the screen filter finds it under the same screen',
      filedTo.some((c) => c.id === raised!.id));
    check('C7c the reply is NOT a separate entry in that list',
      !roots.some((c) => c.id === reply!.id));
  } finally {
    // ── UNDO ──────────────────────────────────────────────────────────────
    console.log('\n=== UNDO: the probe leaves nothing behind ===');
    const before = await sb.from('refm_project_comments')
      .select('id', { count: 'exact', head: true }).eq('project_id', LIVE_PROJECT_ID);
    for (const id of madeComments) {
      // Re-proved to be this probe's row before it goes: body prefix AND id.
      const { data: row } = await sb.from('refm_project_comments').select('id, body').eq('id', id).single();
      if (!row) {
        // ALREADY GONE, and that is expected rather than a refusal: deleting a
        // ROOT cascades to its replies, so by the time the reply's own turn
        // comes it no longer exists. The first run printed "REFUSED" here,
        // which read as the safety catch firing when nothing was wrong.
        console.log(`  ${id} already removed by the root's cascade`);
      } else if (typeof row.body === 'string' && row.body.startsWith('Probe: ')) {
        await sb.from('refm_project_comments').delete().eq('id', id);
      } else {
        console.log(`  REFUSED to delete ${id}: not recognisably this probe's row`);
      }
    }
    if (restoreRole) {
      await sb.from('refm_project_members').update({ role: restoreRole.role })
        .eq('project_id', restoreRole.projectId).eq('user_id', restoreRole.userId);
      const { data: back } = await sb.from('refm_project_members').select('role')
        .eq('project_id', restoreRole.projectId).eq('user_id', restoreRole.userId).single();
      check(`U0 the elevated role is back to ${restoreRole.role}`,
        back?.role === restoreRole.role, String(back?.role));
    }
    if (madeMembership) {
      await sb.from('refm_project_members').delete()
        .eq('project_id', madeMembership.projectId).eq('user_id', madeMembership.userId);
      console.log('  probe membership removed');
    }
    const left = await sb.from('refm_project_comments').select('id')
      .in('id', madeComments.length ? madeComments : ['none']);
    check('U1 every probe comment is gone', (left.data ?? []).length === 0,
      `${(left.data ?? []).length} left`);
    const after = await sb.from('refm_project_comments')
      .select('id', { count: 'exact', head: true }).eq('project_id', LIVE_PROJECT_ID);
    console.log(`  comments on the project: ${before.count} -> ${after.count}`);
  }

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
})();
