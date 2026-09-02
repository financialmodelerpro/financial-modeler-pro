/**
 * REFM persistence: server-side query helpers.
 *
 * The shared `serverClient` in `src/core/db/supabase.ts` is untyped to
 * match the rest of the project's query style. These helpers wrap the
 * common REFM queries so each route doesn't repeat the cast +
 * column-list boilerplate, and so the read shape lands as a typed
 * RefmProjectRow / RefmProjectVersionRow rather than `unknown`.
 *
 * Every query that touches `refm_projects` MUST filter by
 * `user_id = userId`. RLS is defense-in-depth (the SERVICE_ROLE client
 * bypasses it), so the application layer is the actual access boundary.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerClient } from '@/src/core/db/supabase';
import { isProjectRole, roleCan, type ProjectRole, type Permission } from '@/src/core/collab/projectRoles';
import type {
  RefmProjectRow,
  RefmProjectVersionRow,
  RefmProjectVersionListItem,
} from './types';

// The list helpers take an optional trailing client so a verifier can run
// them against an in-memory fake that reproduces PostgREST's row cap.
// Production call sites pass nothing and get the real server client.
type Db = SupabaseClient;

const PROJECT_COLS_BASE =
  'id, user_id, name, location, status, asset_mix, schema_version, current_version_id, created_at, updated_at';
// Migration 161 (2026-06-22) adds the `archived` boolean for the entitlement
// project cap. Tried first; on "column does not exist" we fall back to the
// base list and synthesize archived:false, so the platform keeps working
// before the migration is applied (mirrors the m152 tolerance pattern).
// Migration 229 (2026-09-01) adds `priority` + `sort_order` for card
// ordering. Folded into the SAME probe as `archived` rather than given a
// second one: they land together, a database either has the card columns or
// it does not, and two independent probes would mean four states to reason
// about where only two exist. On a pre-229 database the FULL select fails,
// the base list is used, and `decorateProjectRow` synthesises priority:false
// and sort_order:null, which is exactly the pre-229 ordering (recency).
const PROJECT_COLS_FULL = `${PROJECT_COLS_BASE}, archived, priority, sort_order`;
// Back-compat alias: existing call sites that don't need archived.
const PROJECT_COLS = PROJECT_COLS_BASE;
void PROJECT_COLS;

// Cached after first probe: true once a FULL select succeeds, false once we
// observe the missing-column error.
let archivedApplied: boolean | undefined;

// Migration 224 (2026-08-30) adds `deleted_at` for SOFT DELETE. Every
// user-facing read filters it out (`deleted_at IS NULL`), with the same
// probe-and-fall-back tolerance: on a database without the column the filter
// is dropped and nothing is hidden, which is exactly the pre-224 behaviour.
// Cached like archivedApplied so the cost is one probe per process.
let deletedApplied: boolean | undefined;

/** True when a PostgREST error names the soft-delete column as missing. */
function isMissingDeletedColumn(err: { message: string; code?: string | null } | null): boolean {
  return !!err && isMissingColumnError(err) && /deleted_at/i.test(err.message);
}

function decorateProjectRow<T extends Record<string, unknown>>(row: T | null): T | null {
  if (!row) return row;
  if (!('archived' in row)) (row as Record<string, unknown>).archived = false;
  // priority defaults to false: an un-flagged project. sort_order defaults to
  // NULL, NOT 0, and that distinction carries the whole fallback: null means
  // "never dragged" and sorts by recency, while 0 is a real position at the
  // top of a group. Decorating it to 0 would silently promote every project
  // on a pre-229 database to first place.
  if (!('priority' in row)) (row as Record<string, unknown>).priority = false;
  if (!('sort_order' in row)) (row as Record<string, unknown>).sort_order = null;
  return row;
}
// 2026-05-31 (migration 152): base_version_id + change_log columns added.
// Hotfix 2026-05-31b: kept OUT of the base SELECT lists because production
// Supabase may not yet have migration 152 applied. The widened lists
// (VERSION_COLS_FULL / VERSION_LIST_COLS_FULL) are tried first by every
// helper; on "column does not exist" failure, helpers fall back to the
// base SELECT and synthesize { base_version_id: null, change_log: [] }
// onto the returned row. Once migration 152 is applied the full SELECT
// succeeds and the columns surface naturally; no code change needed.
const VERSION_COLS_BASE =
  'id, project_id, version_number, schema_version, snapshot, label, created_at';
// Migration 153 (2026-06-01) adds version_label / task_name / comment for the
// auto-naming + required-comment flow. Folded into the same FULL tier + the
// same m152Applied probe: if EITHER migration is unapplied the FULL select
// fails and we fall back to BASE, synthesising null defaults via decorate.
// Migration 230 (2026-09-01) adds created_by: WHO SAVED THIS VERSION. Folded
// into the SAME m152Applied probe rather than given a third one. That is a
// deliberate simplification and it costs something worth naming: on a database
// with 152 and 153 but NOT 230, the FULL select fails and every version read
// falls back to BASE, so version_label / task_name / comment read as null
// until 230 is applied. The alternative is a third tier and eight states to
// reason about. Since 230 is applied on production and the fallback is
// degraded-but-correct rather than wrong, one probe is the better trade.
const VERSION_COLS_FULL =
  `${VERSION_COLS_BASE}, base_version_id, change_log, version_label, task_name, comment, created_by`;
const VERSION_LIST_COLS_BASE =
  'id, project_id, version_number, schema_version, label, created_at';
const VERSION_LIST_COLS_FULL =
  `${VERSION_LIST_COLS_BASE}, base_version_id, change_log, version_label, task_name, comment, created_by`;

// Cached after first successful query so each request doesn't probe twice.
// Reset to undefined (= unknown) on module init; flipped to true once a
// FULL select succeeds or false once we observe the missing-column error.
let m152Applied: boolean | undefined;

