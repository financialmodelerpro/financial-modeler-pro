/**
 * verify-comments.ts
 *
 * Module 10 Collaboration, step 7: COMMENTS.
 *
 * Pins the rules that a later change could quietly break, and reads the LIVE
 * schema for the ones only the database can answer.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: that a comment renders. This checks the
 * contract (who may write, what the server sends, what the database refuses),
 * not the markup, because a check that greps for JSX passes on a surface that
 * is never mounted (TRAPS, "render condition not markup").
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-comments.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { roleCan, PROJECT_ROLES } from '../src/core/collab/projectRoles';
import { requiresLock } from '../src/hubs/modeling/platforms/refm/lib/persistence/server';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const src = (f: string): string => readFileSync(f, 'utf8');
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = 'supabase/migrations/236_refm_project_comments.sql';
const HELPER = 'src/hubs/modeling/platforms/refm/lib/persistence/comments.ts';
const ROUTE = 'app/api/refm/projects/[id]/comments/route.ts';
const ONE = 'app/api/refm/projects/[id]/comments/[commentId]/route.ts';
const MODAL = 'src/hubs/modeling/platforms/refm/components/modals/VersionModal.tsx';
// RE-AIMED 2026-09-04: the CommentsPanel and the keyed-state fetch discipline
// moved to the shared collab components when Module 10 got its screen. ONE
// implementation, TWO doors: the modal tab and the Collaborate screen.
const PANELS = 'src/hubs/modeling/platforms/refm/components/collab/CollabPanels.tsx';
const HOOKS = 'src/hubs/modeling/platforms/refm/components/collab/useCollabData.ts';
const SCREEN = 'src/hubs/modeling/platforms/refm/components/modules/Module10Collaborate.tsx';

console.log('=== A. The migration ===');
{
  const m = src(MIG);
  check('A1 the table is created', /CREATE TABLE IF NOT EXISTS refm_project_comments/i.test(m));
  check('A2 the project FK cascades', /project_id[\s\S]{0,80}REFERENCES refm_projects\(id\)\s+ON DELETE CASCADE/i.test(m));
  check('A3 version_id is ON DELETE SET NULL, like refm_project_changes',
    /version_id[\s\S]{0,90}REFERENCES refm_project_versions\(id\)\s+ON DELETE SET NULL/i.test(m));
  check('A4 the author FK is SET NULL, so a comment outlives its author',
    /user_id[\s\S]{0,80}REFERENCES users\(id\)\s+ON DELETE SET NULL/i.test(m));
  check('A5 parent_id self-references for replies', /parent_id[\s\S]{0,80}REFERENCES refm_project_comments\(id\)/i.test(m));
  check('A6 version and path are OPTIONAL (a project-wide comment is valid)',
    !/version_id\s+uuid\s+NOT NULL/i.test(m) && !/path\s+text\s+NOT NULL/i.test(m));
  check('A7 an empty body is refused by a CHECK', /body[\s\S]{0,60}CHECK \(length\(btrim\(body\)\) > 0\)/i.test(m));
  check('A8 soft delete and resolve state are columns, not booleans',
    /deleted_at\s+timestamptz/i.test(m) && /resolved_at\s+timestamptz/i.test(m) && /resolved_by\s+uuid/i.test(m));
  check('A9 ONE LEVEL is enforced by a trigger, not by application code',
    /CREATE OR REPLACE FUNCTION refm_comments_one_level/i.test(m)
    && /replies are ONE level/i.test(m)
    && /CREATE TRIGGER trg_refm_comments_one_level/i.test(m));
  check('A10 the applier PROVES the refusal rather than asserting it',
    /a reply to a REPLY is refused/i.test(src('scripts/apply-migration-236.ts')));
}

console.log('\n=== B. The matrix decides who writes, and it already did ===');
{
  check('B1 Owner, Editor and Reviewer may comment; Viewer may not',
    roleCan('owner', 'canAddComments') && roleCan('editor', 'canAddComments')
    && roleCan('reviewer', 'canAddComments') && !roleCan('viewer', 'canAddComments'));
  check('B2 an unknown role may not comment', !roleCan('superuser', 'canAddComments') && !roleCan(null, 'canAddComments'));
  check('B3 every role can VIEW reports, so the read is not narrowed by role',
    PROJECT_ROLES.every((r) => roleCan(r, 'canViewReports')));
  // The permission existed since step 0 and was enforced by nothing. This is
  // the step that connects it, so the connection is what gets pinned.
  const route = strip(src(ROUTE));
  const one = strip(src(ONE));
  check('B4 the POST gates on canAddComments through the WRITE resolver',
    /getProjectForWrite\(userId, id, 'canAddComments'\)/.test(route));
  check('B5 PATCH and DELETE gate the same way',
    (one.match(/getProjectForWrite\(userId, id, 'canAddComments'\)/g) ?? []).length === 2);
  check('B6 the GET does NOT narrow by role: every member reads the same thread',
    /getProject\(userId, id\)/.test(route) && !/canAddComments/.test(route.split('export async function POST')[0]));
}

console.log('\n=== C. The edit lock is NOT involved ===');
{
  // Commenting is not a model edit. If canAddComments ever joins LOCK_REQUIRED
  // a reviewer could not comment while the editor had the project open, which
  // is precisely when a review happens.
  check('C1 canAddComments does not require the edit lock', !requiresLock('canAddComments'));
  check('C2 the model-editing permissions still do',
    requiresLock('canSave') && requiresLock('canEditInputs') && requiresLock('canManageVersions'));
  check('C3 the reason is written down where the set is declared',
    /canAddComments` is absent too/.test(src('src/hubs/modeling/platforms/refm/lib/persistence/server.ts')));
}

console.log('\n=== D. What the server refuses to send or accept ===');
{
  const h = src(HELPER);
  check('D1 a deleted comment body is stripped BEFORE it is serialised',
    /body: deleted \? null : String\(r\.body \?\? ''\)/.test(h));
  check('D2 edit matches the author IN THE STATEMENT, not in an if',
    /update\(\{ body[\s\S]{0,220}\.eq\('user_id', userId\)/.test(h));
  check('D3 delete is SOFT and also author-matched',
    /update\(\{ deleted_at[\s\S]{0,220}\.eq\('user_id', userId\)/.test(h));
  check('D4 nothing here hard deletes a comment', !/\.delete\(\)/.test(h));
  check('D5 resolve targets ROOTS only', /\.is\('parent_id', null\)/.test(h));
  check('D6 resolve is NOT author-gated (a reviewer raises, an editor closes)',
    !/setCommentResolved[\s\S]*?\.eq\('user_id', userId\)[\s\S]*?\n\}/.test(h));
  check('D7 a reply stores no anchor of its own',
    /version_id: isReply \? null/.test(h) && /path: isReply \? null/.test(h));
  check('D8 the read is BOUNDED (PostgREST truncates silently)', /\.limit\(Math\.max\(1, Math\.min\(limit, 1000\)\)\)/.test(h));
  check('D9 the read is NOT filtered by version, so a comment survives a newer save',
    !/\.eq\('version_id'/.test(h));
  check('D10 a pre-236 database reports UNAVAILABLE, not an empty conversation',
    /available: !tableMissing/.test(src(ROUTE)));
  check('D11 the one-level refusal becomes a 409 naming the rule, not a 500',
    /isOneLevelViolation/.test(src(ROUTE)) && /status: 409/.test(src(ROUTE)));
}

console.log('\n=== E. The surface ===');
{
  const m = src(MODAL);
  const p = src(PANELS);
  const h = src(HOOKS);
  check('E1 Comments is a tab beside Activity, and the SAME panel renders on the Module 10 screen',
    /\['save', 'history', 'activity', 'comments'\] as const/.test(m)
    && /<CommentsPanel/.test(m) && /<CommentsPanel/.test(src(SCREEN))
    && /export function CommentsPanel/.test(p));
  check('E2 the modal lazy-loads on tab open; the hook guards on active',
    /useProjectComments\(projectId, open && tab === 'comments'\)/.test(m)
    && /if \(!active \|\| !projectId\) return;/.test(h));
  check('E3 state is ONE object keyed by project, so a late response is discarded',
    /key: string; rows: ProjectCommentDTO\[\]/.test(h)
    && /state !== null && state\.key === projectId/.test(h));
  check('E4 loading is DERIVED, never a second flag',
    !/setCommentsLoading/.test(m) && !/setLoading/.test(h));
  check('E5 the composer is gated on canComment, which the platform passes',
    /canComment/.test(p) && /canComment=\{can\('canAddComments'\)\}/.test(src('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx')));
  check('E6 a read-only viewer is TOLD why, not just shown nothing',
    /comments-read-only/.test(p));
  check('E7 a comment shows the version it was written against',
    /on \{versionLabel\.get\(comment\.versionId\)/.test(p));
  check('E8 a deleted root with live replies leaves a tombstone',
    /tombstone/.test(p) && /root\.deleted && liveReplies\.length === 0/.test(p));
  check('E9 a path renders as TEXT: no jump-to-field was built',
    /monospace/.test(p) && !/onClick=\{\(\) => [^}]*path/.test(p));
  check('E10 writes re-read from the server rather than patching locally',
    /refresh: \(\) => load\(\)/.test(h) && /onChanged=\{commentsData\.refresh\}/.test(m));
}

console.log('\n=== F. Not built, and staying that way ===');
{
  // STRIPPED of comments, and that is the whole point. The first version read
  // the raw files and F2 failed on comments.ts's own header sentence, "no
  // unread count": the check matched the PROSE DESCRIBING THE ABSENCE it was
  // testing for. Same shape as TRAPS 3.17, evidence taken from the wrong
  // place. An assertion about what the code DOES must read only code.
  const all = [HELPER, ROUTE, ONE, MODAL, PANELS, HOOKS, SCREEN].map((f) => strip(src(f))).join('\n');
  check('F1 no notification or email path was added',
    !/sendEmail|sendTemplatedEmail|subscription_email_log|notify\(/.test(all));
  check('F2 no unread counter', !/unread/i.test(all));
  check('F3 no approval workflow', !/approv/i.test(all));
}


console.log('\n=== H. House rules ===');
{
  for (const f of [MIG, 'scripts/apply-migration-236.ts', HELPER, ROUTE, ONE]) {
    check(`H ${f} has no em dashes`, !src(f).includes('\u2014'));
  }
}

async function liveChecks(): Promise<void> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('\n[SKIP] live schema check (no DB credentials).'); return; }
  console.log('\n=== G. The applied table (migration 236) ===');
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const res = await fetch(`${url}/rest/v1/refm_project_comments?select=id,project_id,version_id,parent_id,user_id,path,body,created_at,updated_at,deleted_at,resolved_at,resolved_by&limit=1`, { headers: h });
  check('G1 the table is applied and every declared column is readable', res.status === 200, `status=${res.status}`);
  // A row a client could never legitimately write: proves the read path, not
  // the write path, so nothing is inserted here.
  const bad = await fetch(`${url}/rest/v1/refm_project_comments?select=id&order=created_at.desc&limit=1`, { headers: h });
  check('G2 the table answers an ordered read', bad.status === 200, `status=${bad.status}`);
}

function report(): void {
  console.log('');
  console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
}

void liveChecks().then(report);
