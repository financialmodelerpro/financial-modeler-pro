/**
 * verify-member-ordering.ts
 *
 * Pins Module 10 Collaboration step 3: ordering and urgency are PER USER.
 *
 * The rules:
 *   A. The migration adds the per-member columns, DEPRECATES the project-level
 *      ones without dropping them, and refuses to run if anyone has already
 *      ordered or flagged a project.
 *   B. STATUS DID NOT MOVE. It is a property of the project and stays one
 *      value for everyone. "Finishing the job" by moving it too would be wrong.
 *   C. Reads overlay THIS user's ordering; the row shape is unchanged so no
 *      client had to learn a new field.
 *   D. Writes go to the MEMBERSHIP row. Writing the deprecated project column
 *      would look like it saved, be shared with every member, and never read
 *      back.
 *   E. Schema tolerance and the absent-value rule: NULL stays NULL, never 0.
 *   F. NOTHING CHANGES FOR A SINGLE-USER ACCOUNT.
 *
 * Run: npx tsx scripts/verify-member-ordering.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { compareProjectCards, groupProjectCards } from '../src/shared/admin/projectStatus';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIG = 'supabase/migrations/232_refm_member_ordering.sql';
const SRV = 'src/hubs/modeling/platforms/refm/lib/persistence/server.ts';
const ROUTE = 'app/api/refm/projects/[id]/route.ts';

console.log('=== A. The migration ===');
{
  const mig = src(MIG);
  check('A1 the per-member columns are added',
    /ALTER TABLE refm_project_members[\s\S]{0,120}ADD COLUMN IF NOT EXISTS priority boolean/i.test(mig)
    && /ALTER TABLE refm_project_members[\s\S]{0,120}ADD COLUMN IF NOT EXISTS sort_order integer/i.test(mig));
  check('A2 sort_order stays NULLABLE (never dragged is not position 0)',
    /ADD COLUMN IF NOT EXISTS sort_order integer;/i.test(mig)
    && !/sort_order integer NOT NULL/i.test(mig));
  // Deprecated, not dropped. Dropping is the one migration a later one cannot
  // undo, and the fallback path still reads these on a pre-232 database.
  check('A3 the old columns are NOT dropped',
    !/DROP COLUMN[\s\S]{0,60}(priority|sort_order)/i.test(mig));
  check('A4 the old columns are marked DEPRECATED in a comment',
    /COMMENT ON COLUMN refm_projects\.priority[\s\S]{0,200}DEPRECATED/i.test(mig)
    && /COMMENT ON COLUMN refm_projects\.sort_order[\s\S]{0,200}DEPRECATED/i.test(mig));
  check('A5 a guard refuses to strand an existing order or flag',
    /RAISE EXCEPTION[\s\S]{0,240}manual order/i.test(mig));
  check('A6 the applier PROVES the guard fires, both ways',
    /GUARD fired on an existing order/.test(src('scripts/apply-migration-232.ts'))
    && /GUARD fired on an existing urgent flag/.test(src('scripts/apply-migration-232.ts')));
  check('A7 the applier PROVES two members can hold different orders',
    /PER USER: one project, two members/.test(src('scripts/apply-migration-232.ts')));
}

console.log('\n=== B. Status did NOT move ===');
{
  const mig = src(MIG);
  // The migration must not touch status at all, in any direction.
  check('B1 the migration never alters refm_projects.status',
    !/ALTER TABLE refm_projects[\s\S]{0,200}status/i.test(mig)
    && !/ADD COLUMN[\s\S]{0,60}status/i.test(mig));
  check('B2 status is NOT added to the membership table',
    !/refm_project_members[\s\S]{0,200}ADD COLUMN[\s\S]{0,40}status/i.test(mig));
  check('B3 status is not marked deprecated',
    !/COMMENT ON COLUMN refm_projects\.status[\s\S]{0,200}DEPRECATED/i.test(mig));
  check('B4 the reason status stays is written down',
    /STATUS DOES NOT MOVE/i.test(mig) && /property of the PROJECT/i.test(mig));
  // The comparator still reads status off the card, unchanged.
  const a = { id: 'a', status: 'Construction' };
  const b = { id: 'b', status: 'Draft', priority: true };
  check('B5 the shared comparator still ranks by status group first',
    compareProjectCards(a, b) < 0);
}

console.log('\n=== C. Reads overlay this user\'s ordering ===');
{
  const srv = strip(src(SRV));
  check('C1 a per-member ordering read exists', /async function memberOrdering\(/.test(srv));
  check('C2 the list overlays it', /const ordering = await memberOrdering\(userId/.test(srv)
    && /applyMemberOrdering\(projects, ordering\)/.test(srv));
  check('C3 a single project read overlays it too', /async function overlayOne\(/.test(srv)
    && (srv.match(/overlayOne\(userId/g) ?? []).length >= 2);
  // The row SHAPE must not change, or every client, report and export would
  // have to learn a new field.
  check('C4 the row shape is unchanged (priority / sort_order, not new names)',
    /priority: mine\.priority, sort_order: mine\.sortOrder/.test(srv));
  check('C5 the ordering read is bounded (PostgREST truncates silently)',
    /\.limit\(slice\.length\)/.test((srv.split('async function memberOrdering')[1] ?? '').split(/\nasync |\nexport /)[0]));
  check('C6 a failed ordering read never fails the list',
    /the list stands, unordered/.test(src(SRV)));
}

console.log('\n=== D. Writes go to the membership row ===');
{
  const srv = strip(src(SRV));
  const reorder = (srv.split('export async function reorderProjects')[1] ?? '').split(/\nexport /)[0];
  check('D1 reorder writes refm_project_members, not refm_projects',
    /from\('refm_project_members'\)/.test(reorder) && !/from\('refm_projects'\)/.test(reorder));
  check('D2 reorder is scoped to project_id AND user_id',
    /\.eq\('project_id', id\)/.test(reorder) && /\.eq\('user_id', userId\)/.test(reorder));
  const setPri = (srv.split('export async function setProjectPriority')[1] ?? '').split(/\nexport /)[0];
  check('D3 a dedicated priority writer exists and targets the membership row',
    setPri.length > 0 && /from\('refm_project_members'\)/.test(setPri)
    && /\.update\(\{ priority \}\)/.test(setPri));
  // The route must NOT fold priority into the project patch.
  const route = strip(src(ROUTE));
  check('D4 the PATCH route does not put priority in the project patch',
    !/update\.priority\s*=/.test(route));
  check('D5 the PATCH route calls the membership writer',
    /setProjectPriority\(userId, id, priorityWrite\)/.test(route));
  check('D6 priority still counts as a metadata edit (archived stays view-only)',
    /hasMetadataEdit =[\s\S]{0,240}body\.priority !== undefined/.test(route));
  check('D7 a non-boolean priority is still rejected, not coerced',
    /typeof body\.priority !== 'boolean'/.test(route));
}

console.log('\n=== E. Tolerance, and the absent-value rule ===');
{
  const srv = strip(src(SRV));
  check('E1 a missing per-member column is detected', /isMissingMemberOrder/.test(srv));
  check('E2 NULL stays NULL, never coerced to 0',
    /typeof r\.sort_order === 'number' \? r\.sort_order : null/.test(srv)
    && !/sort_order.{0,30}\?\?\s*0/.test(srv));
  // Aimed at the RULE, not at the exact return expression. This pinned the
  // line verbatim and step 4 added `role: mine.role` to it, which changed
  // nothing about the rule: with no membership row the project is returned
  // UNCHANGED, and only the overlaid branch rewrites anything.
  const overlayFn = (srv.split('function applyMemberOrdering')[1] ?? '').split(/\nasync |\nexport |\nfunction /)[0];
  check('E3 a project with no membership row is returned unchanged',
    overlayFn.length > 0
    && /const mine = order\[r\.id\]/.test(overlayFn)
    && /:\s*r;?\s*$/m.test(overlayFn)
    && /mine\.priority/.test(overlayFn) && /mine\.sortOrder/.test(overlayFn));
  check('E4 the write failure names migration 232, not 229',
    /migration 232 \(refm_project_members\.sort_order\)/.test(src(SRV))
    && !/migration 229 \(refm_projects\.sort_order\)/.test(src(SRV)));
}

console.log('\n=== F. Nothing changes for a single-user account ===');
{
  // A lone owner holds exactly one membership per project, so the overlay
  // replaces each value with that same person's value. The ordering RULE is
  // untouched: the comparator and the grouping are the same functions step 2
  // and migration 229 pinned, and they are re-exercised here against rows
  // shaped the way the overlay produces them.
  const cards = [
    { id: 'p1', status: 'Draft', priority: false, sortOrder: 1, lastModified: '2020-01-01T00:00:00Z' },
    { id: 'p2', status: 'Draft', priority: true, sortOrder: 5, lastModified: '2019-01-01T00:00:00Z' },
    { id: 'p3', status: 'Construction', priority: false, sortOrder: null, lastModified: '2030-01-01T00:00:00Z' },
    { id: 'p4', status: 'Draft', priority: false, sortOrder: null, lastModified: '2031-01-01T00:00:00Z' },
  ];
  const grouped = groupProjectCards(cards);
  check('F1 groups still render in the agreed order',
    grouped.map((g) => g.status).join(',') === 'Construction,Draft');
  check('F2 urgent still leads its group', grouped[1].cards[0].id === 'p2');
  check('F3 manual order still beats recency', grouped[1].cards[1].id === 'p1');
  check('F4 an un-dragged card still sorts last in its group', grouped[1].cards[2].id === 'p4');
  check('F5 the whole order is unchanged by the move',
    grouped.flatMap((g) => g.cards.map((c) => c.id)).join(',') === 'p3,p2,p1,p4');
  // And the migration itself moved no data, because there was none.
  check('F6 the migration copies nothing (there was nothing to copy)',
    !/INSERT INTO refm_project_members[\s\S]{0,200}sort_order/i.test(src(MIG))
    && !/UPDATE refm_project_members[\s\S]{0,200}FROM refm_projects/i.test(src(MIG)));
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