/**
 * Detects "column does not exist" failures from Supabase / PostgREST.
 * Checks both the human-readable message (regex-based on the typical
 * Postgres wording) AND the SQL state code 42703 (undefined_column),
 * because PostgREST sometimes truncates the message or wraps it in
 * detail / hint, in which case `code` is the only reliable signal.
 *
 * Accepts either a Supabase error object ({ message, code, details, hint })
 * or a bare string for compatibility with existing call sites.
 */
type SupabaseLikeError =
  | string
  | { message?: string | null; code?: string | null; details?: string | null; hint?: string | null }
  | null
  | undefined;

function isMissingColumnError(err: SupabaseLikeError): boolean {
  if (!err) return false;
  if (typeof err === 'string') {
    return /column .* does not exist/i.test(err)
        || /(base_version_id|change_log|version_label|task_name|comment)/i.test(err);
  }
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  const fields = [err.message, err.details, err.hint].filter(Boolean) as string[];
  for (const f of fields) {
    if (/column .* does not exist/i.test(f)) return true;
    if (/(base_version_id|change_log|version_label|task_name|comment).* does not exist/i.test(f)) return true;
    if (/could not find the .* column/i.test(f)) return true;
  }
  return false;
}

// Helper that decorates a row read with the base SELECT with the
// migration-152 fields so callers see a consistent shape regardless of
// whether the migration has been applied yet.
function decorateVersionRow<T extends Record<string, unknown>>(row: T | null): T | null {
  if (!row) return row;
  if (!('base_version_id' in row)) {
    (row as Record<string, unknown>).base_version_id = null;
  }
  if (!('change_log' in row)) {
    (row as Record<string, unknown>).change_log = [];
  }
  for (const k of ['version_label', 'task_name', 'comment']) {
    if (!(k in row)) (row as Record<string, unknown>)[k] = null;
  }
  // created_by (mig 230) decorates to NULL, which is the SAME value a real
  // pre-230 row carries and the same value a deleted author leaves behind.
  // One meaning, "author unknown", reached three ways, so no reader has to
  // distinguish them. It is never decorated to the project owner: that is who
  // owns the project TODAY, not who saved this version.
  if (!('created_by' in row)) (row as Record<string, unknown>).created_by = null;
  return row;
}

// ── refm_projects ───────────────────────────────────────────────────────────
// Page size for every walked read. PostgREST's default `max-rows` is 1000,
// so a page larger than this is silently truncated to 1000 and the walk
// would stop early believing it had reached the end.
const PAGE_SIZE = 1000;
const PROJECT_HARD_CAP = 10_000;

async function listProjectRowsPaginated(
  sb: Db,
  userId: string,
  cols: string,
): Promise<{ rows: Array<Record<string, unknown>>; error: { message: string; code?: string | null } | null }> {
  const out: Array<Record<string, unknown>> = [];
  let from = 0;
  while (from < PROJECT_HARD_CAP) {
    // Soft-deleted projects are hidden from the user entirely (mig 224). The
    // filter is dropped on a pre-224 database, where nothing is deleted.
    const base = () => {
      const q = sb
        .from('refm_projects')
        .select(cols)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      return deletedApplied === false ? q : q.is('deleted_at', null);
    };
    let { data, error } = await base();
    if (error && isMissingDeletedColumn(error)) {
      deletedApplied = false;
      ({ data, error } = await base());
    } else if (!error && deletedApplied === undefined) {
      deletedApplied = true;
    }
    if (error) return { rows: out, error };
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { rows: out, error: null };
}

// Counts versions per project with one EXACT head count per project.
//
// 2026-08-01 correctness fix. This used to be a single unbounded
// `select('project_id').in('project_id', ids)` whose row count WAS the
// answer, which meant PostgREST's 1000-row cap silently became the
// answer instead: on the live database (1,399 version rows for one user,
// 1,397 of them on a single project) the picker rendered ~1,000 versions
// for a project that has 1,397. `head: true` returns NO rows, so the cap
// cannot apply, and `count: 'exact'` is computed by Postgres itself.
// Round trips are per project (bounded by the entitlement project cap)
// and run in parallel batches, and each transfers an empty body.
const COUNT_CONCURRENCY = 8;

async function countVersionsByProject(
  sb: Db,
  projectIds: string[],
): Promise<{ counts: Record<string, number>; error: string | null }> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < projectIds.length; i += COUNT_CONCURRENCY) {
    const batch = projectIds.slice(i, i + COUNT_CONCURRENCY);
    const results = await Promise.all(batch.map(async (projectId) => {
      const { count, error } = await sb
        .from('refm_project_versions')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId);
      return { projectId, count: count ?? 0, error: error?.message ?? null };
    }));
    for (const r of results) {
      if (r.error) return { counts, error: r.error };
      counts[r.projectId] = r.count;
    }
  }
  return { counts, error: null };
}

