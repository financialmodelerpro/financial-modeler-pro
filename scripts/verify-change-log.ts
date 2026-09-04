/**
 * verify-change-log.ts
 *
 * Pins Module 10 Collaboration step 6: the append-only change log.
 *
 * The rules:
 *   A. IT IS ITS OWN TABLE, with the nine columns asked for, and the DATABASE
 *      enforces append-only rather than a convention in application code.
 *   B. THE APPEND-ONLY RULE IS ABOUT CONTENT, NOT THE OPERATION. It has to be:
 *      ON DELETE SET NULL is implemented as an UPDATE, so a blanket ban made a
 *      version undeletable and an account uncloseable. That was a real bug the
 *      applier probe caught, and it is pinned so it cannot come back. An FK may
 *      be released to NULL; it may never be re-pointed.
 *   C. THE EXISTING SURFACES ARE UNTOUCHED. `change_log` still holds the
 *      version-to-version diff, and admin_audit_log is not reused.
 *   D. THE LOG IS APPENDED, NEVER RECOMPUTED, and each save logs ITS OWN delta
 *      rather than the whole session. A cap summarises; it does not truncate
 *      silently.
 *   E. IT SURFACES FOR A USER, and read access is the ONE membership check
 *      with NO role narrowing, so a Viewer sees what an Owner sees. There is
 *      no client write path.
 *   F. NOTHING CHANGES FOR A SINGLE-USER ACCOUNT, including on a pre-234
 *      database, where the platform degrades to "not recorded" and never to
 *      "cannot save".
 *
 * Run: npx tsx scripts/verify-change-log.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { rowsForSave, MAX_CHANGE_ROWS_PER_SAVE } from '../src/hubs/modeling/platforms/refm/lib/persistence/changeLog';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** The body of one named function, so a check cannot be satisfied by a match
 *  somewhere else in the file (TRAPS 3.17). */
function fnBody(text: string, name: string): string {
  const i = text.indexOf(name);
  if (i < 0) return '';
  // Walk PAST the parameter list and PAST the return type before looking for
  // the body brace. Taking the first `{` after the name finds the one inside
  // `Promise<{ ... }>` and matches a block that is not the function, which is
  // the same shape of mistake as a file-wide regex matching the wrong line.
  let j = i, paren = 0, sawParams = false;
  for (; j < text.length; j++) {
    if (text[j] === '(') paren++;
    else if (text[j] === ')') { paren--; if (paren === 0) { sawParams = true; j++; break; } }
  }
  if (!sawParams) return '';
  let angle = 0;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '<') angle++;
    else if (c === '>' && angle > 0) angle--;
    else if (c === '{' && angle === 0) break;
  }
  if (j >= text.length) return '';
  const open = j;
  let depth = 0;
  for (; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) return text.slice(open, j + 1); }
  }
  return '';
}

const MIG    = 'supabase/migrations/234_refm_project_changes.sql';
const APPLY  = 'scripts/apply-migration-234.ts';
const LIB    = 'src/hubs/modeling/platforms/refm/lib/persistence/changeLog.ts';
const ROUTE  = 'app/api/refm/projects/[id]/changes/route.ts';
const VPATCH = 'app/api/refm/projects/[id]/versions/[versionId]/route.ts';
const VPOST  = 'app/api/refm/projects/[id]/versions/route.ts';
const MODAL  = 'src/hubs/modeling/platforms/refm/components/modals/VersionModal.tsx';
// RE-AIMED 2026-09-04: the ActivityPanel moved out of the modal into the
// shared collab components when Module 10 got its screen. ONE implementation,
// TWO doors: the modal tab and the Collaborate screen both render it.
const PANELS = 'src/hubs/modeling/platforms/refm/components/collab/CollabPanels.tsx';
const SCREEN = 'src/hubs/modeling/platforms/refm/components/modules/Module10Collaborate.tsx';
const CLIENT = 'src/hubs/modeling/platforms/refm/lib/persistence/client.ts';

console.log('=== A. Its own table, its own columns, enforced by the database ===');
{
  const mig = src(MIG);
  check('A1 the table exists', /CREATE TABLE IF NOT EXISTS refm_project_changes/i.test(mig));
  check('A2 every asked-for column is present',
    ['project_id', 'version_id', 'user_id', 'action', 'path', 'before', 'after', 'created_at']
      .every((c) => new RegExp(`^\\s*${c}\\s`, 'm').test(mig)));
  check('A3 deleting the project takes its history with it',
    /project_id[\s\S]{0,90}REFERENCES refm_projects\(id\)[\s\S]{0,20}ON DELETE CASCADE/i.test(mig));
  check('A4 version_id and user_id SET NULL, so the fact outlives what it points at',
    /version_id[\s\S]{0,90}ON DELETE SET NULL/i.test(mig) && /user_id[\s\S]{0,90}ON DELETE SET NULL/i.test(mig));
  check('A5 created_at uses clock_timestamp, not the frozen transaction now()',
    /created_at[\s\S]{0,60}DEFAULT clock_timestamp\(\)/i.test(mig) && !/created_at[\s\S]{0,60}DEFAULT now\(\)/i.test(mig));
  check('A6 a trigger, not a convention, enforces the rule',
    /CREATE TRIGGER trg_refm_changes_no_update[\s\S]{0,120}BEFORE UPDATE ON refm_project_changes/i.test(mig));
  check('A7 the project read is indexed newest-first',
    /idx_refm_changes_project[\s\S]{0,120}created_at DESC/i.test(mig));
}

