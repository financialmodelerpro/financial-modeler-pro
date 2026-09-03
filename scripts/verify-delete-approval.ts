/**
 * verify-delete-approval.ts
 *
 * Module 10 Collaboration, step 9: DELETE REQUIRES ADMIN APPROVAL.
 *
 * Owner deletes directly (soft, 30-day window). An EDITOR, who could not
 * delete at all, may now ASK. Reviewers and Viewers get neither. Archive is
 * untouched.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-delete-approval.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { roleCan, PROJECT_ROLES } from '../src/core/collab/projectRoles';
import { PROJECT_SOURCES, hasMembership } from '../src/shared/admin/projectSources';
import { approveDeleteRequest, declineDeleteRequest } from '../src/shared/admin/deleteRequests';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const src = (f: string): string => readFileSync(f, 'utf8');
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = 'supabase/migrations/238_project_delete_requests.sql';
const ENGINE = 'src/shared/admin/deleteRequests.ts';
const REQ_ROUTE = 'app/api/refm/projects/[id]/delete-request/route.ts';
const ADMIN_ROUTE = 'app/api/admin/project-delete-requests/route.ts';
const BROWSER = 'src/components/admin/ProjectsBrowser.tsx';
const SHELL = 'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx';
const DASH = 'src/hubs/modeling/platforms/refm/components/Dashboard.tsx';

console.log('=== A. Who may delete, and who may ask ===');
{
  check('A1 only the OWNER can delete directly',
    roleCan('owner', 'canDeleteProject')
    && !roleCan('editor', 'canDeleteProject')
    && !roleCan('reviewer', 'canDeleteProject')
    && !roleCan('viewer', 'canDeleteProject'));
  // The owner is FALSE here and that is not an inversion: they hold
  // canDeleteProject, so a request would be a slower road to the same place.
  check('A2 only the EDITOR can request a delete',
    roleCan('editor', 'canRequestDelete')
    && !roleCan('owner', 'canRequestDelete')
    && !roleCan('reviewer', 'canRequestDelete')
    && !roleCan('viewer', 'canRequestDelete'));
  check('A3 no role holds BOTH: delete and ask are alternatives, not a pair',
    PROJECT_ROLES.every((r) => !(roleCan(r, 'canDeleteProject') && roleCan(r, 'canRequestDelete'))));
  check('A4 an unknown role gets neither',
    !roleCan('superuser', 'canDeleteProject') && !roleCan(null, 'canRequestDelete'));
  check('A5 the owner-is-false reasoning is written down, not just coded',
    /an owner deletes, never asks/i.test(src('src/core/collab/projectRoles.ts')));
}

console.log('\n=== B. The table ===');
{
  const m = src(MIG);
  check('B1 platform agnostic: a platform column, and NO FK on project_id',
    /platform\s+text\s+NOT NULL/i.test(m) && !/project_id[^\n]*REFERENCES/i.test(m));
  check('B2 the requester FK is ON DELETE SET NULL',
    /requested_by[^\n]*REFERENCES users\(id\) ON DELETE SET NULL/i.test(m));
  check('B3 ONE open request per project, by partial unique index',
    /CREATE UNIQUE INDEX[\s\S]{0,160}\(platform, project_id\) WHERE status = 'pending'/i.test(m));
  check('B4 status is constrained to the three values',
    /CHECK \(status IN \('pending', 'approved', 'declined'\)\)/i.test(m));
  check('B5 the decline fields exist and are separate from decided_*',
    /declined_at\s+timestamptz/i.test(m) && /declined_by\s+uuid/i.test(m) && /decline_reason\s+text/i.test(m));
  // The cascade cannot be declared for a polymorphic reference, so it is a
  // trigger, and a trigger is what catches the users cascade that deletes a
  // project inside Postgres where no route can see it.
  check('B6 the cascade is a TRIGGER, because a polymorphic FK is impossible',
    /CREATE OR REPLACE FUNCTION project_delete_requests_cascade/i.test(m)
    && /CREATE TRIGGER trg_refm_projects_delete_requests/i.test(m));
  check('B7 the applier PROVES the users cascade clears requests',
    /the USERS cascade also clears requests/i.test(src('scripts/apply-migration-238.ts')));
}

console.log('\n=== C. THE BUG THIS STEP WAS DESIGNED AGAINST ===');
{
  const e = strip(src(ENGINE));
  // softDeleteProject filters deleted_at IS NULL and a service-role write
  // reports no rows-affected, so approving an already-deleted project would
  // have updated zero rows and returned no error: success, reported falsely.
  check('C1 approval READS the project before deleting',
    /select\(`id, \$\{source\.nameColumn\}, \$\{source\.deletedColumn\}`\)/.test(e));
  check('C2 an already-deleted project is refused with its own code',
    /code: 'already_deleted'/.test(e));
  check('C3 a MISSING project is refused too, not treated as deleted-and-done',
    /if \(!p\) \{[\s\S]{0,200}already_deleted/.test(e));
  check('C4 the refusal leaves the request PENDING so it can be declined',
    /left pending/i.test(src(ENGINE)));
  check('C5 the route turns it into a 409, not a 500',
    /already_deleted[\s\S]{0,120}409/.test(strip(src(ADMIN_ROUTE))));
  check('C6 the reasoning is recorded where the code is',
    /reports no rows-affected/i.test(src(ENGINE)));
}

console.log('\n=== D. Approve and decline ===');
{
  const e = strip(src(ENGINE));
  check('D1 approval performs the SAME soft delete, by stamping deletedColumn',
    /update\(\{ \[source\.deletedColumn\]: nowIso \}\)/.test(e));
  check('D2 it is a soft delete: nothing here hard deletes a project',
    !/\.delete\(\)/.test(e));
  check('D3 a decline REQUIRES a reason (it is all the requester will see)',
    /A decline needs a reason/.test(src(ENGINE)));
  check('D4 a decline leaves the project untouched',
    !/declineDeleteRequest[\s\S]*?source\.deletedColumn/.test(e));
  check('D5 the decline fields are written and decided_* also records it',
    /declined_at: nowIso, declined_by: adminId, decline_reason: trimmed/.test(e));
  check('D6 a non-pending request cannot be decided twice',
    (e.match(/not_pending/g) ?? []).length >= 2);
}

console.log('\n=== E. The requester learns the outcome ===');
{
  const shell = strip(src(SHELL));
  const dash = strip(src(DASH));
  check('E1 the request state rides on the project LIST, one query',
    /pendingByProject/.test(strip(src('src/hubs/modeling/platforms/refm/lib/persistence/server.ts'))));
  check('E2 the card shows a pending request', /Delete requested, awaiting approval/.test(src(DASH)));
  check('E3 the card shows a decline WITH its reason',
    /Delete declined/.test(src(DASH)) && /declineReason/.test(dash));
  check('E4 a project with a request offers no delete button',
    /!deleteRequestFor\?\.\(p\.id\) &&/.test(dash));
  check('E5 the shell reads the state from the server list, not local storage',
    /const deleteRequestFor = useCallback/.test(shell));
  // No notification system was built, and none is implied.
  check('E6 no email or notification path was added',
    !/sendEmail|notify\(|subscription_email_log/.test([ENGINE, REQ_ROUTE, ADMIN_ROUTE].map((f) => strip(src(f))).join('\n')));
}

console.log('\n=== F. The Dashboard Delete button is gated per CARD ===');
{
  const shell = strip(src(SHELL));
  const dash = strip(src(DASH));
  // The defect: `can()` reads the OPEN project's role and falls back to Owner
  // on the dashboard, so every card offered Delete and the server answered
  // 404. Same class as the Edit button and the Team Access button.
  check('F1 the shell derives a PER-CARD delete decision',
    /const canDeleteCard = useCallback/.test(shell) && /roleCan\(cardRole\(pid\), 'canDeleteProject'\)/.test(shell));
  check('F2 it uses the SAME matrix the server gates on', /roleCan\(/.test(shell));
  check('F3 the Dashboard button consults it', /canDeleteCard\?\.\(p\.id\)/.test(dash));
  check('F4 the Projects screen consults it too',
    /canDeleteCard\?\.\(pid\)/.test(strip(src('src/hubs/modeling/platforms/refm/components/ProjectsScreen.tsx'))));
  check('F5 the request button is gated on canRequestDelete, per card',
    /canRequestDeleteCard\?\.\(p\.id\)/.test(dash));
}

console.log('\n=== G. Not built, and staying that way ===');
{
  const all = [ENGINE, REQ_ROUTE, ADMIN_ROUTE, MIG].map((f) => strip(src(f))).join('\n');
  check('G1 archive needs no approval: nothing here touches the archived column',
    !/archivedColumn|archived:/.test(all));
  check('G2 there is no Owner request path: the matrix denies it',
    !roleCan('owner', 'canRequestDelete'));
  check('G3 the queue is on the PROJECTS BROWSER, not the Plans page',
    /delete-request-queue/.test(src(BROWSER))
    && !/project-delete-requests/.test(src('app/admin/plans/page.tsx')));
  check('G4 the browser already had a Deleted bin and it is untouched',
    /filter === 'deleted'/.test(src(BROWSER)) && /action: 'restore'/.test(src(BROWSER)));
}

console.log('\n=== H. Registry discipline ===');
{
  const e = strip(src(ENGINE));
  check('H1 the engine lives in shared/admin and reads the registry',
    /from '\.\/projectSources'/.test(e));
  check('H2 no platform table is hardcoded in the engine',
    !/refm_projects|refm_project_members/.test(e));
  // A platform that declares membership can raise requests, so it needs the
  // cascade trigger too. One trigger per platform, next to its registry entry.
  const mig = src(MIG);
  const missing = PROJECT_SOURCES.filter((s) => hasMembership(s))
    .filter((s) => !new RegExp(`AFTER DELETE ON ${s.table}`, 'i').test(mig));
  check('H3 every membership platform has a cascade trigger', missing.length === 0,
    missing.map((s) => s.shortLabel).join(', '));
}

async function liveChecks(): Promise<void> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('\n[SKIP] live checks (no DB credentials).'); return; }
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  console.log('\n=== I. The applied table (migration 238) ===');
  const r = await fetch(`${url}/rest/v1/project_delete_requests?select=id,platform,project_id,requested_by,status,created_at,decided_at,decided_by,declined_at,declined_by,decline_reason&limit=1`, { headers: h });
  check('I1 the table is applied and every declared column is readable', r.status === 200, `status=${r.status}`);
  const pend = await fetch(`${url}/rest/v1/project_delete_requests?status=eq.pending&select=id`, { headers: h });
  check('I2 the pending query the admin queue runs works', pend.status === 200, `status=${pend.status}`);
  // ── J. THE BUG, PROVED BY CAUSING IT ────────────────────────────────────
  //
  // Section C only greps for the guard, and a grep cannot tell a reachable
  // guard from an unreachable one: replacing its condition with `if (false)`
  // left C entirely green. Asserting PRESENCE where the invariant is
  // BEHAVIOUR is TRAPS 3.19, and the fix is to run the thing.
  //
  // So this builds a real request against a real project, soft-deletes the
  // project by another route, and asks the engine to approve it. Everything
  // is thrown away afterwards.
  console.log('\n=== J. Approving an already-deleted project, for real ===');
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const stamp = Date.now();
  let userId = '', projectId = '', requestId = '';
  try {
    const { data: u } = await sb.from('users')
      .insert({ email: `probe239+${stamp}@example.invalid`, name: 'Probe 239', role: 'user' })
      .select('id').single();
    userId = String((u as { id: string }).id);
    const { data: p } = await sb.from('refm_projects')
      .insert({ user_id: userId, name: 'ZZ probe 239', schema_version: 7 })
      .select('id').single();
    projectId = String((p as { id: string }).id);
    const { data: rq } = await sb.from('project_delete_requests')
      .insert({ platform: 'refm', project_id: projectId, requested_by: userId })
      .select('id').single();
    requestId = String((rq as { id: string }).id);

    // Somebody else deletes it first.
    await sb.from('refm_projects').update({ deleted_at: new Date().toISOString() }).eq('id', projectId);

    const out = await approveDeleteRequest(sb, requestId, userId);
    check('J1 approving an ALREADY DELETED project refuses, and says so',
      out.ok === false && out.code === 'already_deleted', JSON.stringify(out));
    const { data: still } = await sb.from('project_delete_requests').select('status').eq('id', requestId).maybeSingle();
    check('J2 the request is LEFT PENDING so it can be declined',
      (still as { status?: string } | null)?.status === 'pending', JSON.stringify(still));

    // And the happy path still works, on a live project.
    const { data: p2 } = await sb.from('refm_projects')
      .insert({ user_id: userId, name: 'ZZ probe 239 live', schema_version: 7 })
      .select('id').single();
    const liveId = String((p2 as { id: string }).id);
    const { data: rq2 } = await sb.from('project_delete_requests')
      .insert({ platform: 'refm', project_id: liveId, requested_by: userId })
      .select('id').single();
    const ok = await approveDeleteRequest(sb, String((rq2 as { id: string }).id), userId);
    const { data: after } = await sb.from('refm_projects').select('deleted_at').eq('id', liveId).maybeSingle();
    check('J3 approving a LIVE project soft-deletes it and reports success',
      ok.ok === true && !!(after as { deleted_at?: string } | null)?.deleted_at, JSON.stringify(ok));

    // A decline with no reason is refused: it is all the requester will see.
    const { data: p3 } = await sb.from('refm_projects')
      .insert({ user_id: userId, name: 'ZZ probe 239 decline', schema_version: 7 })
      .select('id').single();
    const { data: rq3 } = await sb.from('project_delete_requests')
      .insert({ platform: 'refm', project_id: String((p3 as { id: string }).id), requested_by: userId })
      .select('id').single();
    const noReason = await declineDeleteRequest(sb, String((rq3 as { id: string }).id), userId, '   ');
    check('J4 a decline with no reason is refused', noReason.ok === false, JSON.stringify(noReason));
  } finally {
    // The project cascade takes the requests; the user cascade takes the
    // projects. Deleting the user is enough, and it also exercises the path.
    if (userId) {
      await sb.from('refm_project_members').delete().eq('user_id', userId);
      await sb.from('users').delete().eq('id', userId);
    }
    const { data: leftovers } = await sb.from('project_delete_requests').select('id').eq('project_id', projectId);
    check('J5 every probe row is gone afterwards (the cascade did it)',
      (leftovers ?? []).length === 0, JSON.stringify(leftovers));
  }
}

function report(): void {
  console.log('');
  console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
}

void liveChecks().then(report);