// Returns project rows decorated with `version_count` (computed via
// separate exact counts). The extra round-trips per page render are
// acceptable; the alternative (denormalized version_count column on
// refm_projects with trigger upkeep) is more moving parts than the
// picker UX warrants.
export async function listProjects(userId: string, sb: Db = getServerClient()): Promise<{
  rows: Array<RefmProjectRow & { version_count: number }>;
  error: string | null;
}> {
  let data: Array<Record<string, unknown>> | null = null;
  if (archivedApplied !== false) {
    const r = await listProjectRowsPaginated(sb, userId, PROJECT_COLS_FULL);
    if (!r.error) { archivedApplied = true; data = r.rows; }
    else if (!isMissingColumnError(r.error)) { return { rows: [], error: r.error.message }; }
    else { archivedApplied = false; }
  }
  if (data === null) {
    const r = await listProjectRowsPaginated(sb, userId, PROJECT_COLS_BASE);
    if (r.error) return { rows: [], error: r.error.message };
    data = r.rows.map((row) => decorateProjectRow(row)) as Array<Record<string, unknown>>;
  }

  let projects = (data ?? []) as unknown as RefmProjectRow[];

  // ── Projects this user is a MEMBER of but does not own (mig 231). ──
  //
  // Fetched as a SECOND read and merged, rather than by widening the first
  // query. PostgREST cannot express "owned OR joined via another table" in
  // one filtered, paginated select without an embedded resource, and the
  // paginated walk above exists because of the 1000-row cap (TRAPS 2.1); a
  // rewrite would have to reproduce that walk for the join. Two reads and a
  // merge is duller and cannot silently truncate.
  //
  // On a single-user account this second read returns the SAME ids the first
  // one did (every owner is an Owner member), so the merge is a no-op and the
  // list is byte-identical to the pre-231 list.
  if (membersApplied !== false) {
    try {
      const owned = new Set(projects.map((p) => p.id));
      const { data: mem, error: memErr } = await sb
        .from('refm_project_members')
        .select('project_id')
        .eq('user_id', userId);
      if (memErr) {
        if (isMissingMembersTable(memErr)) membersApplied = false;
        // Any other failure is swallowed: a membership read that fails must
        // not remove the projects the user already owns. It denies the EXTRA
        // rows, never the base list.
      } else {
        membersApplied = true;
        const extraIds = (mem ?? [])
          .map((r) => (r as { project_id: string }).project_id)
          .filter((id) => !owned.has(id));
        if (extraIds.length) {
          const { rows: extras, error: exErr } = await listProjectRowsByIds(sb, extraIds, PROJECT_COLS_FULL);
          if (!exErr) projects = projects.concat(extras as unknown as RefmProjectRow[]);
        }
      }
    } catch { /* the base list stands */ }
  }

  if (projects.length === 0) {
    return { rows: [], error: null };
  }

  const { counts, error: countErr } = await countVersionsByProject(sb, projects.map(p => p.id));
  if (countErr) return { rows: [], error: countErr };

  // THIS USER's ordering, not the project's (mig 232). One query for the
  // whole list. A project with no membership row for this caller keeps the
  // values the project row carried, which is the pre-232 behaviour and is
  // what a pre-231 database produces.
  const ordering = await memberOrdering(userId, projects.map((p) => p.id), sb);
  const ordered = applyMemberOrdering(projects, ordering);

  return {
    rows: ordered.map(p => ({ ...p, version_count: counts[p.id] ?? 0 })),
    error: null,
  };
}

// ── Membership (mig 231, Module 10 step 2) ────────────────────────────────
//
// Cached like every other migration probe: true once a membership read
// succeeds, false once the table is observed absent. On a pre-231 database
// every reader falls back to the OWNER check, which is exactly the pre-231
// behaviour, so the platform keeps working un-migrated.
let membersApplied: boolean | undefined;

/** True when a PostgREST error means the membership table is not there. */
function isMissingMembersTable(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /refm_project_members/i.test(String(err.message ?? ''));
}

/**
 * This user's role on this project, or null when they have no membership.
 *
 * Returns null rather than throwing on any failure, and every caller treats
 * null as NO ACCESS. That direction is deliberate: a membership read that
 * fails must deny, never grant. The one exception is a database with no
 * membership table at all, which is handled by the caller falling back to the
 * owner check rather than by inventing a role here.
 */
/**
 * Project rows by id, paginated.
 *
 * Paginated for the same reason the owner walk is: PostgREST silently
 * truncates at its `max-rows` cap (TRAPS 2.1), and a member of more projects
 * than the cap would simply stop seeing some of them, with no error anywhere.
 * Soft-deleted rows are excluded here too, with the same drop-the-filter
 * tolerance, so a shared project that its owner deleted disappears for the
 * members as well.
 */
async function listProjectRowsByIds(
  sb: Db,
  ids: readonly string[],
  cols: string,
): Promise<{ rows: Array<Record<string, unknown>>; error: { message: string } | null }> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const slice = ids.slice(i, i + PAGE_SIZE);
    const build = () => {
      // EXPLICITLY BOUNDED. The slice can only match PAGE_SIZE rows because
      // `id` is the primary key, but that bound is invisible at the query site
      // and PostgREST silently truncates an unbounded read at its own cap
      // (TRAPS 2.1). `verify-refm-version-reads` caught this: a read whose
      // safety depends on an invariant a reader cannot see is the exact shape
      // that check exists to reject. The limit states it.
      const q = sb.from('refm_projects').select(cols).in('id', slice).limit(slice.length);
      return deletedApplied === false ? q : q.is('deleted_at', null);
    };
    let { data, error } = await build();
    if (error && isMissingDeletedColumn(error)) {
      deletedApplied = false;
      ({ data, error } = await build());
    }
    if (error) return { rows: out, error };
    out.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
  }
  return { rows: out, error: null };
}

// ── Per-member ordering (mig 232, Module 10 step 3) ──────────────────────
//
// `priority` and `sort_order` moved from the PROJECT row to the MEMBERSHIP
// row: they are properties of one person's relationship to a project, not of
// the project, and two members sharing one column would overwrite each
// other's arrangement. `status` did NOT move and is still read straight off
// the project: a building under construction is under construction for
// everyone.
//
// The ROW SHAPE IS UNCHANGED. `RefmProjectRow` still carries `priority` and
// `sort_order`; only their SOURCE changed, from the project column to this
// caller's membership. That is deliberate, so no client, report or export
// had to learn a new field, and a single-user account sees the same numbers
// through a different join.
let memberOrderApplied: boolean | undefined;

/** True when a PostgREST error names the per-member ordering columns. */
function isMissingMemberOrder(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  return /priority|sort_order/i.test(String(err.message ?? ''));
}

