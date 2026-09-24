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
import { summariseArray, groupBySave } from '../src/hubs/modeling/platforms/refm/components/collab/CollabPanels';
import { diffSnapshots, sameValue } from '../src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff';
import { labelForChange, namingContext, recordsFromChanges, presentChanges, effectiveKind } from '../src/hubs/modeling/platforms/refm/lib/persistence/changeLabel';
import { formatValue, valueSides, describeChange } from '../src/hubs/modeling/platforms/refm/lib/persistence/valueText';
import { COST_METHOD_LABELS, TERMINAL_METHOD_LABELS } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

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
  // THE LIVE GUARD IS THE ONE IN 245, not the one 234 shipped (2026-09-22).
  // 234 enumerated the meaning-carrying columns; 245 replaced that with a
  // whole-row comparison after the dry run proved the list had already drifted
  // (the new `label` column was updatable on a logged row). B1 now asserts the
  // RULE, that the guard needs no list, rather than the names it used to hold:
  // the old check would pass a guard that listed nothing at all.
  const guard245 = src('supabase/migrations/245_project_changes_label_and_save_id.sql');
  const guard = guard245.slice(guard245.indexOf('refm_project_changes_no_update()'));
  check('B1 the guard compares the WHOLE ROW, so a column added later is guarded by default',
    /to_jsonb\(NEW\)\s*-\s*'version_id'\s*-\s*'user_id'/.test(guard)
    && /is distinct from\s*\(to_jsonb\(OLD\)/i.test(guard));
  check('B1b and it therefore names NO meaning-carrying column (a list is what drifted)',
    !/NEW\.(action|path|before|after|created_at|label|save_id)\s+is distinct from/i.test(guard));
  check('B1c the applier PROVES a column the guard was never told about is refused',
    /refuses an update to a column added AFTER the guard was written/.test(src('scripts/apply-migration-245.ts')));
  // Case-insensitive since 2026-09-22: 245 writes lowercase SQL, and a guard is
  // not less of a guard for being lowercase.
  check('B2 an FK may be RELEASED to NULL (this is what ON DELETE SET NULL does)',
    /NEW\.version_id is distinct from OLD\.version_id and NEW\.version_id is not null/i.test(guard)
    && /NEW\.user_id\s+is distinct from OLD\.user_id\s+and NEW\.user_id\s+is not null/i.test(guard));
  check('B3 it RAISES rather than silently returning OLD', /raise exception/i.test(guard));
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
  // D12/D13 (2026-09-22): the LABEL. `snapshot-diff` had produced a human
  // sentence since this log was built and `rowsForSave` dropped it, so the
  // screen had only the raw path to render. Pinned both ways, because the
  // failure mode was silent: a label that exists must arrive, and an entry
  // without one must not invent a label that would then read as the truth.
  check('D12 a labelled entry carries its label through to the row',
    rowsForSave('p', 'v', 'u', [{ path: 'assets[id=a].buaSqm', label: 'Marina Tower: floor area', before: 1, after: 2, kind: 'update' }])[0].label
      === 'Marina Tower: floor area');
  check('D13 an unlabelled entry carries null, so the renderer falls back to the path',
    rowsForSave('p', 'v', 'u', [{ path: 'x', before: 1, after: 2, kind: 'update' }])[0].label === null);
}

