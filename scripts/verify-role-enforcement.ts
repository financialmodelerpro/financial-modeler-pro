/**
 * verify-role-enforcement.ts
 *
 * Pins Module 10 Collaboration step 4: the role is ENFORCED, server-side.
 *
 * The rules:
 *   A. Every gated call site names the PERMISSION it needs. A blanket gate lets
 *      a delete through as an edit.
 *   B. TWO GATES, KEPT SEPARATE: the permanent matrix, and the temporary
 *      owner-only narrowing that comes out in step 5. Merging them would make
 *      it impossible to see which restriction is which.
 *   C. Viewer and Reviewer genuinely cannot write, by the matrix, not by the
 *      narrowing. Proven by exercising roleCan directly.
 *   D. EXPORT IS A READ. It renders a file and writes nothing, so it gates on
 *      the matrix alone and a Reviewer may do it.
 *   E. can() reads the RESOLVED role through the SAME matrix the server uses.
 *   F. The editor / Returns omission is fixed.
 *   G. Nothing changes for a single-user account: an owner holds everything.
 *
 * Run: npx tsx scripts/verify-role-enforcement.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { roleCan, PROJECT_ROLE_PERMISSIONS, type Permission } from '../src/core/collab/projectRoles';
import { roleMayWrite } from '../src/hubs/modeling/platforms/refm/lib/persistence/server';
import { REFM_MODULE_VISIBILITY } from '../src/hubs/modeling/platforms/refm/lib/moduleVisibility';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRV = 'src/hubs/modeling/platforms/refm/lib/persistence/server.ts';
const PLATFORM = 'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx';
const ROUTES = 'app/api/refm/projects';

function routeFiles(dir = ROUTES, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name).split('\\').join('/');
    if (e.isDirectory()) routeFiles(p, out);
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

console.log('=== A. Every gated call site names its permission ===');
{
  const bare: string[] = [];
  const named: string[] = [];
  for (const f of routeFiles()) {
    const text = strip(src(f));
    // A gated call with only two arguments is a blanket gate.
    for (const m of text.matchAll(/getProjectFor(?:Write|Action)\(([^)]*)\)/g)) {
      const args = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      if (args.length < 3) bare.push(`${f.replace(ROUTES + '/', '')}: ${m[0]}`);
      else named.push(`${f.replace(ROUTES + '/', '')}: ${args[2]}`);
    }
    // The shared local helper must take the permission too, not hardcode one.
    if (/async function requireWritableProject\(/.test(text)) {
      const sig = /async function requireWritableProject\(([^)]*)\)/.exec(text)?.[1] ?? '';
      if (!/need/.test(sig)) bare.push(`${f.replace(ROUTES + '/', '')}: requireWritableProject has no need parameter`);
    }
    for (const m of text.matchAll(/requireWritableProject\(([^)]*)\)/g)) {
      const args = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      if (args.length === 1 && !/id: string/.test(m[1])) {
        bare.push(`${f.replace(ROUTES + '/', '')}: ${m[0]}`);
      }
    }
  }
  check('A1 no gated call site uses a blanket gate', bare.length === 0, bare.join(' ; '));
  check('A2 a meaningful number of sites declare a permission', named.length >= 13,
    `${named.length} declared`);
  // The permission must be a REAL one, not a typo that would silently deny.
  const known = new Set(Object.keys(PROJECT_ROLE_PERMISSIONS.owner));
  const unknown = named.filter((n) => {
    const p = n.split(': ')[1]?.replace(/['"]/g, '');
    return p && !p.startsWith('need') && !known.has(p);
  });
  check('A3 every declared permission exists in the matrix', unknown.length === 0, unknown.join(' ; '));
  // Delete must not be gated as an edit.
  const projRoute = strip(src(`${ROUTES}/[id]/route.ts`));
  const del = projRoute.split('export async function DELETE')[1] ?? '';
  check('A4 DELETE needs canDeleteProject, not canEditProject',
    /canDeleteProject/.test(del) && !/canEditProject/.test(del));
}

console.log('\n=== B. Two gates, kept separate ===');
{
  const srv = strip(src(SRV));
  const write = (srv.split('export async function getProjectForWrite')[1] ?? '').split(/\nexport /)[0];
  check('B1 the write gate consults the MATRIX', /roleCan\(role, need\)/.test(write));
  // GATE 2 CHANGED IDENTITY IN STEP 5, exactly as the design intended: the
  // temporary owner-only narrowing came out and the EDIT LOCK took its
  // place. Keeping the two gates separate is what made that a local swap,
  // and these checks follow gate 2 to its new occupant rather than pinning
  // the one that was always going to be removed.
  check('B2 the write gate ALSO applies gate 2, now the edit lock',
    /requiresLock\(need\)/.test(write) && /holdsLock\(/.test(write));
  check('B3 both must pass: a role refusal and a lock refusal each deny',
    /if \(!permitted\)/.test(write) && /if \(!held\)/.test(write));
  // They must remain distinguishable, so step 5 can remove one without
  // touching the other.
  check('B4 the narrowing is a NAMED, separate function',
    /export function roleMayWrite/.test(src(SRV)));
  check('B5 the reason the two are separate is written down',
    /TWO GATES, AND THEY MEAN DIFFERENT THINGS/i.test(src(SRV))
    && /step 5/i.test(src(SRV)));
}

console.log('\n=== C. Viewer and Reviewer genuinely cannot write ===');
{
  // By the MATRIX, independent of the temporary narrowing. These must still
  // hold after step 5 removes roleMayWrite.
  const MUTATIONS: Permission[] = ['canSave', 'canEditInputs', 'canEditProject', 'canDeleteProject', 'canManageVersions'];
  const viewerDenied = MUTATIONS.every((p) => !roleCan('viewer', p));
  const reviewerDenied = MUTATIONS.every((p) => !roleCan('reviewer', p));
  check('C1 a Viewer is denied every mutation by the matrix', viewerDenied);
  check('C2 a Reviewer is denied every mutation by the matrix', reviewerDenied);
  check('C3 an Editor IS granted the editing mutations by the matrix',
    roleCan('editor', 'canSave') && roleCan('editor', 'canEditInputs')
    && roleCan('editor', 'canManageVersions'));
  // WAS "an Editor is still held back by the temporary narrowing". Step 5
  // removed it, which is the whole point of that step, so the assertion
  // flips: the matrix always allowed an Editor to save, and now nothing
  // else stands in the way except holding the lock.
  check('C4 an Editor is no longer held back by a role narrowing',
    roleMayWrite('editor') === true && roleCan('editor', 'canSave'));
  check('C5 an Editor cannot delete, by the matrix, permanently',
    !roleCan('editor', 'canDeleteProject'));
  check('C6 a Reviewer may comment, a Viewer may not',
    roleCan('reviewer', 'canAddComments') && !roleCan('viewer', 'canAddComments'));
}

console.log('\n=== D. Export is a read ===');
{
  const srv = strip(src(SRV));
  const act = (srv.split('export async function getProjectForAction')[1] ?? '').split(/\nexport /)[0];
  check('D1 the read gate exists and consults the matrix',
    act.length > 0 && /roleCan\(r\.role, need\)/.test(act));
  check('D2 the read gate does NOT apply the owner-only narrowing',
    !/mayWrite/.test(act) && !/roleMayWrite/.test(act));
  for (const f of ['report-deck/export', 'report-pptx']) {
    const text = strip(src(`${ROUTES}/[id]/${f}/route.ts`));
    check(`D3 ${f} gates as an ACTION on canExport`,
      /getProjectForAction\([^)]*canExport/.test(text));
  }
  check('D4 a Reviewer may export, a Viewer may not',
    roleCan('reviewer', 'canExport') && !roleCan('viewer', 'canExport'));
}

console.log('\n=== E. can() reads the resolved role, through the shared matrix ===');
{
  const p = src(PLATFORM);
  check('E1 the role is no longer pinned', !/useState<Role>\(ROLES\.OWNER\)/.test(p));
  // Two halves, and the second is the one that matters. Testing only that the
  // RESOLVER EXISTS passed a sabotage that left the resolver in place and
  // ignored it (`const currentUserRole = ROLES.OWNER; void activeProjectRole;`),
  // which is a pinned role with a decorative memo above it. The value can()
  // actually reads has to trace back to the resolver.
  check('E2 the role is resolved from the OPEN project\'s row',
    /serverProjects\.find\(\(x\) => x\.id === activeProjectId\)/.test(p));
  check('E2b and can() READS that resolution, not a constant',
    /const currentUserRole = activeProjectRole;/.test(p)
    && !/const currentUserRole = ROLES\./.test(p)
    && !/const currentUserRole = ['"]/.test(p));
  check('E3 can() calls the SHARED matrix, not a local table',
    /roleCan\(currentUserRole, permission\)/.test(p));
  check('E4 the local PERMISSIONS table is no longer imported here',
    !/^\s*PERMISSIONS,$/m.test(strip(p)));
  check('E5 the UI is documented as a courtesy, not the boundary',
    /COURTESY, not the boundary/i.test(p));
  // The role must reach the client at all.
  check('E6 the server decorates the row with the caller\'s role',
    /role: mine\.role/.test(strip(src(SRV))));
  check('E7 an unrecognised stored role reads as null',
    /isProjectRole\(r\.role\) \? r\.role : null/.test(strip(src(SRV))));
}

console.log('\n=== F. The editor / Returns omission is fixed ===');
{
  check('F1 an editor can see module5 (Returns)',
    REFM_MODULE_VISIBILITY.editor.includes('module5'));
  check('F2 an editor can see every module an owner can',
    REFM_MODULE_VISIBILITY.owner.every((m) => REFM_MODULE_VISIBILITY.editor.includes(m)));
  check('F3 the history is recorded, so it cannot be "corrected" back',
    /OMISSION/i.test(src('src/hubs/modeling/platforms/refm/lib/moduleVisibility.ts')));
  // REWRITTEN 2026-09-03 (step 7). This asserted that visibility narrows
  // monotonically down the role order, which stopped being true the moment
  // the reviewer was given every module. THE OLD CHECK WAS MEASURING THE
  // WRONG THING: it read a length as evidence that a role was restricted,
  // when what restricts a reviewer is the permission matrix. A reviewer with
  // full visibility and no write permission is MORE restricted in the way
  // that counts than one with four screens and an unenforced matrix would be.
  check('F4 a reviewer sees every module an editor sees',
    REFM_MODULE_VISIBILITY.editor.every((m) => REFM_MODULE_VISIBILITY.reviewer.includes(m)));
  check('F4b what makes a reviewer read-only is the MATRIX, not the map',
    !roleCan('reviewer', 'canEditInputs') && !roleCan('reviewer', 'canSave')
    && !roleCan('reviewer', 'canManageVersions') && !roleCan('reviewer', 'canDeleteProject'));
  check('F4c the viewer is unchanged and still narrower than the reviewer',
    REFM_MODULE_VISIBILITY.viewer.length < REFM_MODULE_VISIBILITY.reviewer.length
    && !REFM_MODULE_VISIBILITY.viewer.includes('module1'));
}

console.log('\n=== G. Nothing changes for a single-user account ===');
{
  // A lone user is the OWNER of their projects, and an owner holds every
  // permission in the matrix, so every gate that now consults it lets them
  // through exactly as the blanket gate did.
  const all = Object.keys(PROJECT_ROLE_PERMISSIONS.owner) as Permission[];
  // RE-AIMED 2026-09-03 (step 9). This asserted `all.every(p => roleCan('owner', p))`,
  // and step 9 added `canRequestDelete`, which is FALSE for an owner on
  // purpose: it is the EDITOR'S ALTERNATIVE to a stronger permission the owner
  // already holds. Read literally, the old check said a new capability for a
  // lesser role must also be granted to the owner, which would have forced a
  // pointless second delete path onto the person who can already delete.
  //
  // The invariant it actually protects is NARROWER and is preserved here: an
  // owner is never BLOCKED from anything. So the owner may lack a permission
  // only when it is an alternative route to something they already have, and
  // that pairing is asserted rather than assumed.
  const ALTERNATIVES: Partial<Record<Permission, Permission>> = {
    // asking an admin to delete <- the owner simply deletes
    canRequestDelete: 'canDeleteProject',
  };
  const missing = all.filter((p) => !roleCan('owner', p));
  check('G1 an owner is blocked from nothing: every permission they lack is an alternative to one they hold',
    missing.every((p) => {
      const stronger = ALTERNATIVES[p];
      return !!stronger && roleCan('owner', stronger);
    }),
    missing.length ? `owner lacks: ${missing.join(', ')}` : '');
  check('G1b the only permission an owner lacks is the request path, and they hold the direct one',
    missing.length === 1 && missing[0] === 'canRequestDelete' && roleCan('owner', 'canDeleteProject'),
    missing.join(', '));
  check('G2 an owner passes the temporary narrowing too', roleMayWrite('owner'));
  check('G3 an owner sees every REFM module',
    REFM_MODULE_VISIBILITY.owner.length >= 10);
  // The pre-231 fallback (no membership table) must also still allow.
  const srv = strip(src(SRV));
  check('G4 a null role (pre-231 owner) is allowed, not denied',
    /role === null \? true : roleCan\(role, need\)/.test(srv));
  check('G5 with no project open, can() falls back to owner',
    /if \(!activeProjectId\) return ROLES\.OWNER/.test(src(PLATFORM)));
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