/**
 * This user's ordering AND ROLE for a set of projects, as
 * `{ projectId: {priority, sortOrder, role} }`.
 *
 * The role rides along because it comes from the same row and the list needs
 * it (step 4): the client resolves `can()` from the role it holds on the OPEN
 * project, and each card gates its own actions on its own role. A second
 * query for the same row would be a second thing to keep in step.
 *
 * ONE query for the whole list. Absent from the map means this user holds no
 * membership row for that project, which happens on a pre-231 database where
 * access is still resolved by ownership; the caller then keeps whatever the
 * project row carried, which is the pre-232 behaviour.
 *
 * Never throws. Ordering is a presentation concern and must not be able to
 * fail a project list.
 */
async function memberOrdering(
  userId: string,
  projectIds: readonly string[],
  sb: Db,
): Promise<Record<string, { priority: boolean; sortOrder: number | null; role: ProjectRole | null }>> {
  const out: Record<string, { priority: boolean; sortOrder: number | null; role: ProjectRole | null }> = {};
  if (memberOrderApplied === false || projectIds.length === 0) return out;
  try {
    for (let i = 0; i < projectIds.length; i += PAGE_SIZE) {
      const slice = projectIds.slice(i, i + PAGE_SIZE);
      const { data, error } = await sb
        .from('refm_project_members')
        .select('project_id, priority, sort_order, role')
        .eq('user_id', userId)
        .in('project_id', slice)
        .limit(slice.length);
      if (error) {
        if (isMissingMemberOrder(error) || isMissingMembersTable(error)) memberOrderApplied = false;
        return out;
      }
      for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        out[String(r.project_id)] = {
          priority: r.priority === true,
          // NULL stays NULL. Coercing it to 0 would promote every
          // un-dragged project to the top of its group, which is the
          // absent-value trap 229 already had to avoid once.
          sortOrder: typeof r.sort_order === 'number' ? r.sort_order : null,
          // An unrecognised role reads as null, which every consumer treats
          // as no rights. A value this build does not know is not evidence
          // of entitlement.
          role: isProjectRole(r.role) ? r.role : null,
        };
      }
    }
    memberOrderApplied = true;
  } catch { /* the list stands, unordered */ }
  return out;
}

/** Overlay this user's ordering onto ONE project row. Same rule as the list
 *  overlay, just for a single read (getProject / updateProject). */
async function overlayOne(
  userId: string,
  row: RefmProjectRow,
  sb: Db,
): Promise<RefmProjectRow> {
  const order = await memberOrdering(userId, [row.id], sb);
  return applyMemberOrdering([row], order)[0];
}

/** Overlay this user's ordering AND ROLE onto project rows, in place of the
 *  deprecated project-level columns. A project with no membership row keeps
 *  what it had, which is the pre-232 fallback; its role stays undefined,
 *  which is the pre-231 "reached as owner" case and grants everything. */
function applyMemberOrdering<T extends { id: string; priority: boolean; sort_order: number | null }>(
  rows: T[],
  order: Record<string, { priority: boolean; sortOrder: number | null; role: ProjectRole | null }>,
): Array<T & { role?: ProjectRole | null }> {
  return rows.map((r) => {
    const mine = order[r.id];
    return mine
      ? { ...r, priority: mine.priority, sort_order: mine.sortOrder, role: mine.role }
      : r;
  });
}

export async function getProjectRole(
  userId: string,
  projectId: string,
  sb: Db = getServerClient(),
): Promise<{ role: ProjectRole | null; tableMissing: boolean }> {
  if (membersApplied === false) return { role: null, tableMissing: true };
  try {
    const { data, error } = await sb
      .from('refm_project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (isMissingMembersTable(error)) { membersApplied = false; return { role: null, tableMissing: true }; }
      return { role: null, tableMissing: false };
    }
    membersApplied = true;
    const raw = (data as { role?: unknown } | null)?.role;
    // An unrecognised role denies. A value this build does not know is not
    // evidence of entitlement, and isProjectRole is the same test the UI uses.
    return { role: isProjectRole(raw) ? raw : null, tableMissing: false };
  } catch {
    return { role: null, tableMissing: false };
  }
}

/**
 * MAY THIS ROLE WRITE? Until the edit lock ships (Module 10 step 5) the
 * answer is OWNER ONLY.
 *
 * This is not a placeholder for the permission matrix; it is a deliberate,
 * temporary narrowing that exists for one reason. There is no server-side
 * lock yet: `editMode` is React state and `editingVersionId` is a module
 * variable in module1-sync, both per browser tab, and the autosave PATCHes
 * the same version row every 1.5 seconds. Two people editing one project
 * today means last write wins, silently, with neither told. So membership
 * ships READ-ONLY for everyone who is not the owner, and the window where two
 * people can autosave over each other is never opened.
 *
 * Step 4 replaces this with the real matrix (`roleCan`), and step 5 adds the
 * lock that makes an Editor safe. Widening it before then would be the one
 * mistake this sequencing exists to prevent.
 */
export function roleMayWrite(role: ProjectRole | null): boolean {
  return role === 'owner';
}

/**
 * The project this user may reach, and THE ROLE THEY HOLD ON IT.
 *
 * THE ONE CHOKE POINT. Thirteen routes gate on this call and 404 when it
 * returns nothing, and the version helpers below deliberately do NOT filter
 * by user because they rely on it having run. That concentration is why the
 * switch from ownership to membership is a small change, and it is also why a
 * mistake here would be a large one.
 *
 * Before migration 231 this matched `user_id = me`. It now matches "I hold a
 * membership", which is a SUPERSET: every owner was seeded as an Owner member
 * (mig 231), so a single-user account sees exactly what it saw before.
 *
 * `role` comes back so a caller can gate a write without a second query. A
 * caller that ignores it gets the pre-231 behaviour, which is safe for a READ
 * and is why the reading routes needed no change.
 *
 * PRE-231 DATABASES fall back to the owner check. Not to an open one: with no
 * membership table there is no membership to honour, and the owner check is
 * exactly what the platform did before. Denial is the fallback direction
 * throughout.
 */