// ── D53 to D58: THE SCALAR LEAVES ARE LABELLED, AND A NO-OP IS NOT LOGGED ───
// Two defects the founder found on the live screen after items 1 to 3 shipped.
{
  console.log('\n-- D53..D58 scalar labels, and no-op rows --');
  const arrays = { parcels: [], subUnits: [], costLines: [], financingTranches: [],
    equityContributions: [], costOverrides: [], cases: [] };
  const base = {
    project: { name: 'P', fundTerms: { hurdleRatePct: 8, feeDistribution: [{ pct: 50, partyId: 'x' }] } },
    landAllocationMode: 'sqm',
    phases: [{ id: 'ph1', name: 'Phase 1' }],
    assets: [{ id: 'as1', type: '4 Star Hotel', phaseId: 'ph1', buaSqm: 100 }],
    ...arrays,
  } as unknown as Parameters<typeof diffSnapshots>[0];

  // A scalar field on an ELEMENT is labelled by that element and the field.
  const a2 = JSON.parse(JSON.stringify(base)); a2.assets[0].buaSqm = 200;
  const aEntry = diffSnapshots(base, a2 as typeof base).find((e) => e.path.includes('buaSqm'));
  check('D53 a scalar leaf on an element is LABELLED, not left to the raw path',
    !!aEntry?.label, aEntry?.label ?? '(none)');
  check('D54 and the label names the element AND the field in words',
    /4 Star Hotel/.test(aEntry?.label ?? '') && /BUA \(sqm\)/.test(aEntry?.label ?? ''),
    aEntry?.label ?? '');
  // A scalar under a project SECTION is labelled by the section.
  const p2 = JSON.parse(JSON.stringify(base)); p2.project.fundTerms.hurdleRatePct = 9;
  const pEntry = diffSnapshots(base, p2 as typeof base).find((e) => e.path.includes('hurdleRatePct'));
  check('D55 a scalar under a project section is labelled by that section',
    /Fund terms: Hurdle rate %/.test(pEntry?.label ?? ''), pEntry?.label ?? '(none)');
  check('D56 EVERY entry now carries a label (the scalar case was the common one)',
    diffSnapshots(base, p2 as typeof base).every((e) => !!e.label),
    JSON.stringify(diffSnapshots(base, p2 as typeof base).filter((e) => !e.label).map((e) => e.path)));

  // THE NO-OP ROW. Key order is not a change, and jsonb normalises it away, so
  // a row logged for it reads as "nothing changed" on both sides.
  const reordered = JSON.parse(JSON.stringify(base));
  reordered.project.fundTerms.feeDistribution = [{ partyId: 'x', pct: 50 }]; // same values, keys swapped
  check('D57 re-ordering an object\'s KEYS is not a change, so nothing is logged',
    diffSnapshots(base, reordered as typeof base).length === 0,
    JSON.stringify(diffSnapshots(base, reordered as typeof base).map((e) => e.path)));
  // ...but an array's own ORDER still is a change, because order is its meaning.
  const resorted = JSON.parse(JSON.stringify(base));
  resorted.project.fundTerms.feeDistribution = [{ pct: 50, partyId: 'x' }, { pct: 50, partyId: 'y' }];
  check('D58 but an ARRAY reordering or resizing is still a change',
    diffSnapshots(base, resorted as typeof base).length > 0);
}

// ── D20 to D24: A VALUE CLEARED IS NOT AN ELEMENT REMOVED (2026-09-22) ──────
// This platform stores a blank as an ABSENT KEY ("never null and never 0"), so
// emptying a field deletes its key, and the differ read that as a deletion. The
// log said REMOVED, in red, when a number had been cleared. Driven through the
// REAL differ rather than inspected, because the classification is the defect.
{
  console.log('\n-- D20..D24 cleared is not removed --');
  // The differ walks every id-keyed array, so the fixture carries all of them.
  // A thin fixture crashes in diffIdArray rather than failing a check, which is
  // a test that cannot report anything.
  const base = {
    project: { name: 'P', assetTypeValues: { t1: { buildCost: 1000 } } },
    landAllocationMode: 'sqm',
    phases: [{ id: 'ph1', name: 'Phase 1' }],
    parcels: [], assets: [], subUnits: [], costLines: [],
    financingTranches: [], equityContributions: [], costOverrides: [], cases: [],
  } as unknown as Parameters<typeof diffSnapshots>[0];
  // A field's key goes away while its RECORD stays: a value was cleared.
  const cleared = JSON.parse(JSON.stringify(base));
  delete cleared.project.assetTypeValues.t1.buildCost;
  const cl = diffSnapshots(base, cleared as typeof base);
  const clEntry = cl.find((e) => e.path.includes('buildCost'));
  check('D20 clearing a field on a surviving record is CLEAR, not remove',
    clEntry?.kind === 'clear', `${clEntry?.path} -> ${clEntry?.kind}`);
  check('D21 and it still carries the value that was cleared, so the log shows what went',
    clEntry?.before === 1000);
  // A whole ELEMENT goes: that is still a removal, and must not be softened.
  const dropped = JSON.parse(JSON.stringify(base));
  dropped.phases = [];
  const dr = diffSnapshots(base, dropped as typeof base);
  check('D22 removing a whole element is STILL remove (the distinction cuts both ways)',
    dr.some((e) => e.kind === 'remove'), JSON.stringify(dr.map((e) => `${e.path}:${e.kind}`)));
  // Filling a field in is an add, unchanged.
  const filled = JSON.parse(JSON.stringify(base));
  filled.project.assetTypeValues.t1.revenueRate = 500;
  const fi = diffSnapshots(base, filled as typeof base);
  check('D23 filling an absent field in is still an add',
    fi.find((e) => e.path.includes('revenueRate'))?.kind === 'add');
  check('D24 an ordinary edit is still an update',
    diffSnapshots(base, { ...JSON.parse(JSON.stringify(base)), project: { ...base!.project, name: 'Q' } } as typeof base)
      .some((e) => e.kind === 'update'));
}

