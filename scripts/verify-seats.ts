/**
 * verify-seats.ts
 *
 * Module 10 Collaboration, step 8: SEATS.
 *
 * A seat is a DISTINCT PERSON ON AN ACCOUNT, counted across every project it
 * owns, on every platform. The owner uses one. Pro is 1, which means no
 * collaboration; Firm is 10; an admin raises a client with an override.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-seats.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { seatsAllow, UNLIMITED, SEATS_FEATURE_KEY } from '../src/shared/admin/seats';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const src = (f: string): string => readFileSync(f, 'utf8');
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SEATS = 'src/shared/admin/seats.ts';
const ROUTE = 'app/api/admin/project-members/route.ts';
const MIG = 'supabase/migrations/237_seats_live.sql';

console.log('=== A. The rule, as pure arithmetic ===');
{
  check('A1 a count equal to the limit is allowed', seatsAllow(1, 1) && seatsAllow(10, 10));
  check('A2 one over is refused', !seatsAllow(2, 1) && !seatsAllow(11, 10));
  check('A3 -1 is unlimited', seatsAllow(9999, UNLIMITED));
  // The safe direction. A plan that says nothing about seats must not read as
  // "as many as you like".
  check('A4 a missing limit DENIES rather than defaulting to unlimited', !seatsAllow(1, null));
  check('A5 a zero limit denies', !seatsAllow(1, 0));
  check('A6 the feature key has one spelling', SEATS_FEATURE_KEY === 'seats');
}

console.log('\n=== B. Counted in the REGISTRY layer, not in REFM ===');
{
  const s = src(SEATS);
  const code = strip(s);
  check('B1 the counter lives in shared/admin, beside the registry it reads',
    /import \{ PROJECT_SOURCES, hasMembership/.test(code));
  check('B2 it ITERATES the sources rather than naming one platform',
    /for \(const source of PROJECT_SOURCES\)/.test(code));
  // THE check that would catch the silent under-count: a hardcoded REFM table
  // would keep returning a plausible number and stop being right when ERM
  // ships.
  check('B3 no platform table is hardcoded in the counter',
    !/refm_project_members|refm_projects/.test(code), 'a platform table is named in code');
  check('B4 a source with no membership is SKIPPED, not counted as zero members',
    /if \(!hasMembership\(source\)\) continue;/.test(code));
  check('B5 a failed read THROWS rather than contributing zero',
    /throw new Error\(`seat count failed on/.test(code));
}

console.log('\n=== C. Who counts ===');
{
  const code = strip(src(SEATS));
  check('C1 the OWNER consumes a seat, unconditionally',
    /const userIds = new Set<string>\(\[holderId\]\);/.test(code));
  check('C2 a soft-deleted project is excluded (its members cannot reach it)',
    /if \(source\.deletedColumn\) q = q\.is\(source\.deletedColumn, null\)/.test(code));
  // Archiving is visible, reversible and leaves the project openable, so its
  // members still have access and still cost a seat.
  check('C3 archived projects are NOT excluded', !/archivedColumn/.test(code));
  check('C4 the account is the plan holder, resolved from the users row',
    /\.from\('users'\)\.select\('subscription_plan, role'\)/.test(code));
}

console.log('\n=== D. The limit, and the admin override ===');
{
  const code = strip(src(SEATS));
  // The override rule is NOT restated here: a second copy of "an active
  // override with a value wins, an expired one does not" is the divergence
  // this codebase keeps finding.
  check('D1 the limit REUSES resolveEffectiveFeatures, it does not re-implement it',
    /resolveEffectiveFeatures\(\[feature\], planCells, overrides, nowMs\)/.test(code));
  check('D2 the override comes from the EXISTING user_permissions table',
    /\.from\('user_permissions'\)/.test(code) && /override_value/.test(code));
  check('D3 no new table was created for seats',
    !/CREATE TABLE/i.test(src(MIG)));
  check('D4 no new admin UI was built: the override screen is unchanged',
    !/seats/i.test(src('src/components/admin/UserAccessPanel.tsx')));
  // AIMED AT A STORED COUNTER, not at the word "seat". The first version read
  // /UPDATE .*seat/i over the migration and matched its own legitimate
  // `UPDATE plan_permissions ... WHERE feature_key = 'seats'`, so it failed on
  // the statement that sets the LIMIT while claiming to be about a COUNT.
  // Evidence from the wrong place, TRAPS 3.17 again.
  check('D5 no seat counter column was added',
    !/ADD COLUMN[^;]*seat/i.test(src(MIG)) && !/CREATE TABLE/i.test(src(MIG)));
  check('D5b the count is computed per call, with no module-level cache',
    !/^let [a-zA-Z]*[Ss]eat[a-zA-Z]*(Count|Used|Cache)/m.test(code)
    && /export async function countAccountSeats/.test(code));
}

console.log('\n=== E. One enforcement point, in the single POST ===');
{
  const route = src(ROUTE);
  const code = strip(route);
  check('E1 the POST calls the shared decision', /checkSeatForMember\(sb, ownerId, body\.userId\)/.test(code));
  // SCOPED TO THE POST HANDLER. The first version used indexOf over the whole
  // file and found `checkSeatForMember` in the IMPORT line at the top, which
  // is before everything and made the ordering read as wrong. The import is
  // not the call site.
  const post = code.slice(code.indexOf('export async function POST'));
  const userIdx = post.indexOf('No such user.');
  const seatIdx = post.indexOf('checkSeatForMember(sb, ownerId');
  const upsertIdx = post.indexOf('.upsert(');
  check('E2 it sits AFTER the user lookup and BEFORE the upsert',
    userIdx > 0 && seatIdx > userIdx && upsertIdx > seatIdx, `user=${userIdx} seat=${seatIdx} upsert=${upsertIdx}`);
  check('E3 the refusal is a BLOCK, not a warning: 409 and no write',
    /status: 409/.test(code) && !/warn/i.test(code));
  check('E4 a counting failure refuses rather than granting',
    /Seat check failed, nothing was changed/.test(code));
  check('E5 the account measured is the project OWNER, not the acting admin',
    /checkSeatForMember\(sb, ownerId/.test(code));
}

console.log('\n=== F. A role change is not a new seat ===');
{
  const code = strip(src(SEATS));
  check('F1 the question asked is membership, not whether a row is inserted',
    /const alreadySeated = userIds\.has\(candidateUserId\);/.test(code));
  check('F2 an existing member is allowed even on a full account',
    /if \(alreadySeated\) return \{ \.\.\.base, allowed: true/.test(code));
  // The write is an UPSERT, so a demotion travels the same path as an add. A
  // check counting rows-to-be-written would refuse to demote the tenth member
  // of a full Firm account.
  check('F3 the reason is recorded where the decision is made',
    /NOT "will a row be inserted"/i.test(src(SEATS)));
}

console.log('\n=== G. Still not built, and staying that way ===');
{
  const all = [SEATS, ROUTE].map((f) => strip(src(f))).join('\n');
  check('G1 no Paddle seat purchase', !/paddle/i.test(all));
  check('G2 no end-user "contact the team" copy (no caller for it yet)',
    !/contact the team/i.test(all));
  check('G3 the block message is OPERATOR facing: it names the account and the fix',
    /Raise it in \/admin\/access/.test(src(SEATS)) && /invoiced manually/.test(src(SEATS)));
  check('G4 adding members is still admin only: no owner-adding route exists',
    !/refm\/projects\/\[id\]\/members/.test(all));
}

async function liveChecks(): Promise<void> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('\n[SKIP] live checks (no DB credentials).'); return; }
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const q = async (p: string) => (await (await fetch(`${url}/rest/v1/${p}`, { headers: h })).json()) as Array<Record<string, unknown>>;

  console.log('\n=== H. The applied plan limits (migration 237) ===');
  const rows = await q(`plan_permissions?feature_key=eq.${SEATS_FEATURE_KEY}&select=plan_key,included,limit_value`);
  const by = new Map(rows.map((r) => [String(r.plan_key), r]));
  const want: Record<string, number> = { trial: 1, solo: 1, pro: 1, firm: 10 };
  for (const [plan, n] of Object.entries(want)) {
    const r = by.get(plan);
    check(`H ${plan} has ${n} seat${n === 1 ? '' : 's'}, included`,
      !!r && r.limit_value === n && r.included === true, JSON.stringify(r));
  }
  // Pro is 1 BECAUSE rbac and Collaborate are Firm-only. Three seats with no
  // roles and no collaboration module was what migration 158 seeded.
  check('H5 pro is 1, so a Pro account is a single person', by.get('pro')?.limit_value === 1);

  const [feat] = await q(`features_registry?feature_key=eq.${SEATS_FEATURE_KEY}&select=build_status,description,visible`);
  check('H6 the seats feature is live, not "needs_build"', feat?.build_status === 'live', String(feat?.build_status));
  check('H7 the pricing copy no longer says "Coming soon"',
    !/coming soon/i.test(String(feat?.description ?? '')), String(feat?.description ?? '').slice(0, 60));
  check('H8 the copy says the owner uses a seat and how to get more',
    /owner uses one seat/i.test(String(feat?.description ?? '')) && /contact us/i.test(String(feat?.description ?? '')));
  check('H9 it is visible to customers', feat?.visible === true);
}

function report(): void {
  console.log('');
  console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
}

void liveChecks().then(report);