export async function getProject(userId: string, projectId: string): Promise<{
  row: RefmProjectRow | null;
  error: string | null;
  /** The caller's role. Null when the project was reached as its owner on a
   *  pre-231 database, so a null role never means "no rights": it means "no
   *  membership table". Callers gate writes with `mayWrite`, not with this. */
  role?: ProjectRole | null;
  /** Whether this caller may WRITE. Owner-only until the edit lock ships;
   *  see roleMayWrite for why. */
  mayWrite?: boolean;
}> {
  const sb = getServerClient();

  // Resolve membership FIRST. On a database with the table, this decides
  // access; without it, we fall through to the historical owner check.
  const { role, tableMissing } = await getProjectRole(userId, projectId, sb);
  const byMembership = !tableMissing;
  if (byMembership && role === null) {
    // No membership: the project does not exist as far as this caller is
    // concerned. Same answer the owner check gave a stranger.
    return { row: null, error: null, role: null, mayWrite: false };
  }

  // A soft-deleted project is gone from the user's world: it must not load,
  // open or accept writes. Same drop-the-filter tolerance as the list.
  const one = async (cols: string) => {
    const build = () => {
      // Scoped by MEMBERSHIP once 231 is applied (the role lookup above
      // already proved it), and by OWNERSHIP before that.
      let q = sb.from('refm_projects').select(cols).eq('id', projectId);
      if (!byMembership) q = q.eq('user_id', userId);
      return (deletedApplied === false ? q : q.is('deleted_at', null)).maybeSingle();
    };
    let r = await build();
    if (r.error && isMissingDeletedColumn(r.error)) {
      deletedApplied = false;
      r = await build();
    } else if (!r.error && deletedApplied === undefined) {
      deletedApplied = true;
    }
    return r;
  };

  if (archivedApplied !== false) {
    const r = await one(PROJECT_COLS_FULL);
    if (!r.error) {
      archivedApplied = true;
      const one = (r.data ?? null) as RefmProjectRow | null;
      return { row: one ? (await overlayOne(userId, one, sb)) : null, error: null, role, mayWrite: byMembership ? roleMayWrite(role) : true };
    }
    if (!isMissingColumnError(r.error)) return { row: null, error: r.error.message };
    archivedApplied = false;
  }
  const { data, error } = await one(PROJECT_COLS_BASE);
  if (error) return { row: null, error: error.message };
  const base = decorateProjectRow(data as Record<string, unknown> | null) as RefmProjectRow | null;
  return { row: base ? (await overlayOne(userId, base, sb)) : null, error: null, role, mayWrite: byMembership ? roleMayWrite(role) : true };
}

export async function insertProject(insert: {
  user_id:        string;
  name:           string;
  location?:      string | null;
  status?:        string;
  asset_mix?:     string[];
  schema_version: number;
}): Promise<{ row: RefmProjectRow | null; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_projects')
    .insert(insert)
    .select(PROJECT_COLS_BASE)
    .single();
  if (error) return { row: null, error: error.message };
  return { row: decorateProjectRow(data as Record<string, unknown> | null) as RefmProjectRow | null, error: null };
}

export async function updateProject(
  userId: string,
  projectId: string,
  patch: Record<string, unknown>,
): Promise<{ row: RefmProjectRow | null; error: string | null }> {
  const sb = getServerClient();
  // SELECT THE FULL COLUMN LIST, not the base one. This returned
  // PROJECT_COLS_BASE and then decorated, so every write echoed back
  // archived:false / priority:false regardless of what had just been stored:
  // a client that trusted the response would show an urgent toggle snapping
  // straight back off. Harmless while nothing read the echo, wrong the moment
  // something did. Same probe-and-fall-back as the list read, so a pre-229
  // database still works and simply gets the decorated defaults.
  const run = (cols: string) => sb
    .from('refm_projects')
    .update(patch)
    .eq('id', projectId)
    .eq('user_id', userId)
    .select(cols)
    .maybeSingle();
  let { data, error } = archivedApplied === false ? await run(PROJECT_COLS_BASE) : await run(PROJECT_COLS_FULL);
  if (error && isMissingColumnError(error)) {
    archivedApplied = false;
    ({ data, error } = await run(PROJECT_COLS_BASE));
  } else if (!error && archivedApplied === undefined) {
    archivedApplied = true;
  }
  if (error) return { row: null, error: error.message };
  return { row: decorateProjectRow(data as Record<string, unknown> | null) as RefmProjectRow | null, error: null };
}

/**
 * Persist a manual card order: a dense sortOrder per project, for ONE status
 * group.
 *
 * Takes the WHOLE group rather than the single moved card. A dense
 * reassignment is what the user is looking at, so it cannot drift; patching
 * one card would leave the other positions to be re-derived identically on
 * both sides, and any disagreement silently reorders someone's page.
 *
 * WRITES THE MEMBERSHIP ROW, not the project (mig 232). The order is this
 * user's, so it is stored against this user: two members of one project keep
 * separate arrangements and cannot overwrite each other. The deprecated
 * project-level column is not written at all any more.
 *
 * OWNERSHIP IS ENFORCED PER ROW, not once for the batch: every update carries
 * an equality on user_id, so a payload naming a project this user holds no
 * membership on updates nothing rather than reordering someone else's
 * dashboard. The ids arrive from a client and are never trusted.
 *
 * Returns the number of rows actually updated, so the caller can tell a
 * partially applied batch (someone else's id, or a deleted project) from a
 * clean one instead of reporting success for a write that moved nothing.
 */
/**
 * Set THIS user's urgent flag on a project (mig 232).
 *
 * Separate from `updateProject`, which writes `refm_projects`. Passing
 * `priority` through that would write the DEPRECATED project-level column:
 * the flag would appear to save, would be shared with every other member,
 * and nothing would read it back. Urgency is a property of this person's
 * relationship to the project, so it is stored against the membership row.
 *
 * Returns whether a row was actually updated, so a caller can tell a
 * successful write from one that matched no membership.
 */