// ── D46 to D52: THE UNREAD MARKER (2026-09-22, migration 246) ───────────────
// Stored per user per project in the DATABASE by founder decision: browser
// storage is lost on another device or a cleared cache, and each of those makes
// the marker WRONG rather than absent, which is worse because a reader trusts
// it. The ordering is the whole feature: READ BEFORE WRITE, or "what changed
// since you last looked" always answers "nothing".
{
  console.log('\n-- D46..D52 the unread marker --');
  const mig = src('supabase/migrations/246_project_last_seen.sql');
  const lib = src('src/hubs/modeling/platforms/refm/lib/persistence/lastSeen.ts');
  const route = src('app/api/refm/projects/[id]/last-seen/route.ts');
  const screen = src(SCREEN);
  check('D46 one row per person per project, enforced by the PRIMARY KEY',
    /primary key \(user_id, project_id\)/i.test(mig));
  check('D47 both FKs CASCADE (a marker is not an audit fact and must not outlive either side)',
    (mig.match(/on delete cascade/gi) ?? []).length === 2);
  check('D48 the applier PROVES a second row is impossible and both cascades fire',
    /a SECOND marker for the same person and project is impossible/.test(src('scripts/apply-migration-246.ts'))
    && /deleting the PROJECT removes its markers/.test(src('scripts/apply-migration-246.ts'))
    && /deleting the PERSON removes their markers/.test(src('scripts/apply-migration-246.ts')));
  check('D49 the write is an UPSERT on that key, so it moves the time and never adds a row',
    /onConflict: 'user_id,project_id'/.test(lib));
  check('D50 the user id comes from the SESSION, never the body',
    /const userId = await getRefmUserId\(\)/.test(route) && !/body[\s\S]{0,40}userId/.test(route));
  check('D51 THE SCREEN READS BEFORE IT STAMPS, or the answer is always "nothing new"',
    /const res = await pclient\.getLastSeen\(projectId\)[\s\S]{0,400}pclient\.markProjectSeen\(projectId\)/.test(screen));
  check('D52 a FIRST visit marks nothing as new, rather than flagging the whole history',
    /lastSeenAt !== null && iso > lastSeenAt/.test(screen)
    && /first visit to this project, so nothing is marked as new/.test(screen));
}

