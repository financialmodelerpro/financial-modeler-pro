/**
 * verify-project-membership.ts
 *
 * Pins Module 10 Collaboration step 2: membership replaces ownership as the
 * access check, and NON-OWNERS ARE READ-ONLY until the edit lock ships.
 *
 * The rules:
 *   A. The migration seeds one Owner per project and guards against ownerless.
 *   B. EVERY WRITE HANDLER gates on getProjectForWrite. This is the check that
 *      makes the gate unforgettable, and it is the most important one here: a
 *      route that gates on plain getProject lets a Viewer save.
 *   C. Reads still use getProject, so a member can READ what they are a member
 *      of. Narrowing both would have made membership pointless.
 *   D. Owner-only writes, and denial is the default everywhere: an unknown
 *      role, a failed lookup and a missing membership all deny.
 *   E. Schema tolerance: a pre-231 database falls back to the OWNER check, not
 *      to an open one.
 *   F. Registry driven, all-or-nothing, so ERM and BVM inherit it.
 *   G. NOTHING CHANGES FOR A SINGLE-USER ACCOUNT.
 *
 * Run: npx tsx scripts/verify-project-membership.ts
 *
 * No em dashes in this file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { roleMayWrite } from '../src/hubs/modeling/platforms/refm/lib/persistence/server';
import { PROJECT_SOURCES, hasMembership } from '../src/shared/admin/projectSources';
import { PROJECT_ROLES } from '../src/core/collab/projectRoles';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = 'supabase/migrations/231_refm_project_members.sql';
const SRV = 'src/hubs/modeling/platforms/refm/lib/persistence/server.ts';
const ROUTES = 'app/api/refm/projects';

/** Every route.ts under the projects tree. */
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

/** A file's handlers, split on the top-level `export async function VERB`. */
function handlers(file: string): Array<{ verb: string; body: string }> {
  const text = src(file);
  const lines = text.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((ln, i) => { if (/^export async function [A-Z]+\b/.test(ln)) starts.push(i); });
  return starts.map((from, i) => {
    const to = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const verb = /^export async function ([A-Z]+)\b/.exec(lines[from])![1];
    return { verb, body: lines.slice(from, to).join('\n') };
  });
}

const WRITE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

console.log('=== A. The migration ===');
{
  const mig = src(MIG);
  check('A1 the membership table is created', /CREATE TABLE IF NOT EXISTS refm_project_members/i.test(mig));
  check('A2 one row per person per project', /PRIMARY KEY \(project_id, user_id\)/i.test(mig));
  // Scoped to the CHECK CLAUSE, not the whole file. Reading the raw migration
  // matched the COMMENT that explains why 'admin' is excluded, so the check
  // failed on the sentence describing the rule it was testing. Same shape as
  // the file-wide regexes in TRAPS 3.17: the evidence came from the wrong
  // place.
  const roleCheck = /CHECK \(role IN \(([^)]*)\)\)/.exec(mig)?.[1] ?? '';
  check('A3 the role CHECK matches the shared vocabulary exactly',
    roleCheck.length > 0
    && PROJECT_ROLES.every((r) => new RegExp(`'${r}'`).test(roleCheck))
    && !/'admin'/.test(roleCheck),
    roleCheck);
  // Isolated to the seed STATEMENT, and the role literal must be inside it.
  // The first version matched the INSERT loosely and matched 'owner' anywhere
  // in the file, including the comment that explains the seed, so neutering
  // the seed by appending a disabled statement left the check green.
  const seed = /INSERT INTO refm_project_members[\s\S]*?;/i.exec(mig)?.[0] ?? '';
  check('A4 existing owners are seeded as Owner members',
    seed.length > 0
    && /FROM refm_projects/i.test(seed)
    && /'owner'/.test(seed)
    && /SELECT/i.test(seed)
    && !/WHERE false/i.test(seed),
    seed.replace(/\s+/g, ' ').slice(0, 120));
  check('A5 the seed is non-destructive on a re-run', /ON CONFLICT \(project_id, user_id\) DO NOTHING/i.test(mig));
  check('A6 a guard refuses to leave any project ownerless',
    /RAISE EXCEPTION[\s\S]{0,200}no owner membership/i.test(mig));
  check('A7 the applier PROVES the guard fires and the cascades behave',
    /ORPHAN GUARD/.test(src('scripts/apply-migration-231.ts'))
    && /CASCADE project/.test(src('scripts/apply-migration-231.ts')));
}