export async function setProjectPriority(
  userId: string,
  projectId: string,
  priority: boolean,
): Promise<{ updated: boolean; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_project_members')
    .update({ priority })
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select('project_id')
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error) || isMissingMembersTable(error)) {
      return { updated: false, error: 'The urgent flag needs migration 232 (refm_project_members.priority). Not saved.' };
    }
    return { updated: false, error: error.message };
  }
  return { updated: !!data, error: null };
}

export async function reorderProjects(
  userId: string,
  order: ReadonlyArray<{ id: string; sortOrder: number }>,
): Promise<{ updated: number; error: string | null }> {
  if (order.length === 0) return { updated: 0, error: null };
  const sb = getServerClient();
  let updated = 0;
  for (const { id, sortOrder } of order) {
    const { data, error } = await sb
      .from('refm_project_members')
      .update({ sort_order: sortOrder })
      .eq('project_id', id)
      .eq('user_id', userId)
      .select('project_id')
      .maybeSingle();
    if (error) {
      // A database without the per-member column has nothing to write.
      // Report it as an honest failure naming the migration rather than
      // pretending the order stuck.
      if (isMissingColumnError(error) || isMissingMembersTable(error)) {
        return { updated, error: 'Card ordering needs migration 232 (refm_project_members.sort_order). Order not saved.' };
      }
      return { updated, error: error.message };
    }
    if (data) updated++;
  }
  return { updated, error: null };
}

/**
 * THE WRITE GATE. Same as getProject, but returns nothing to a caller who may
 * not write, so the route 404s exactly as it would for a stranger.
 *
 * A SEPARATE FUNCTION, not a flag on getProject, and that is the whole point.
 * A boolean option can be forgotten and the route still compiles, still runs,
 * and silently lets a Viewer save. A distinct name can be ENUMERATED: every
 * route file that exports a write verb must call this one, and
 * `verify-project-membership` fails the build if any of them calls plain
 * getProject on its write path. The check is what makes it unforgettable; the
 * naming is what makes the check possible.
 *
 * WHY IT 404s RATHER THAN 403s. A Reviewer who can read the project already
 * knows it exists, so hiding it would be pointless; but these routes are
 * shared with callers who hold no membership at all, and answering 403 there
 * would confirm the project exists to someone who should not know. One answer
 * for both is the safer default, and it matches what every one of these
 * routes already returned before membership existed.
 *
 * Until the edit lock ships (step 5) "may write" means OWNER. See
 * roleMayWrite for why that narrowing is deliberate rather than provisional.
 */
interface GatedProject {
  row: RefmProjectRow | null;
  error: string | null;
  role?: ProjectRole | null;
  /** Set when a real project was found but this caller may not perform the
   *  action, so a route can distinguish "no such project" from "not yours to
   *  change" in a log line without leaking the difference to the caller. */
  readOnly?: boolean;
}

/**
 * A project this caller may perform `need` on, WITHOUT mutating it.
 *
 * For gated READS: exporting a PDF or a deck renders a file and writes
 * nothing, so the missing edit lock has no bearing on it and the owner-only
 * narrowing below does not apply. The MATRIX decides: a Reviewer may export
 * (`canExport` is true for them), a Viewer may not.
 */
export async function getProjectForAction(
  userId: string,
  projectId: string,
  need: Permission,
): Promise<GatedProject> {
  const r = await getProject(userId, projectId);
  if (r.error || !r.row) return r;
  // A null role means the project was reached as its owner on a pre-231
  // database, where there is no membership to consult; the owner holds every
  // permission, so that path allows.
  const allowed = r.role === null || r.role === undefined ? true : roleCan(r.role, need);
  if (!allowed) return { row: null, error: null, role: r.role ?? null, readOnly: true };
  return r;
}

/**
 * A project this caller may MUTATE, for the permission `need`.
 *
 * TWO GATES, AND THEY MEAN DIFFERENT THINGS. Both must pass.
 *
 *   1. THE MATRIX (`roleCan`). This is the real, permanent rule: a Viewer
 *      cannot save because a Viewer has never been able to save, and a
 *      Reviewer cannot edit inputs because reviewing is not editing. Naming
 *      the permission at the call site is what makes this specific: a route
 *      declares what it needs and the matrix answers, instead of every
 *      mutation sharing one blanket "may write".
 *
 *   2. THE OWNER-ONLY NARROWING (`roleMayWrite`). Temporary, and it exists
 *      for one reason: there is no server-side edit lock yet, so two people
 *      editing one project would autosave over each other silently. It comes
 *      out in step 5 when the lock lands, and the matrix alone will decide.
 *
 * Keeping them separate matters. If they were merged, removing the temporary
 * narrowing in step 5 would mean editing the permanent rule, and it would be
 * impossible to see which restriction was which.
 */
export async function getProjectForWrite(
  userId: string,
  projectId: string,
  need: Permission,
): Promise<GatedProject> {
  const r = await getProject(userId, projectId);
  if (r.error || !r.row) return r;
  const role = r.role ?? null;
  // Gate 1: the matrix. A pre-231 owner (null role) holds everything.
  const permitted = role === null ? true : roleCan(role, need);
  // Gate 2: the temporary owner-only narrowing, until the edit lock ships.
  const unlocked = r.mayWrite !== false;
  if (!permitted || !unlocked) {
    return { row: null, error: null, role, readOnly: true };
  }
  return r;
}

// Used by the create flow to stamp current_version_id without going
// through the user_id filter (the project was just inserted; the
// API has already checked ownership). Kept narrow so it isn't an
// arbitrary back-door.
export async function setProjectCurrentVersion(
  projectId: string,
  versionId: string,
): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const { error } = await sb
    .from('refm_projects')
    .update({ current_version_id: versionId })
    .eq('id', projectId);
  return { error: error?.message ?? null };
}