console.log('\n=== B. Append-only guards CONTENT, and an FK may only be released ===');
{
  const mig = src(MIG);
  const guard = mig.slice(mig.indexOf('refm_project_changes_no_update()'));
  check('B1 every meaning-carrying column is immutable',
    ['action', 'path', 'before', 'after', 'created_at', 'project_id']
      .every((c) => new RegExp(`NEW\\.${c}\\s+IS DISTINCT FROM OLD\\.${c}`).test(guard)));
  check('B2 an FK may be RELEASED to NULL (this is what ON DELETE SET NULL does)',
    /NEW\.version_id IS DISTINCT FROM OLD\.version_id AND NEW\.version_id IS NOT NULL/.test(guard)
    && /NEW\.user_id\s+IS DISTINCT FROM OLD\.user_id\s+AND NEW\.user_id\s+IS NOT NULL/.test(guard));
  check('B3 it RAISES rather than silently returning OLD', /RAISE EXCEPTION/.test(guard));
  // SABOTAGE: an unconditional RAISE (the first, wrong version) must fail B2.
  check('B3s sabotage: an unconditional RAISE would fail B2',
    !/NEW\.user_id\s+IS DISTINCT FROM OLD\.user_id\s+AND NEW\.user_id\s+IS NOT NULL/
      .test('BEGIN RAISE EXCEPTION \'append only\'; END;'));
  check('B4 DELETE is deliberately NOT blocked, because the cascade needs it',
    !/BEFORE\s+DELETE\s+ON\s+refm_project_changes/i.test(mig));
  const ap = src(APPLY);
  check('B5 the applier PROVES a content rewrite is refused',
    /UPDATE public\.refm_project_changes SET after/.test(ap) && /APPEND-ONLY guard fired/.test(ap));
  check('B6 the applier PROVES re-attribution is refused',
    /SET user_id = \$1 WHERE id = \$2/.test(ap) && /RE-ATTRIBUTION/.test(ap));
  check('B7 the applier PROVES a deleted version and a deleted author leave the row standing',
    /version_id nulled/.test(ap) && /user_id nulled/.test(ap));
  check('B8 the migration RECORDS why the first attempt was wrong, so it is not repeated',
    /implemented AS AN UPDATE/i.test(mig) && /applier probe caught it/i.test(mig));
}