console.log('\n=== B. EVERY write handler gates on getProjectForWrite ===');
{
  // THE check. A route that gates a write on plain getProject lets any member,
  // including a Viewer, save. Enumerated rather than trusted.
  const offenders: string[] = [];
  const covered: string[] = [];
  for (const f of routeFiles()) {
    for (const h of handlers(f)) {
      if (!WRITE.has(h.verb)) continue;
      const body = strip(h.body);
      const usesWrite = /getProjectForWrite\(|requireWritableProject\(/.test(body);
      const usesRead = /\bgetProject\(|requireOwnedProject\(/.test(body);
      if (usesRead && !usesWrite) offenders.push(`${f.replace(ROUTES + '/', '')}:${h.verb}`);
      if (usesWrite) covered.push(`${f.replace(ROUTES + '/', '')}:${h.verb}`);
    }
  }
  check('B1 no write handler gates on the READ resolver', offenders.length === 0, offenders.join(', '));
  check('B2 a meaningful number of write handlers are covered', covered.length >= 13,
    `covered=${covered.length}: ${covered.join(', ')}`);
  const srv = strip(src(SRV));
  check('B3 getProductForWrite returns nothing to a read-only member',
    /getProjectForWrite/.test(srv) && /r\.mayWrite === false/.test(srv)
    && /row: null[\s\S]{0,60}readOnly: true/.test(srv));
  check('B4 it is a SEPARATE function, not a flag, so it can be enumerated',
    /export async function getProjectForWrite/.test(srv));
}

console.log('\n=== C. Reads still reach members ===');
{
  const readOnlyNarrowed: string[] = [];
  for (const f of routeFiles()) {
    for (const h of handlers(f)) {
      if (h.verb !== 'GET') continue;
      const body = strip(h.body);
      if (/getProjectForWrite\(|requireWritableProject\(/.test(body)) {
        readOnlyNarrowed.push(`${f.replace(ROUTES + '/', '')}:GET`);
      }
    }
  }
  check('C1 no GET handler was narrowed to writers only', readOnlyNarrowed.length === 0,
    readOnlyNarrowed.join(', '));
  check('C2 the read helper survives alongside the write one',
    /requireOwnedProject/.test(src(`${ROUTES}/[id]/parties/route.ts`))
    && /requireWritableProject/.test(src(`${ROUTES}/[id]/parties/route.ts`)));
}

console.log('\n=== D. Owner only, and denial is the default ===');
{
  check('D1 only an owner may write, until the lock ships',
    roleMayWrite('owner') === true
    && roleMayWrite('editor') === false
    && roleMayWrite('reviewer') === false
    && roleMayWrite('viewer') === false
    && roleMayWrite(null) === false);
  const srv = strip(src(SRV));
  check('D2 an unrecognised role resolves to null, never to a role',
    /isProjectRole\(raw\) \? raw : null/.test(srv));
  check('D3 a failed membership lookup denies rather than throwing',
    /catch \{[\s\S]{0,80}role: null/.test(srv));
  check('D4 no membership means the project is not found',
    /byMembership && role === null[\s\S]{0,140}row: null/.test(srv));
  check('D5 the reason the narrowing is deliberate is written down',
    /edit lock/i.test(src(SRV)) && /autosave/i.test(src(SRV)));
}

console.log('\n=== E. Schema tolerance ===');
{
  const srv = strip(src(SRV));
  check('E1 a missing membership table is detected, not treated as no-access',
    /isMissingMembersTable/.test(srv) && /tableMissing/.test(srv));
  check('E2 a pre-231 database falls back to the OWNER filter',
    /if \(!byMembership\) q = q\.eq\('user_id', userId\)/.test(srv));
  check('E3 the fallback is the owner check, NOT an open one',
    !/if \(!byMembership\) return \{ row/.test(srv));
  check('E4 the probe is cached like every other migration probe',
    /let membersApplied: boolean \| undefined/.test(srv));
}

console.log('\n=== F. Registry driven ===');
{
  const refm = PROJECT_SOURCES.find((s) => s.key === 'refm');
  check('F1 REFM declares all four membership columns',
    !!refm && refm.membersTable === 'refm_project_members'
    && refm.membersProjectColumn === 'project_id'
    && refm.membersUserColumn === 'user_id'
    && refm.membersRoleColumn === 'role');
  check('F2 hasMembership is all-or-nothing', !!refm && hasMembership(refm)
    && !hasMembership({ ...refm, membersRoleColumn: null })
    && !hasMembership({ ...refm, membersUserColumn: null })
    && !hasMembership({ ...refm, membersTable: null }));
  const reg = strip(src('src/shared/admin/projectSources.ts'));
  check('F3 the registry names columns but does not restate the roles',
    /membersTable/.test(reg) && !PROJECT_ROLES.some((r) => new RegExp(`'${r}'`).test(reg)));
}

console.log('\n=== G. Nothing changes for a single-user account ===');
{
  const srv = strip(src(SRV));
  // Every owner was seeded as an Owner member, so the membership set is a
  // SUPERSET of the owned set and a lone user's list is unchanged.
  check('G1 the list adds member-of projects rather than replacing owned ones',
    /const owned = new Set\(projects\.map/.test(srv)
    && /filter\(\(id\) => !owned\.has\(id\)\)/.test(srv));
  check('G2 a failed membership read never removes owned projects',
    /the base list stands/.test(src(SRV)));
  check('G3 an owner still writes: roleMayWrite(owner) is true', roleMayWrite('owner'));
  check('G4 the extra read is paginated, so a member of many projects sees them all',
    /listProjectRowsByIds/.test(srv) && /PAGE_SIZE/.test(
      (srv.split('async function listProjectRowsByIds')[1] ?? '').split(/\nasync |\nexport /)[0]));
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