/**
 * HARD delete: removes the row and everything the FK cascades take (versions
 * with their change log, report decks + deck versions, fund terms, parties).
 *
 * TWO call sites only, neither of them a user pressing Delete:
 *   1. the create-rollback in POST /api/refm/projects (a half-created project
 *      the user never saw), and
 *   2. the retention purge, which hard deletes what the 30-day window has
 *      expired on.
 * A user's Delete goes through softDeleteProject.
 */
export async function hardDeleteProject(
  userId: string,
  projectId: string,
): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const { error } = await sb
    .from('refm_projects')
    .delete()
    .eq('id', projectId)
    .eq('user_id', userId);
  return { error: error?.message ?? null };
}

/**
 * SOFT delete (mig 224): stamps deleted_at. The row and every version stay,
 * so the deletion is recoverable for the retention window, but the project is
 * hidden from the user's list, cannot be opened, and leaves the project cap.
 *
 * Returns `unsupported: true` when the column is absent (pre-224), so the
 * caller can refuse honestly rather than reporting a deletion that did not
 * happen. It NEVER silently falls back to a hard delete: a soft delete that
 * quietly became permanent is the one outcome this feature exists to prevent.
 */
export async function softDeleteProject(
  userId: string,
  projectId: string,
  nowIso: string = new Date().toISOString(),
): Promise<{ error: string | null; unsupported?: true }> {
  const sb = getServerClient();
  const { error } = await sb
    .from('refm_projects')
    .update({ deleted_at: nowIso })
    .eq('id', projectId)
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error && isMissingDeletedColumn({ message: error.message, code: error.code })) {
    deletedApplied = false;
    return { error: 'Project deletion is temporarily unavailable.', unsupported: true };
  }
  if (!error) deletedApplied = true;
  return { error: error?.message ?? null };
}

// ── refm_project_versions ───────────────────────────────────────────────────
// Reads use a try-full-then-fall-back-to-base pattern so the platform
// stays functional before migration 152 is applied. Once applied,
// the FULL path succeeds and the cached `m152Applied=true` flag pins
// every subsequent read to the cheap path.
export async function getVersionById(
  projectId: string,
  versionId: string,
): Promise<{ row: RefmProjectVersionRow | null; error: string | null }> {
  const sb = getServerClient();
  if (m152Applied !== false) {
    const { data, error } = await sb
      .from('refm_project_versions')
      .select(VERSION_COLS_FULL)
      .eq('id', versionId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!error) {
      m152Applied = true;
      return { row: (data ?? null) as RefmProjectVersionRow | null, error: null };
    }
    if (!isMissingColumnError(error)) {
      return { row: null, error: error.message };
    }
    m152Applied = false;
  }
  const { data, error } = await sb
    .from('refm_project_versions')
    .select(VERSION_COLS_BASE)
    .eq('id', versionId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: decorateVersionRow(data ?? null) as RefmProjectVersionRow | null, error: null };
}

export async function getLatestVersion(
  projectId: string,
): Promise<{ row: RefmProjectVersionRow | null; error: string | null }> {
  const sb = getServerClient();
  if (m152Applied !== false) {
    const { data, error } = await sb
      .from('refm_project_versions')
      .select(VERSION_COLS_FULL)
      .eq('project_id', projectId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error) {
      m152Applied = true;
      return { row: (data ?? null) as RefmProjectVersionRow | null, error: null };
    }
    if (!isMissingColumnError(error)) {
      return { row: null, error: error.message };
    }
    m152Applied = false;
  }
  const { data, error } = await sb
    .from('refm_project_versions')
    .select(VERSION_COLS_BASE)
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: decorateVersionRow(data ?? null) as RefmProjectVersionRow | null, error: null };
}

// 2026-05-31 hotfix: Supabase / PostgREST's default `max-rows` setting
// caps SELECT responses at 1000 rows unless the request uses `.range()`.
// Users with bloated histories (M1.6 auto-save model could produce
// 1000+ versions per project in a few days of editing) were silently
// losing their OLDEST versions because we returned only the newest
// 1000 ordered DESC. Switching to explicit `.range(0, 9999)` raises the
// ceiling to 10,000; we also paginate via repeated range fetches when
// the page comes back full so genuinely huge histories still surface
// every row. The order remains version_number DESC so newest-first
// rendering in VersionModal is unchanged.
const VERSION_PAGE_SIZE = PAGE_SIZE;
const VERSION_HARD_CAP  = 50_000;

async function listVersionsPaginated(
  sb: Db,
  projectId: string,
  cols: string,
): Promise<{ rows: Array<Record<string, unknown>>; error: string | null }> {
  const out: Array<Record<string, unknown>> = [];
  let from = 0;
  // Pull pages of VERSION_PAGE_SIZE until the response comes back
  // shorter than a full page (= end of table) or we hit the safety cap.
  while (from < VERSION_HARD_CAP) {
    const to = from + VERSION_PAGE_SIZE - 1;
    const { data, error } = await sb
      .from('refm_project_versions')
      .select(cols)
      .eq('project_id', projectId)
      .order('version_number', { ascending: false })
      .range(from, to);
    if (error) return { rows: out, error: error.message };
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    out.push(...page);
    if (page.length < VERSION_PAGE_SIZE) break;
    from += VERSION_PAGE_SIZE;
  }
  return { rows: out, error: null };
}

export async function listVersions(
  projectId: string,
  sb: Db = getServerClient(),
): Promise<{ rows: RefmProjectVersionListItem[]; error: string | null }> {
  if (m152Applied !== false) {
    const { rows, error } = await listVersionsPaginated(sb, projectId, VERSION_LIST_COLS_FULL);
    if (!error) {
      m152Applied = true;
      return { rows: rows as unknown as RefmProjectVersionListItem[], error: null };
    }
    if (!isMissingColumnError(error)) {
      return { rows: [], error };
    }
    m152Applied = false;
  }
  const { rows, error } = await listVersionsPaginated(sb, projectId, VERSION_LIST_COLS_BASE);
  if (error) return { rows: [], error };
  return {
    rows: rows.map((r) => decorateVersionRow(r)) as unknown as RefmProjectVersionListItem[],
    error: null,
  };
}