// ── D41 to D45: FILTERS SAY WHAT THEY SEARCHED (2026-09-22) ─────────────────
// Filtering is client-side over the page already loaded, which is honest only
// if the screen says so when that page is truncated. A filter that silently
// searches 200 of 5,000 entries and reports "no activity" is a lie by omission.
{
  console.log('\n-- D41..D45 filters, and what they admit to --');
  const panels = src(PANELS);
  check('D41 there are filters for PERSON and VERSION',
    /activity-filter-person/.test(panels) && /activity-filter-version/.test(panels));
  // RE-AIMED 2026-09-24: "present in the page" means present in the rows the
  // page LISTS. Since rows recording no change are counted rather than listed,
  // the lists are built from `shown` (presentChanges' output), or a person whose
  // only rows record nothing would be a filter that returns nothing.
  check('D42 they offer only names and versions PRESENT in the rows listed',
    /const shown = presented\.rows;/.test(panels)
    && /new Set\(shown\.map\(\(c\) => c\.userName\)/.test(panels)
    && /new Set\(shown\.map\(\(c\) => c\.versionId\)/.test(panels));
  check('D43 a filtered view states how many of how many are shown',
    /activity-filter-count/.test(panels) && /\{filtered\.length\} of \{shown\.length\} shown/.test(panels));
  check('D44 a filter matching NOTHING says so, rather than looking like an empty log',
    /activity-filter-empty/.test(panels) && /No activity matches these filters/.test(panels));
  check('D45 and on a TRUNCATED page the filter admits it searched only what is loaded',
    /these filters search only the entries shown/.test(panels)
    && /in the entries loaded so far/.test(panels));
}

// ── D35 to D40: ONE SAVE IS ONE ENTRY (2026-09-22) ──────────────────────────
// A save that touched forty fields wrote forty rows and the screen rendered
// forty rows, so a single edit buried a day's log. Grouped by `save_id`, which
// the appender mints per save. Driven, not grepped: the grouping is the rule.
{
  console.log('\n-- D35..D40 a save groups into one entry --');
  const row = (id: string, saveId: string | null): Parameters<typeof groupBySave>[0][number] =>
    ({ id, saveId, versionId: null, userId: null, userName: 'A', action: 'update',
       path: `p${id}`, label: null, before: 1, after: 2, createdAt: '2026-09-22T10:00:00Z' });
  const g1 = groupBySave([row('1', 's1'), row('2', 's1'), row('3', 's2')]);
  check('D35 rows of one save become ONE group', g1.length === 2 && g1[0].rows.length === 2,
    JSON.stringify(g1.map((g) => g.rows.length)));
  check('D36 and a different save starts a new group', g1[1].rows.length === 1);
  // Pre-245 rows have no save id and must not be lumped together, which would
  // invent a grouping the data does not support.
  const g2 = groupBySave([row('1', null), row('2', null)]);
  check('D37 rows with NO save id stay separate (a save nobody recorded)', g2.length === 2);
  // Order is the log's meaning; grouping must not reorder.
  const g3 = groupBySave([row('1', 's1'), row('2', 's2'), row('3', 's1')]);
  check('D38 a non-contiguous repeat of a save id does NOT reorder the log',
    g3.length === 3, JSON.stringify(g3.map((g) => g.key)));
  const panels = src(PANELS);
  check('D39 a one-change save renders as a plain row, not a disclosure',
    /if \(rows\.length === 1\)/.test(panels) && /return <ActivityRow change=\{rows\[0\]\}/.test(panels));
  check('D40 days collapse with the most recent OPEN by default',
    /openDays\[day\] \?\? dayIdx === 0/.test(panels));
}

// ── D32 to D34: VERSION BOUNDARIES ARE VISIBLE (2026-09-22) ─────────────────
// Each row already carried "in <version>", which is the same words repeated on
// every row of a run and still gave no way to see WHERE one version ended.
{
  console.log('\n-- D32..D34 a version boundary is a line --');
  const panels = src(PANELS);
  // Re-aimed for item 8: the boundary moved from between ROWS to between SAVES,
  // because a save belongs to one version and a per-row test would draw the
  // line INSIDE an expanded group.
  check('D32 a boundary is drawn BETWEEN SAVES when the version differs',
    /saves\[i - 1\]\.rows\[0\]\.versionId !== vid/.test(panels) && /activity-version-boundary/.test(panels));
  check('D33 a version deleted since reads as UNKNOWN, never as another version',
    /Version no longer saved/.test(panels));
  check('D34 and the per-row "in <version>" is kept, so a single row still says where it landed',
    /\{' in '\}\{versionLabel\.get\(change\.versionId\)\}/.test(panels));
}

// ── D28 to D31: A LOG THAT STOPS IS NOT A LOG THAT ENDS (2026-09-22) ────────
// The route has returned `truncated` since it was written and NOTHING read it,
// so on a busy project the list simply ran out at the server's page size and
// the screen implied that was the whole history. Pinned at every link in the
// chain, because the break was that one link silently dropped the field.
{
  console.log('\n-- D28..D31 truncation is surfaced, not swallowed --');
  const route = src(ROUTE);
  const hook = src('src/hubs/modeling/platforms/refm/components/collab/useCollabData.ts');
  const panels = src(PANELS);
  check('D28 the route still REPORTS truncation', /truncated:\s*rows\.length >= limit/.test(route));
  check('D29 the hook CARRIES it rather than dropping it',
    /truncated:\s*res\.data\?\.truncated/.test(hook) && /truncated:\s*ready \? state\.truncated/.test(hook));
  check('D30 the panel SAYS SO when it is true',
    /truncated &&/.test(panels) && /activity-truncated/.test(panels));
  check('D31 and both doors pass it, so neither can stop silently',
    /truncated=\{changesData\.truncated\}/.test(src(SCREEN))
    && /truncated=\{changesData\.truncated\}/.test(src(MODAL)));
}

// ── D25 to D27: AN ASSET IS NAMED BY THE PLATFORM'S RULE (2026-09-22) ───────
// `elementLabel` read `rec['name']`, and `Asset.name` is RETIRED (read by
// nothing, no field to type it in), so an asset add or remove was labelled with
// its raw id in the one place it exists to be readable. Driven through the real
// differ, and the assertion is the RULE (plot, then type) rather than a literal
// string, so `assetLabel` remains free to word itself.
{
  console.log('\n-- D25..D27 an asset is named by where it is and what it is --');
  const arrays = {
    parcels: [{ id: 'pl1', name: 'Land 3', phaseId: 'ph1' }],
    subUnits: [], costLines: [], financingTranches: [], equityContributions: [],
    costOverrides: [], cases: [],
  };
  const withAsset = {
    project: { name: 'P' }, landAllocationMode: 'sqm',
    phases: [{ id: 'ph1', name: 'Phase 1' }],
    ...arrays,
    // The plot lives at landAllocation.parcelId, which is where assetLabel
    // looks; a bare parcelId is not how an asset records its plot.
    assets: [{ id: 'as1', type: '4 Star Hotel', phaseId: 'ph1', landAllocation: { parcelId: 'pl1' } }],
  } as unknown as Parameters<typeof diffSnapshots>[0];
  const without = { ...JSON.parse(JSON.stringify(withAsset)), assets: [] } as typeof withAsset;

  const added = diffSnapshots(without, withAsset).find((e) => e.kind === 'add' && e.path.startsWith('assets['));
  check('D25 an added asset is labelled by its PLOT and TYPE, not its id',
    !!added && /Land 3/.test(added.label ?? '') && /4 Star Hotel/.test(added.label ?? ''),
    added?.label ?? '(no add entry)');
  check('D26 and the label never falls back to the raw asset id',
    !!added && !/as1/.test(added.label ?? ''), added?.label ?? '');
  // Removing the asset AND its plot in one save: the plot must still resolve,
  // which is why the labeller merges both snapshots rather than reading `after`.
  const gone = { ...JSON.parse(JSON.stringify(withAsset)), assets: [], parcels: [] } as typeof withAsset;
  const removed = diffSnapshots(withAsset, gone).find((e) => e.kind === 'remove' && e.path.startsWith('assets['));
  check('D27 an asset removed WITH its plot still names the plot (context is both snapshots)',
    !!removed && /Land 3/.test(removed.label ?? ''), removed?.label ?? '(no remove entry)');
}

// ── D14 to D18: AN ARRAY SAYS WHAT CHANGED (2026-09-22) ─────────────────────
// The chip reported an array as "[N items]", the only thing it knew, so a list
// whose CONTENTS changed while its length did not printed "3 items" on BOTH
// sides: a row that exists because something changed, saying nothing did. No
// check could see it, because every check compared the chip to itself.
{
  console.log('\n-- D14..D18 array values say what moved --');
  const a = [1, 2, 3];
  check('D14 a same-length array with a changed element SAYS SO, not just its length',
    summariseArray([1, 9, 3], a) === '[3 items, 1 changed]', summariseArray([1, 9, 3], a));
  check('D15 and counts EVERY changed element, not just the first',
    summariseArray([9, 9, 3], a) === '[3 items, 2 changed]', summariseArray([9, 9, 3], a));
  check('D16 a genuinely identical array reads as unchanged rather than ambiguous',
    summariseArray([1, 2, 3], a) === '[3 items, unchanged]', summariseArray([1, 2, 3], a));
  check('D17 a different length falls back to the plain count (the length IS the story)',
    summariseArray([1, 2], a) === '[2 items]', summariseArray([1, 2], a));
  check('D18 a non-array counterpart claims no comparison it cannot make',
    summariseArray(a, 'not an array') === '[3 items]', summariseArray(a, 'not an array'));
  // Objects inside an array are compared by value, which is how sub-unit rows
  // and velocity curves actually arrive.
  check('D19 elements are compared BY VALUE, so a repriced row is seen',
    summariseArray([{ id: 'a', price: 2 }], [{ id: 'a', price: 1 }]) === '[1 items, 1 changed]',
    summariseArray([{ id: 'a', price: 2 }], [{ id: 'a', price: 1 }]));
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

console.log('\n=== H. An old row is READ with a sentence, by the rule the differ writes with ===');
{
  // THE RULE (2026-09-24): every row written before the label fix has no stored
  // label and never will (the log is append only). The screen builds the
  // sentence from the PATH, with the same function the differ labels with, and
  // a stored label still wins. Rows that record no change are counted, not
  // shown; a leaf "remove" reads as the clear it was.
  const LABEL = 'src/hubs/modeling/platforms/refm/lib/persistence/changeLabel.ts';
  const DIFF = 'src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff.ts';
  const diffSrc = src(DIFF);

  // H1/H2: ONE rule. The differ builds no sentence of its own any more; it
  // labels every entry through labelForChange in one pass. A second inline
  // label would be a second rule the stored rows are not read with.
  check('H1 the differ labels every entry through labelForChange, in one pass',
    /for \(const e of out\) e\.label = labelForChange\(e, ctx\)/.test(diffSrc));
  check('H2 and builds no label inline anywhere else',
    !/\blabel:\s*[`'"]/.test(diffSrc) && !/\blabel:\s*leafLabel|\blabel:\s*`/.test(diffSrc));

  const phases = [{ id: 'ph1', name: 'Phase 1' }, { id: 'ph2', name: 'Phase 2' }];
  const parcels = [{ id: 'pl1', name: 'Land 1' }];
  const assets = [{ id: 'as1', type: 'Branded Villas', phaseId: 'ph1', landAllocation: { parcelId: 'pl1' } }];
  const subUnits = [{ id: 'su1', assetId: 'as1', name: '2 BR' }];
  const costLines = [{ id: 'construction-bua__ph1', name: 'Construction', phaseId: 'ph1' }];
  const cases = [{ id: 'case_up', name: 'Upside', role: 'scenario', overrides: {} }];
  const project = { assetTypes: [{ id: 'villas', label: 'Branded Villas' }] };
  const ctx = namingContext({ phases, parcels, assets, subUnits, costLines, cases, project });
  const L = (path: string, kind = 'update', before: unknown = 1, after: unknown = 2): string =>
    labelForChange({ path, kind, before, after }, ctx);
  const noRaw = (l: string): boolean => !/\[|=|::|[a-z][A-Z]|\bas1\b|\bsu1\b|\bpl1\b|\bph1\b/.test(l);

  // H3..H9: what an unlabelled stored row now reads as, one per path family.
  const h3 = L('assets[id=as1].buaSqm');
  check('H3 an asset field reads as the asset, by the ONE asset label rule, and the field in words',
    h3 === 'Land 1, Branded Villas, Phase 1: BUA (sqm)', h3);
  const h4 = L('subUnits[id=su1].unitPrice');
  check('H4 a sub-unit is named ON its asset, since "2 BR" alone is ambiguous', h4 === 'Land 1, Branded Villas, Phase 1, 2 BR: Unit price', h4);
  const h5 = L('costOverrides[as1::construction-bua__ph1].value');
  check('H5 a cost override names its line and asset, not its compound key, and the phase once',
    h5 === 'Construction override for Land 1, Branded Villas, Phase 1: Value', h5);
  const h6 = L('cases[case_up].subUnits[id=su1].unitPrice');
  check('H6 a case override reads as the case, then the SAME sentence for its inner path',
    h6 === 'Upside: Land 1, Branded Villas, Phase 1, 2 BR: Unit price', h6);
  const h7 = L('project.assetTypeValues.villas.pricePerSqm', 'add', undefined, 5);
  check('H7 a type value names the type by its label, and "per sqm" reads as words', h7 === 'Asset type Branded Villas: Price per sqm', h7);
  const h8 = L('assets[id=as1].revenue.operate.adrIndexation.rate');
  check('H8 nested sections qualify the field, initialisms kept', h8 === 'Land 1, Branded Villas, Phase 1, revenue operate ADR indexation: Rate', h8);
  const h9 = L('project.fundTerms.hurdleRatePct');
  check('H9 a project section reads as before ("Fund terms: Hurdle rate %")', h9 === 'Fund terms: Hurdle rate %', h9);

  // H10..H12: a record the model no longer holds.
  const gone = L('assets[id=zz9].gfaSqm');
  check('H10 an element nothing can name says so in words, never its id',
    gone === 'Asset no longer in the project: GFA (sqm)' && !/zz9/.test(gone), gone);
  const fromLog = namingContext({ phases, parcels, assets: [], subUnits: [], costLines: [] },
    recordsFromChanges([{ path: 'assets[id=zz9]', before: { id: 'zz9', type: 'Strip Retail', phaseId: 'ph2' }, after: null }]));
  const h11 = labelForChange({ path: 'assets[id=zz9].gfaSqm', kind: 'update', before: 1, after: 2 }, fromLog);
  check('H11 but a deleted element is named from the record its OWN removal row carries', h11 === 'Phase 2, Strip Retail: GFA (sqm)', h11);
  const h12 = L('costLines[id=professional-fee__ph2].rateStated');
  check('H12 a deleted standard cost line is named from its id (base__phase)',
    h12 === 'Professional fee, Phase 2 (no longer in the project): Rate stated', h12);

  // H13: the add / remove / case sentences the differ has always written.
  check('H13 element and case sentences are unchanged ("Added ...", "Case \\"X\\" added", "Case renamed to")',
    L('parcels[id=pl1]', 'remove', { id: 'pl1', name: 'Land 1' }, null) === 'Removed Land 1'
    && L('cases[case_up]', 'add', null, 'Upside') === 'Case "Upside" added'
    && L('cases[case_up].name', 'update', 'Up', 'Upside') === 'Case renamed to "Upside"');

  // H14: the PROPERTY, over every path family above: no raw path survives.
  const all = [h3, h4, h5, h6, h7, h8, h9, gone, h11, h12];
  check('H14 no sentence carries a selector, a compound key, camelCase or an id', all.every(noRaw),
    all.filter((l) => !noRaw(l)).join(' | '));

  // H15..H16: a stored label WINS, and a missing one is built.
  const stored = { action: 'update', path: 'assets[id=as1].buaSqm', label: 'As it was called then', before: 1, after: 2 };
  const bare = { ...stored, label: null };
  const p = presentChanges([stored, bare], ctx, sameValue);
  check('H15 a stored label wins over the render-time one', p.rows[0].label === 'As it was called then', String(p.rows[0].label));
  check('H16 a row with no stored label gets the render-time sentence', p.rows[1].label === h3, String(p.rows[1].label));

  // H17..H19: a row that records no change. BOTH branches, measured: the key
  // reorder is dropped, and a same-length list whose VALUES moved is kept.
  const reorder = { action: 'update', path: 'project.fundTerms.feeDistribution', label: null,
    before: [{ a: 1, b: 2 }], after: [{ b: 2, a: 1 }] };
  const real = { ...reorder, after: [{ a: 1, b: 3 }] };
  const q = presentChanges([reorder, real], ctx, sameValue);
  check('H17 a row whose sides are equal (key order aside) is COUNTED, not shown', q.noChange === 1 && q.rows.length === 1);
  check('H18 and a real change of the same shape is still shown', q.rows[0] === real || q.rows[0].after === real.after);
  check('H19 the array chip no longer calls a key reorder a change',
    summariseArray([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]) === '[1 items, unchanged]');

  // H20..H23: the classification the old differ got wrong, corrected by the
  // differ's own rule, and the one it got right left alone.
  check('H20 a stored "remove" on a FIELD reads as a clear', effectiveKind('remove', 'subUnits[id=su1].parkingRatio') === 'clear');
  check('H21 a stored "remove" of an ELEMENT stays a removal',
    effectiveKind('remove', 'parcels[id=pl1]') === 'remove' && effectiveKind('remove', 'costOverrides[a::b]') === 'remove'
    && effectiveKind('remove', 'project.assetTypes[id=villas]') === 'remove');
  check('H22 a removed CASE stays a removal, a case override dropped is a clear',
    effectiveKind('remove', 'cases[case_up]') === 'remove' && effectiveKind('remove', 'cases[case_up].subUnits[id=su1].unitPrice') === 'clear');
  check('H23 the rule agrees with what the differ WRITES today for a cleared field',
    (() => {
      const b = { project: {}, landAllocationMode: 'sqm', phases, parcels, assets: [{ ...assets[0], parkingArea: 5 }], subUnits: [], costLines: [], financingTranches: [], equityContributions: [], costOverrides: [], cases: [] } as unknown as Parameters<typeof diffSnapshots>[0];
      const a = JSON.parse(JSON.stringify(b)); delete a.assets[0].parkingArea;
      const e = diffSnapshots(b, a)[0];
      return e?.kind === 'clear' && effectiveKind('remove', e.path) === 'clear';
    })());

  // H24..H25: the panel is wired to it, and says what it did not list.
  const panels = src(PANELS);
  // RE-AIMED 2026-09-24: the store read moved into ONE shared hook
  // (useModelNamingContext) so the Version modal and the case switcher name
  // alike; the rule is that the panel's names come from it, with the log's rows.
  check('H24 the Activity panel presents rows through presentChanges, named from the loaded model and the log',
    /presentChanges\(changes, ctx, sameValue\)/.test(panels) && /useModelNamingContext\(changes\)/.test(panels)
    && /recordsFromChanges\(rows\)/.test(panels) && /useModule1Store\(/.test(panels));
  check('H25 rows recording no change are stated on screen, never dropped silently',
    /data-testid="activity-no-change"/.test(panels) && /presented\.noChange/.test(panels));
  check('H26 changeLabel.ts has no em dashes', !src(LABEL).includes('—'));
}

console.log('\n=== I. An absent value is never printed as "null" ===');
{
  // THE RULE (2026-09-24): a stored NULL reads "not set", and where the badge
  // already says the value appeared or went away it is not printed at all.
  // Applied by ONE formatter and ONE pair renderer, wherever a value renders.
  const VT = 'src/hubs/modeling/platforms/refm/lib/persistence/valueText.ts';
  const MODAL_SRC = src(MODAL);
  const panels = src(PANELS);
  const switcher = src('src/hubs/modeling/platforms/refm/components/CaseSwitcher.tsx');

  check('I1 null and undefined read "not set"', formatValue(null) === 'not set' && formatValue(undefined) === 'not set');
  // RE-AIMED 2026-09-24 (founder: values in words): a zero is still a value and
  // a false is still an answer, but they read as words now, and a record is
  // described rather than printed as JSON.
  check('I2 a real value is still a value (0 reads 0, false reads No)',
    formatValue(0) === '0' && formatValue(false) === 'No');
  const obj = formatValue({ a: 1, b: null });
  check('I3 a record never carries "null" inside it, and is not JSON', !/null|[{}"]/.test(obj) && /A 1/.test(obj), obj);

  // Both branches of each verb, measured.
  const eq = (x: { before: boolean; after: boolean }, b: boolean, a: boolean): boolean => x.before === b && x.after === a;
  check('I4 Added from nothing prints only the new value', eq(valueSides('add', null, 5), false, true));
  check('I5 Cleared and Removed to nothing print only the old value',
    eq(valueSides('clear', 5, null), true, false) && eq(valueSides('remove', { id: 'x' }, undefined), true, false));
  check('I6 an Update keeps BOTH sides, an absent one as "not set"',
    eq(valueSides('update', null, 5), true, true) && eq(valueSides('update', 5, null), true, true));
  check('I7 but an Added row that HAD a value keeps it (the verb does not account for it)',
    eq(valueSides('add', 3, 5), true, true));

  // Wherever a value renders: the log, the version modal, the scenario list.
  // RE-AIMED 2026-09-24: the chip now prints what describeChange says, which is
  // the one formatter plus the rule for a list said once.
  check('I8 the chip prints describeChange, and the panel has no private formatter',
    /describeChange\(kind, before, after, \{ field, ctx \}\)/.test(panels) && !/function formatLogValue/.test(panels));
  check('I9 the Activity log and the Version modal both render the pair through ValueChange',
    /<ValueChange kind=\{change\.action\}/.test(panels) && /<ValueChange kind=\{entry\.kind\}/.test(MODAL_SRC)
    && !/<ValueChip/.test(MODAL_SRC));
  check('I10 the scenario override list words its values AND its paths by the same rules',
    /formatValue\(v, \{ field: fieldOf\(path\), ctx \}\)/.test(switcher) && /labelForChange\(\{ path: p/.test(switcher)
    && !/function humanPath/.test(switcher));
  check('I11 no chip prints the literal "null" or the empty-set glyph any more',
    ![panels, MODAL_SRC, switcher].some((s) => /return '(null|∅)'/.test(s)));
  check('I12 valueText.ts has no em dashes', !src(VT).includes('—'));
}

console.log('\n=== J. A value reads as words, never as stored ===');
{
  // THE TEST (founder, 2026-09-24): a reviewer reads the log without knowing
  // how the model stores anything.
  const ctx = namingContext({
    phases: [{ id: 'ph1', name: 'Phase 1' }],
    parcels: [{ id: 'parcel_17', name: 'Land 3' }],
    subUnits: [{ id: 'su1', assetId: 'x', name: '2 BR' }],
    project: { assetTypes: [{ id: 'villas', label: 'Branded Villas' }] },
  });
  const V = (v: unknown, field?: string): string => formatValue(v, { field, ctx });
  check('J1 a string prints WITHOUT quotes', V('Marina Residences', 'name') === 'Marina Residences' && !/"/.test(V('units', 'metric')));
  // The words are the SCREEN'S: read from the label maps the screens render
  // (COST_METHOD_LABELS, TERMINAL_METHOD_LABELS, ...), never a second copy.
  check('J2 a stored option code reads as the words the screen offers for that field',
    V('yoy_compound', 'method') === 'YoY Compound' && V('units', 'metric') === 'Units'
    && V('rate_x_parking_area', 'method') === COST_METHOD_LABELS.rate_x_parking_area
    && V('cap_rate', 'terminalMethod') === TERMINAL_METHOD_LABELS.cap_rate, V('yoy_compound', 'method'));
  check('J2b a code no map knows is still humanised, never printed raw', V('some_new_code', 'x') === 'some new code');
  check('J3 a reference reads as the NAME of what it points at, never the id',
    V('parcel_17', 'parcelId') === 'Land 3' && V('villas', 'assetTypeId') === 'Branded Villas');
  check('J4 a reference to something gone says so, never the id',
    !/parcel_99/.test(V('parcel_99', 'parcelId')) && /no longer in the project/.test(V('parcel_99', 'parcelId')));
  check('J5 a boolean reads Yes / No, a switch On / Off, and a worded choice as the screen words it',
    V(true, 'isCompanion') === 'Yes' && V(false, 'priceStated') === 'No' && V(true, 'enabled') === 'On'
    && V(true, 'instalmentsStopAtHandover') === 'Must finish by handover');
  check('J6 one item is ONE item, not "1 items"', V([{ x: 1 }, { x: 2 }]) === '2 items' && V([{ x: 1 }]) === '1 item');
  check('J7 a short list of numbers is listed', V([0, 25, 45]) === '0, 25, 45');
  const rec = V({ value: 5, lineId: 'contingency__phase_1', method: 'percent_of_selected' }, 'x');
  check('J8 a record is its stated values in words: no JSON, no ids', !/[{}"]|lineId|contingency__/.test(rec) && /Value 5/.test(rec), rec);
  check('J9 an ISO timestamp reads as a date', !/T\d{2}:/.test(V('2026-09-11T17:29:02.095Z', 'changedAt')));

  // A list that changed is said ONCE. Both branches measured.
  const sold = [{ subUnitId: 'su1', preSalesVelocity: [0.05, 0.05] }];
  const sold2 = [{ subUnitId: 'su1', preSalesVelocity: [0.05, 0.1] }];
  const d1 = describeChange('update', sold, sold2, { field: 'subUnits', ctx });
  check('J10 a changed list of records is ONE description naming what moved inside it',
    d1.single !== undefined && d1.before === undefined && /2 BR/.test(d1.single) && /pre sales velocity/i.test(d1.single), JSON.stringify(d1));
  const long = Array.from({ length: 20 }, (_, i) => i);
  const d2 = describeChange('update', long, long.map((v, i) => (i < 3 ? v + 1 : v)));
  check('J11 a long list of the same length is ONE count of what changed', d2.single === '3 of 20 values changed', JSON.stringify(d2));
  const d3 = describeChange('update', [1, 2], [1, 3]);
  check('J12 but a short list keeps both sides, since they DIFFER', d3.before === '1, 2' && d3.after === '1, 3', JSON.stringify(d3));
  const d4 = describeChange('update', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [{ id: 'a', name: 'A' }]);
  check('J13 a record removed from a list is named', d4.single === 'removed B', JSON.stringify(d4));
}

console.log('\n=== G. House rules ===');
{
  for (const f of [MIG, APPLY, LIB, ROUTE, MODAL, CLIENT, PANELS, SCREEN]) {
    check(`G ${f} has no em dashes`, !src(f).includes('—'));
  }
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
if (failed) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
