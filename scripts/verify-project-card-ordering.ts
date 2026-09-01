/**
 * verify-project-card-ordering.ts
 *
 * Pins the project card's status, urgent flag and manual order (migration 229).
 *
 * The rules it holds, each of which has a way of quietly breaking:
 *   A. The vocabulary is defined ONCE and no copy of it exists.
 *   B. STATUS IS A LABEL. No status value may free a project slot, make a
 *      project view-only, or otherwise acquire behaviour. Archiving is the
 *      `archived` boolean and deletion is `deleted_at`, and 'Archived' must
 *      never return to the enum.
 *   C. The comparator implements the agreed rule, including the parts that
 *      are easy to get subtly wrong: an un-dragged card sorts after a dragged
 *      one, priority never crosses a group, and the sort is total and stable.
 *   D. The group order is the agreed one.
 *   E. Reordering is dense, within-group, and never changes a status.
 *   F. The registry carries the columns, so ERM and BVM inherit the feature.
 *   G. Schema tolerance: a pre-229 database still works and falls back to
 *      recency, with sort_order NULL rather than 0.
 *   H. The write paths validate, and the archived view-only rule covers the
 *      new fields.
 *
 * Run: npx tsx scripts/verify-project-card-ordering.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import {
  PROJECT_STATUSES, STATUS_GROUP_ORDER, DEFAULT_PROJECT_STATUS,
  statusRank, isProjectStatus, compareProjectCards, groupProjectCards,
  reorderWithinGroup, type OrderableProjectCard,
} from '../src/shared/admin/projectStatus';
import { PROJECT_SOURCES, hasCardOrdering } from '../src/shared/admin/projectSources';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
/** Strip comments, so a rule described in prose never satisfies a check that
 *  means to test the code. */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const card = (o: Partial<OrderableProjectCard> & { id: string }): OrderableProjectCard => ({ ...o });

console.log('=== A. One vocabulary, no copies ===');
{
  const EXPECTED = ['Draft', 'Funded', 'Construction', 'Operation', 'Completed', 'Closed', 'Dropped'];
  check('A1 the seven lifecycle statuses are declared',
    EXPECTED.every((s) => (PROJECT_STATUSES as readonly string[]).includes(s))
    && PROJECT_STATUSES.length === EXPECTED.length,
    PROJECT_STATUSES.join(', '));
  check('A2 REFM re-exports the shared vocabulary rather than declaring its own',
    /export\s*\{[\s\S]*?PROJECT_STATUSES[\s\S]*?\}\s*from\s*'@\/src\/shared\/admin\/projectStatus'/
      .test(src('src/hubs/modeling/platforms/refm/lib/persistence/types.ts')));
  // The literal union that used to sit in StorageProject was a second copy and
  // drifted the moment the vocabulary changed. Any file that spells out three
  // or more of the values in a row is declaring a copy.
  const COPY = /'Draft'\s*\|\s*'/;
  for (const f of [
    'src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx',
    'src/hubs/modeling/platforms/refm/components/Dashboard.tsx',
    'src/hubs/modeling/platforms/refm/lib/persistence/types.ts',
  ]) {
    check(`A3 no literal status union restated in ${f.split('/').pop()}`, !COPY.test(strip(src(f))));
  }
  check('A4 an unknown value is not silently accepted',
    !isProjectStatus('Archived') && !isProjectStatus('Active') && !isProjectStatus('')
    && isProjectStatus('Construction'));
}