// Reads MAX(version_number) for the project; callers add 1 to it for
// the next monotonic save. The unique index
// uniq_refm_versions_project_number guarantees no concurrent-save
// collisions even if two browsers race.
/**
 * Display names for a set of author ids, as `{ id: label }`.
 *
 * ONE query for the whole page, not one per row. The version list is read
 * newest-first and every row wants an author, so resolving per row would fire
 * a query per version.
 *
 * An id that resolves to nothing is simply ABSENT from the map, and the caller
 * renders that as an unknown author. It is never filled with the id itself or
 * with the project owner: a uuid is not a name, and the owner is not the
 * author. This is the same "author unknown" state a NULL created_by produces,
 * reached from a different direction (a deleted user whose FK already nulled,
 * or a read that raced a deletion).
 *
 * NEVER THROWS, and that is enforced rather than asserted. The first version
 * took `sb: Db = getServerClient()` as a default parameter, which is evaluated
 * AT CALL TIME and throws outright when SUPABASE_URL is absent: a missing env
 * or a client-construction failure would have escaped the resolver, 500ed the
 * whole versions GET, and taken version history down over a cosmetic
 * decoration. The client is now built INSIDE the try, and every failure path
 * returns an empty map. An author name is a nice-to-have; the list is not.
 */
export async function resolveAuthorNames(
  ids: readonly string[],
  client?: Db,
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  if (unique.length === 0) return {};
  try {
    const sb = client ?? getServerClient();
    const { data, error } = await sb.from('users').select('id, name, email').in('id', unique);
    if (error || !data) return {};
    const out: Record<string, string> = {};
    for (const r of data as Array<{ id: string; name: string | null; email: string | null }>) {
      // Name first, email as the fallback, and nothing at all if neither
      // exists: a blank label is more honest than a uuid nobody can use.
      const label = (r.name ?? '').trim() || (r.email ?? '').trim();
      if (label) out[r.id] = label;
    }
    return out;
  } catch {
    return {};
  }
}

export async function nextVersionNumber(
  projectId: string,
): Promise<{ next: number; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_project_versions')
    .select('version_number')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { next: 1, error: error.message };
  const cur = (data as { version_number?: number } | null)?.version_number ?? 0;
  return { next: cur + 1, error: null };
}

export async function insertVersion(insert: {
  project_id:       string;
  version_number:   number;
  schema_version:   number;
  snapshot:         unknown;
  label?:           string | null;
  base_version_id?: string | null;
  change_log?:      unknown;
  version_label?:   string | null;
  task_name?:       string | null;
  comment?:         string | null;
  /** WHO SAVED IT (mig 230). Undefined leaves it NULL, which reads as an
   *  unknown author rather than being filled in from the project owner. */
  created_by?:      string | null;
}): Promise<{ row: RefmProjectVersionRow | null; error: string | null }> {
  const sb = getServerClient();
  const tryFull = m152Applied !== false;
  if (tryFull) {
    const { data, error } = await sb
      .from('refm_project_versions')
      .insert(insert)
      .select(VERSION_COLS_FULL)
      .single();
    if (!error) {
      m152Applied = true;
      return { row: (data ?? null) as RefmProjectVersionRow | null, error: null };
    }
    if (!isMissingColumnError(error)) {
      return { row: null, error: error.message };
    }
    m152Applied = false;
  }
  // Strip migration-152 fields and retry with base SELECT.
  const { base_version_id: _b, change_log: _c, version_label: _vl, task_name: _tn, comment: _cm, created_by: _cb, ...stripped } = insert;
  void _b; void _c; void _vl; void _tn; void _cm; void _cb;
  const { data, error } = await sb
    .from('refm_project_versions')
    .insert(stripped)
    .select(VERSION_COLS_BASE)
    .single();
  if (error) return { row: null, error: error.message };
  return { row: decorateVersionRow(data ?? null) as RefmProjectVersionRow | null, error: null };
}

// 2026-05-31 (Phase M-Versioning). In-place version update used by
// the session-based editing flow: once the user has named the new
// version they're editing, every autosave PATCHes the same row
// instead of inserting a new one.
//
// Caller is responsible for recomputing change_log against the base
// version's snapshot before calling this; the helper stores whatever
// is passed.
//
// Patch shape is intentionally narrow: only snapshot + change_log +
// label can be updated. version_number, schema_version,
// base_version_id, project_id are immutable from this code path.
export async function updateVersion(
  versionId: string,
  patch: {
    snapshot?:      unknown;
    change_log?:    unknown;
    label?:         string | null;
    version_label?: string | null;
    task_name?:     string | null;
    comment?:       string | null;
  },
): Promise<{ row: RefmProjectVersionRow | null; error: string | null }> {
  const sb = getServerClient();
  if (m152Applied !== false) {
    const { data, error } = await sb
      .from('refm_project_versions')
      .update(patch)
      .eq('id', versionId)
      .select(VERSION_COLS_FULL)
      .maybeSingle();
    if (!error) {
      m152Applied = true;
      return { row: (data ?? null) as RefmProjectVersionRow | null, error: null };
    }
    if (!isMissingColumnError(error)) {
      return { row: null, error: error.message };
    }
    m152Applied = false;
  }
  // Strip migration-152 + migration-153 fields and retry with base SELECT.
  const { change_log: _c, version_label: _vl, task_name: _tn, comment: _cm, ...stripped } = patch;
  void _c; void _vl; void _tn; void _cm;
  const { data, error } = await sb
    .from('refm_project_versions')
    .update(stripped)
    .eq('id', versionId)
    .select(VERSION_COLS_BASE)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: decorateVersionRow(data ?? null) as RefmProjectVersionRow | null, error: null };
}