console.log('\n=== C. The existing surfaces are untouched ===');
{
  const patch = src(VPATCH);
  check('C1 the version row still recomputes change_log against its base',
    /patch\.change_log = baseVersion \? diffSnapshots\(baseVersion\.snapshot/.test(patch));
  check('C2 admin_audit_log is NOT reused for model changes',
    !/admin_audit_log/.test(src(LIB)) && !/admin_audit_log/.test(src(ROUTE)));
  check('C3 the migration states why change_log cannot serve as the audit trail',
    /NO AUTHOR/.test(src(MIG)) && /NO TIMESTAMP/.test(src(MIG)) && /RECOMPUTED, NOT APPENDED/.test(src(MIG)));
  check('C4 and why admin_audit_log is not it either',
    /admin_id` is NOT NULL/.test(src(MIG)) || /admin_id. is NOT NULL/.test(src(MIG)));
}

console.log('\n=== D. Appended, never recomputed; each save logs its own delta ===');
{
  const patch = strip(src(VPATCH));
  // THE distinguishing check: the delta logged is against the STORED snapshot,
  // not against the base version. Diffing the base would re-log the whole
  // session on every autosave beat.
  //
  // Pinned STRUCTURALLY, not by one grep. The first version of this check only
  // asserted that the right assignment was PRESENT, and a sabotage run that
  // added a SECOND assignment (overwriting the delta with the base diff) sailed
  // straight through it. Counting the assignments is what makes it real: there
  // must be exactly one, and it must be the stored-snapshot diff.
  const assigns = [...patch.matchAll(/(?<![\w.])saveDelta\s*=(?!=)/g)];
  check('D1 saveDelta is assigned EXACTLY ONCE, so nothing can overwrite it',
    assigns.length === 1, `found ${assigns.length} assignments`);
  check('D2 and that one assignment is the STORED-snapshot diff, not the base diff',
    /saveDelta = diffSnapshots\(existing\.snapshot, body\.snapshot\)/.test(patch)
    && !/saveDelta[\s\S]{0,40}change_log/.test(patch));
  check('D3 the append happens AFTER the write succeeds',
    patch.indexOf('await appendChanges') > patch.indexOf('if (!updatedVersion) return notFound();'));
  check('D4 a new version is logged as a lifecycle event',
    /action: 'version\.created'/.test(src(VPOST)));

  // The cap is behaviour, so it is tested by RUNNING it, not by grepping it.
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
    path: `assets[id=a].f${i}`, before: i, after: i + 1, kind: 'update' as const,
  }));
  const under = rowsForSave('p', 'v', 'u', mk(3));
  check('D5 a small save writes one row per changed path', under.length === 3, `got ${under.length}`);
  check('D6 and carries the real before/after',
    under[0].before === 0 && under[0].after === 1 && under[0].path === 'assets[id=a].f0');
  const over = rowsForSave('p', 'v', 'u', mk(MAX_CHANGE_ROWS_PER_SAVE + 5));
  check('D7 past the cap it SUMMARISES into one row', over.length === 1, `got ${over.length}`);
  check('D8 and the summary STATES the true count, so nothing is hidden',
    (over[0].after as { changedPaths?: number }).changedPaths === MAX_CHANGE_ROWS_PER_SAVE + 5);
  check('D9 the summary is a distinct action, not a fake field edit',
    over[0].action === 'bulk-change' && over[0].path === null);
  check('D10 an empty delta writes nothing at all', rowsForSave('p', 'v', 'u', []).length === 0);
  check('D11 the kind is carried through, so add and remove are not flattened to update',
    rowsForSave('p', 'v', 'u', [{ path: 'x', before: null, after: 1, kind: 'add' }])[0].action === 'add');
}

console.log('\n=== E. It surfaces, read access is membership with no role narrowing ===');
{
  const route = src(ROUTE);
  const routeCode = strip(route);
  check('E1 there is a GET route', /export async function GET/.test(routeCode));
  check('E2 access is the ONE membership check', /await getProject\(userId, id\)/.test(routeCode));
  // SABOTAGE-SCOPED: roleCan must be absent from the CODE, not merely from the
  // whole file, since the header discusses roles at length.
  check('E3 NO role narrowing on the read: a Viewer sees what an Owner sees',
    !/roleCan|role\s*===\s*'/.test(routeCode));
  check('E4 there is NO client write path into the log',
    !/export async function (POST|PATCH|PUT|DELETE)/.test(routeCode));
  check('E5 the read is BOUNDED, so PostgREST cannot silently truncate it',
    /\.limit\(/.test(fnBody(src(LIB), 'listProjectChanges')));
  check('E6 a bad limit falls back to the default, not to zero rows',
    /Number\.isFinite\(asked\) && asked > 0/.test(routeCode));
  check('E7 the client has a read helper and no write helper',
    /export function listChanges/.test(src(CLIENT))
    && !/refm\/projects\/\$\{[^}]+\}\/changes`, \{ method: 'POST'/.test(src(CLIENT)));

  const modal = src(MODAL);
  const panels = src(PANELS);
  check('E8 ONE panel, TWO doors: the version-manager tab and the Collaborate screen',
    /'save', 'history', 'activity'/.test(modal) && /<ActivityPanel/.test(modal)
    && /export function ActivityPanel/.test(panels) && /<ActivityPanel/.test(src(SCREEN)));
  check('E9 it renders the author and the time, which is the whole point',
    /change\.userName/.test(panels) && /toLocaleTimeString/.test(panels));
  check('E10 an unresolvable author reads as unknown, never as someone else',
    /change\.userName \?\? 'Unknown user'/.test(panels));
  check('E11 an unrecognised action renders as itself rather than being swallowed',
    /default:\s*return \{ label: action,/.test(panels));
  check('E12 the route STATES that an admin sees no more than a member',
    /ADMIN SEES NO MORE THAN A MEMBER/i.test(route));
}

console.log('\n=== F. Nothing changes for a single-user account ===');
{
  const lib = src(LIB);
  check('F1 a failed append NEVER fails the save', /never throws, and never fails the caller/i.test(lib));
  const body = fnBody(lib, 'export async function appendChanges');
  check('F2 and that is real: the whole append is inside try/catch',
    /try \{/.test(body) && /\} catch \(e\) \{/.test(body));
  check('F3 a failure is not silent to the OPERATOR', /console\.error\('\[changeLog\]/.test(body));
  check('F4 a pre-234 database degrades to not-logging, not to not-saving',
    /changesApplied = false/.test(body));
  check('F5 the UI distinguishes "not recorded" from "nothing happened"',
    /activity-unavailable/.test(src(PANELS)) && /activity-empty/.test(src(PANELS)));
  check('F6 the API says which of the two it is',
    /available: !tableMissing/.test(src(ROUTE)));
  // The single-user consequence, stated as behaviour: one person's own edits
  // are logged against them, and nothing about the save path is conditional on
  // there being more than one member.
  check('F7 nothing in the append path branches on membership or role',
    !/roleCan|isAdmin|membership/i.test(strip(lib)));
  check('F8 the append is keyed on the SESSION user, not the project owner',
    /rowsForSave\(projectId, versionId, userId, saveDelta\)/.test(src(VPATCH)));
}

console.log('\n=== G. House rules ===');
{
  for (const f of [MIG, APPLY, LIB, ROUTE, MODAL, CLIENT, PANELS, SCREEN]) {
    check(`G ${f} has no em dashes`, !src(f).includes('—'));
  }
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
if (failed) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