console.log('\n=== B. Status is a LABEL and gates nothing ===');
{
  const FORBIDDEN = ['Archived', 'archived', 'Deleted', 'deleted', 'Active'];
  check('B1 no status value duplicates the archive or delete state',
    FORBIDDEN.every((v) => !(PROJECT_STATUSES as readonly string[]).includes(v)));
  // The gate decides the project cap and the view-only state. If it ever reads
  // a status value, the label has grown behaviour.
  const gate = strip(src('src/shared/entitlements/gate.ts'));
  check('B2 the entitlements gate does not branch on a status value',
    PROJECT_STATUSES.every((s) => !new RegExp(`['"\`]${s}['"\`]`).test(gate)));
  // The card query and the cap count must key off `archived` / `deleted_at`,
  // never off a status.
  const patchRoute = strip(src('app/api/refm/projects/[id]/route.ts'));
  check('B3 the archive branch is driven by the archived boolean, not a status',
    /body\.archived/.test(patchRoute) && /update\.archived\s*=/.test(patchRoute)
    && !/update\.archived\s*=\s*\(?\s*body\.status/.test(patchRoute));
  check('B4 the standing rule is written down where the vocabulary lives',
    /STATUS IS A LABEL/i.test(src('src/shared/admin/projectStatus.ts'))
    && /Closed|Dropped/.test(src('src/shared/admin/projectStatus.ts')));
  check('B5 the migration records it on the column itself',
    /COMMENT ON COLUMN refm_projects\.status/i.test(src('supabase/migrations/229_project_card_status_priority_order.sql')));
}

console.log('\n=== C. The comparator ===');
{
  // Group beats everything.
  const constructionPlain = card({ id: 'a', status: 'Construction' });
  const draftUrgent = card({ id: 'b', status: 'Draft', priority: true, sortOrder: 0 });
  check('C1 status group outranks priority (an urgent Draft still sits below Construction)',
    compareProjectCards(constructionPlain, draftUrgent) < 0);

  // Priority beats manual order, within a group.
  const urgentLast = card({ id: 'c', status: 'Draft', priority: true, sortOrder: 99 });
  const plainFirst = card({ id: 'd', status: 'Draft', priority: false, sortOrder: 0 });
  check('C2 priority outranks manual order within a group',
    compareProjectCards(urgentLast, plainFirst) < 0);

  // Manual order beats recency.
  const old2 = card({ id: 'e', status: 'Draft', sortOrder: 0, lastModified: '2020-01-01T00:00:00Z' });
  const new2 = card({ id: 'f', status: 'Draft', sortOrder: 1, lastModified: '2030-01-01T00:00:00Z' });
  check('C3 manual order outranks recency', compareProjectCards(old2, new2) < 0);

  // THE ONE THAT MATTERS: an un-dragged card is not treated as position 0.
  const dragged = card({ id: 'g', status: 'Draft', sortOrder: 5, lastModified: '2020-01-01T00:00:00Z' });
  const never = card({ id: 'h', status: 'Draft', sortOrder: null, lastModified: '2030-01-01T00:00:00Z' });
  check('C4 an un-dragged card (sortOrder null) sorts AFTER a dragged one, however recent',
    compareProjectCards(dragged, never) < 0 && compareProjectCards(never, dragged) > 0);

  // Recency is the tie-break, and it is the LAST one.
  const older = card({ id: 'i', status: 'Draft', lastModified: '2020-01-01T00:00:00Z' });
  const newer = card({ id: 'j', status: 'Draft', lastModified: '2030-01-01T00:00:00Z' });
  check('C5 recency breaks a tie, most recent first', compareProjectCards(newer, older) < 0);

  // This is the defect the whole change exists to fix: a touched project must
  // not jump the queue when the order has been set.
  const restored = card({ id: 'k', status: 'Draft', sortOrder: 3, lastModified: new Date().toISOString() });
  const untouched = card({ id: 'l', status: 'Draft', sortOrder: 0, lastModified: '2020-01-01T00:00:00Z' });
  check('C6 REGRESSION: touching a project does not move it to the front once ordered',
    compareProjectCards(untouched, restored) < 0);

  // Total and stable.
  const same = [card({ id: 'z' }), card({ id: 'a' })];
  check('C7 identical keys fall back to a stable id tie-break',
    compareProjectCards(same[0], same[1]) > 0 && compareProjectCards(same[1], same[0]) < 0);
  check('C8 a card compared with itself is equal', compareProjectCards(same[0], { ...same[0] }) === 0);
  // An unknown status sorts WITH Draft, not off the end.
  check('C9 an unknown or absent status sorts with the default, not last',
    statusRank(undefined) === statusRank(DEFAULT_PROJECT_STATUS)
    && statusRank('NotAStatus') === statusRank(DEFAULT_PROJECT_STATUS));
}

console.log('\n=== D. The group order ===');
{
  const AGREED = ['Construction', 'Operation', 'Funded', 'Draft', 'Completed', 'Closed', 'Dropped'];
  check('D1 the agreed group order, exactly', STATUS_GROUP_ORDER.join(',') === AGREED.join(','),
    STATUS_GROUP_ORDER.join(', '));
  check('D2 every status appears in the group order exactly once',
    PROJECT_STATUSES.every((s) => STATUS_GROUP_ORDER.filter((g) => g === s).length === 1)
    && STATUS_GROUP_ORDER.length === PROJECT_STATUSES.length);
  check('D3 live work leads and terminal states trail',
    statusRank('Construction') < statusRank('Draft')
    && statusRank('Operation') < statusRank('Draft')
    && statusRank('Draft') < statusRank('Completed')
    && statusRank('Completed') < statusRank('Dropped'));
  // Grouping omits empty groups and sorts within each.
  const grouped = groupProjectCards([
    card({ id: '1', status: 'Draft', sortOrder: 1 }),
    card({ id: '2', status: 'Construction' }),
    card({ id: '3', status: 'Draft', sortOrder: 0 }),
  ]);
  check('D4 groups render in group order, empty groups omitted',
    grouped.map((g) => g.status).join(',') === 'Construction,Draft');
  check('D5 each group is internally sorted', grouped[1].cards.map((c) => c.id).join(',') === '3,1');
}

console.log('\n=== E. Reordering is dense, within-group, status-preserving ===');
{
  const ids = ['a', 'b', 'c', 'd'];
  const moved = reorderWithinGroup(ids, 'd', 0);
  check('E1 a move produces a DENSE 0..n-1 assignment',
    moved.map((m) => m.sortOrder).join(',') === '0,1,2,3');
  check('E2 the moved card lands where it was dropped',
    moved.find((m) => m.id === 'd')!.sortOrder === 0 && moved.map((m) => m.id).join(',') === 'd,a,b,c');
  check('E3 every card in the group is reassigned, not just the moved one',
    moved.length === ids.length);
  check('E4 an out-of-range index is clamped, not thrown',
    reorderWithinGroup(ids, 'a', 99).map((m) => m.id).join(',') === 'b,c,d,a'
    && reorderWithinGroup(ids, 'd', -5).map((m) => m.id).join(',') === 'd,a,b,c');
  check('E5 an id not in the group leaves the order untouched',
    reorderWithinGroup(ids, 'zz', 0).map((m) => m.id).join(',') === 'a,b,c,d');
  // Status is never part of a reorder payload.
  check('E6 reorderWithinGroup returns only id + sortOrder, never a status',
    moved.every((m) => Object.keys(m).sort().join(',') === 'id,sortOrder'));
  const reorderRoute = strip(src('app/api/refm/projects/reorder/route.ts'));
  check('E7 the reorder route never writes a status',
    reorderRoute.length > 0 && !/status/i.test(reorderRoute.replace(/status:\s*\d{3}/g, '')));
  check('E8 the reorder route rejects a duplicate id',
    /duplicate project id/i.test(src('app/api/refm/projects/reorder/route.ts')));
  // Sliced to the END OF THIS FUNCTION, not to the end of the file. The
  // first version ran the slice to EOF, so a later function's own ownership
  // filter satisfied it and removing this one changed nothing.
  const serverSrc = src('src/hubs/modeling/platforms/refm/lib/persistence/server.ts');
  const afterReorder = serverSrc.split('export async function reorderProjects')[1] ?? '';
  const reorderBody = afterReorder.split(/\nexport /)[0];
  check('E9 the reorder write enforces ownership PER ROW',
    reorderBody.length > 0 && /\.eq\('user_id', userId\)/.test(reorderBody));
  check('E10 the reorder route applies the read-only lapse gate',
    /writeBlockReason/.test(reorderRoute));
}

console.log('\n=== F. Registry driven, so ERM and BVM inherit it ===');
{
  const refm = PROJECT_SOURCES.find((s) => s.key === 'refm');
  check('F1 REFM declares all three ordering columns',
    !!refm && refm.statusColumn === 'status' && refm.priorityColumn === 'priority'
    && refm.sortOrderColumn === 'sort_order');
  check('F2 hasCardOrdering is all-or-nothing', !!refm && hasCardOrdering(refm)
    && !hasCardOrdering({ ...refm, sortOrderColumn: null })
    && !hasCardOrdering({ ...refm, statusColumn: null })
    && !hasCardOrdering({ ...refm, priorityColumn: null }));
  const reg = src('src/shared/admin/projectSources.ts');
  check('F3 the registry names the columns but does NOT restate the vocabulary',
    /statusColumn/.test(reg)
    && !PROJECT_STATUSES.some((s) => new RegExp(`['"]${s}['"]`).test(strip(reg))));
  check('F4 the group order is not restated outside projectStatus.ts',
    !/STATUS_GROUP_ORDER\s*[:=]\s*\[/.test(strip(src('src/hubs/modeling/platforms/refm/components/Dashboard.tsx'))));
}

console.log('\n=== G. Schema tolerance (a pre-229 database still works) ===');
{
  const server = src('src/hubs/modeling/platforms/refm/lib/persistence/server.ts');
  check('G1 the widened select carries both new columns',
    /PROJECT_COLS_FULL = `\$\{PROJECT_COLS_BASE\}, archived, priority, sort_order`/.test(server));
  check('G2 an absent priority column decorates to false',
    /\('priority' in row\)[\s\S]{0,80}priority\s*=\s*false/.test(strip(server)));
  // THE distinction: null, not 0. Decorating to 0 would promote every project
  // on a pre-229 database to the top of its group.
  check('G3 an absent sort_order column decorates to NULL, not 0',
    /\('sort_order' in row\)[\s\S]{0,90}sort_order\s*=\s*null/.test(strip(server))
    && !/\('sort_order' in row\)[\s\S]{0,90}sort_order\s*=\s*0/.test(strip(server)));
  check('G4 the reorder write reports an honest failure naming the migration',
    /migration 229/i.test(server));
  check('G5 updateProject echoes the FULL row, not the base one',
    /run\(PROJECT_COLS_FULL\)/.test(server));
}

console.log('\n=== H. Write paths ===');
{
  const patchRoute = src('app/api/refm/projects/[id]/route.ts');
  check('H1 PATCH validates status against the shared list',
    /PROJECT_STATUSES as readonly string\[\]\)\.includes\(body\.status\)/.test(patchRoute));
  check('H2 PATCH rejects a non-boolean priority rather than coercing it',
    /typeof body\.priority !== 'boolean'/.test(patchRoute));
  // If priority were left out of hasMetadataEdit, an archived project could be
  // flagged, which contradicts view-only.
  check('H3 priority counts as a metadata edit, so the archived view-only block covers it',
    /hasMetadataEdit =[\s\S]{0,220}body\.priority !== undefined/.test(patchRoute));
  check('H4 PATCH does not accept sort_order (order is a whole-group operation)',
    !/body\.sortOrder/.test(patchRoute) && !/update\.sort_order/.test(patchRoute));
  const dash = strip(src('src/hubs/modeling/platforms/refm/components/Dashboard.tsx'));
  // Keyed to EACH control. A bare file-wide match for the attribute stayed
  // green when the select lost it, because the urgent button still had one.
  const statusControl = (dash.split('data-testid={`dashboard-status-')[0] ?? '').slice(-900);
  const priorityControl = (dash.split('data-testid={`dashboard-priority-')[0] ?? '').slice(-900);
  check('H5 the STATUS control is disabled while archived',
    /<select/.test(statusControl) && /disabled=\{isArchived\}/.test(statusControl));
  check('H5b the URGENT control is disabled while archived',
    /<button/.test(priorityControl) && /disabled=\{isArchived\}/.test(priorityControl));
  check('H6 the card offers every status from the shared list',
    /PROJECT_STATUSES\.map/.test(dash));
  check('H7 the grid orders through the shared rule, not a local sort',
    /groupProjectCards\(projects\)/.test(dash));
  // Test the DROP path specifically. The same expression also drives the
  // drop-target highlight, so a file-wide match stayed green with the actual
  // guard deleted, which would have let a drag reorder across groups.
  const dropFn = (dash.split('const dropOn =')[1] ?? '').split('};')[0];
  check('H8 the DROP path itself refuses a card from another group',
    dropFn.length > 0 && /groupIds\.includes\(dragId\)/.test(dropFn) && /return/.test(dropFn));
  check('H9 reordering is keyboard reachable, not drag-only',
    /onKeyDown/.test(dash) && /ArrowLeft|ArrowUp/.test(dash));
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
