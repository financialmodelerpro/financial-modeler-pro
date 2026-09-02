/**
 * verify-version-authorship.ts
 *
 * Pins Module 10 Collaboration step 1: WHO SAVED THIS VERSION.
 *
 * The rules, each with a specific way of quietly breaking:
 *   A. The column exists, is written on every path that creates a version,
 *      and carries the SESSION USER rather than the project owner.
 *   B. An unknown author stays unknown. It is never backfilled from
 *      `refm_projects.user_id`, never rendered as a uuid, and never invented.
 *   C. The FK is ON DELETE SET NULL, so a version outlives its author.
 *   D. Schema tolerance: a pre-230 database still works and reads null.
 *   E. The author's NAME is resolved server-side, once per page, and an
 *      unresolvable id is absent rather than filled in.
 *
 * Run: npx tsx scripts/verify-version-authorship.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { resolveAuthorNames } from '../src/hubs/modeling/platforms/refm/lib/persistence/server';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = 'supabase/migrations/230_refm_version_created_by.sql';
const SRV = 'src/hubs/modeling/platforms/refm/lib/persistence/server.ts';
const VROUTE = 'app/api/refm/projects/[id]/versions/route.ts';
const PROUTE = 'app/api/refm/projects/route.ts';
const DROUTE = 'app/api/refm/projects/[id]/duplicate/route.ts';

console.log('=== A. Written on every path that creates a version ===');
{
  const mig = src(MIG);
  check('A1 the migration adds created_by', /ADD COLUMN IF NOT EXISTS created_by uuid/i.test(mig));
  // Every insertVersion call site must pass an author, or a whole class of
  // version simply has none. There are exactly three.
  const sites: Array<[string, string]> = [
    ['saving a new version', VROUTE],
    ['creating a project', PROUTE],
    ['duplicating a project', DROUTE],
  ];
  for (const [what, file] of sites) {
    const s = src(file);
    const call = s.split('insertVersion({')[1] ?? '';
    const body = call.split('});')[0];
    check(`A2 ${what} records an author`, /created_by:\s*userId/.test(body),
      body ? 'created_by not passed' : 'no insertVersion call found');
  }
  // A count guard: if a FOURTH creation path is added later without an author,
  // this fails rather than the gap going unnoticed.
  const allFiles = [VROUTE, PROUTE, DROUTE].map(src).join('\n');
  const calls = (allFiles.match(/insertVersion\(\{/g) ?? []).length;
  const authored = (allFiles.match(/created_by:\s*userId/g) ?? []).length;
  check('A3 every insertVersion call in these routes passes an author',
    calls > 0 && calls === authored, `calls=${calls} authored=${authored}`);
  check('A4 insertVersion accepts created_by', /created_by\?:\s*string \| null;/.test(src(SRV)));
}

console.log('\n=== B. Unknown stays unknown ===');
{
  const mig = src(MIG);
  const srv = strip(src(SRV));
  // The single most tempting wrong move: fill the author in from the project
  // owner. It would look like data and be a fabrication.
  check('B1 the migration never backfills created_by',
    !/UPDATE\s+refm_project_versions[\s\S]{0,200}created_by/i.test(mig)
    && !/created_by\s*=\s*.*user_id/i.test(mig));
  check('B2 nothing decorates created_by to the project owner',
    !/created_by\s*=\s*[^;]*\b(owner|user_id|project\.user_id)\b/.test(srv));
  check('B3 an absent column decorates to NULL',
    /\('created_by' in row\)[\s\S]{0,80}created_by\s*=\s*null/.test(srv));
  check('B4 the column stays NULLABLE (never made NOT NULL)',
    !/created_by[^;]*SET NOT NULL/i.test(mig) && !/created_by uuid NOT NULL/i.test(mig));
  check('B5 the reason is recorded on the column itself',
    /COMMENT ON COLUMN refm_project_versions\.created_by/i.test(mig)
    && /NEVER|never/.test(mig));
}

console.log('\n=== C. A version outlives its author ===');
{
  const mig = src(MIG);
  check('C1 the FK is ON DELETE SET NULL, not CASCADE',
    /created_by[\s\S]{0,200}ON DELETE SET NULL/i.test(mig)
    && !/created_by[\s\S]{0,200}ON DELETE CASCADE/i.test(mig));
  check('C2 the applier PROVES the FK behaviour rather than asserting it',
    /FK PROBE/.test(src('scripts/apply-migration-230.ts'))
    && /DELETE FROM public\.users/.test(src('scripts/apply-migration-230.ts')));
}

console.log('\n=== D. Schema tolerance ===');
{
  const srv = src(SRV);
  check('D1 both FULL column lists carry created_by',
    /VERSION_COLS_FULL =[\s\S]{0,220}created_by/.test(srv)
    && /VERSION_LIST_COLS_FULL =[\s\S]{0,220}created_by/.test(srv));
  // The pre-230 insert path must strip the field, or the fallback insert fails
  // for the very reason it is a fallback.
  check('D2 the pre-230 insert fallback strips created_by',
    /created_by: _cb, \.\.\.stripped/.test(srv));
  check('D3 the row type carries it as nullable',
    /created_by:\s*string \| null;/.test(src('src/hubs/modeling/platforms/refm/lib/persistence/types.ts')));
}

async function sectionE(): Promise<void> {
console.log('\n=== E. Names are resolved, not guessed ===');
{
  const route = src(VROUTE);
  check('E1 the versions route decorates rows with an author name',
    /resolveAuthorNames/.test(route) && /author:/.test(route));
  check('E2 an unresolved id yields null, not the id',
    /authors\[r\.created_by\] \?\? null/.test(route));
  // The resolver itself, exercised directly.
  const empty = await resolveAuthorNames([]);
  check('E3 no ids means no query and an empty map', Object.keys(empty).length === 0);
  // These two run with NO Supabase env, which is the point: the resolver must
  // survive a client it cannot even construct. The first version took
  // `sb = getServerClient()` as a DEFAULT PARAMETER, evaluated at call time,
  // and threw here. That would have 500ed the whole versions GET over a
  // cosmetic decoration. E5 asserted "never throws" with a literal `true`,
  // which is how the claim went unchecked in the first place.
  let threw = false;
  let junk: Record<string, string> = {};
  try { junk = await resolveAuthorNames(['not-a-uuid', '']); } catch { threw = true; }
  check('E4 unresolvable ids are ABSENT from the map, never echoed back',
    !threw && !('not-a-uuid' in junk) && Object.keys(junk).length === 0);
  check('E5 the resolver does NOT throw when the client cannot be built',
    !threw);
  // One query for the page, not one per row.
  const srv = strip(src(SRV));
  const body = (srv.split('export async function resolveAuthorNames')[1] ?? '').split(/\nexport /)[0];
  check('E6 names resolve in ONE query for the whole list',
    /\.in\('id', unique\)/.test(body) && !/for \([^)]*\)[\s\S]{0,120}await sb\.from\('users'\)/.test(body));
  check('E7 the UI renders nothing when the author is unknown',
    /\.author && \(/.test(src('src/hubs/modeling/platforms/refm/components/modals/VersionModal.tsx')));
}

}

void sectionE().then(() => {
  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
});
