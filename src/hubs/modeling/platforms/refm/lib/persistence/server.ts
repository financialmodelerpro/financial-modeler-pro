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
const PROJECT_COLS_FULL = `${PROJECT_COLS_BASE}, archived`;
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
const VERSION_COLS_FULL =
  `${VERSION_COLS_BASE}, base_version_id, change_log, version_label, task_name, comment`;
const VERSION_LIST_COLS_BASE =
  'id, project_id, version_number, schema_version, label, created_at';
const VERSION_LIST_COLS_FULL =
  `${VERSION_LIST_COLS_BASE}, base_version_id, change_log, version_label, task_name, comment`;

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

  const projects = (data ?? []) as unknown as RefmProjectRow[];
  if (projects.length === 0) {
    return { rows: [], error: null };
  }

  const { counts, error: countErr } = await countVersionsByProject(sb, projects.map(p => p.id));
  if (countErr) return { rows: [], error: countErr };

  return {
    rows: projects.map(p => ({ ...p, version_count: counts[p.id] ?? 0 })),
    error: null,
  };
}

export async function getProject(userId: string, projectId: string): Promise<{
  row: RefmProjectRow | null;
  error: string | null;
}> {
  const sb = getServerClient();
  // A soft-deleted project is gone from the user's world: it must not load,
  // open or accept writes. Same drop-the-filter tolerance as the list.
  const one = async (cols: string) => {
    const build = () => {
      const q = sb.from('refm_projects').select(cols).eq('id', projectId).eq('user_id', userId);
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
    if (!r.error) { archivedApplied = true; return { row: (r.data ?? null) as RefmProjectRow | null, error: null }; }
    if (!isMissingColumnError(r.error)) return { row: null, error: r.error.message };
    archivedApplied = false;
  }
  const { data, error } = await one(PROJECT_COLS_BASE);
  if (error) return { row: null, error: error.message };
  return { row: decorateProjectRow(data as Record<string, unknown> | null) as RefmProjectRow | null, error: null };
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
  const { data, error } = await sb
    .from('refm_projects')
    .update(patch)
    .eq('id', projectId)
    .eq('user_id', userId)
    .select(PROJECT_COLS_BASE)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: decorateProjectRow(data as Record<string, unknown> | null) as RefmProjectRow | null, error: null };
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
  const { base_version_id: _b, change_log: _c, version_label: _vl, task_name: _tn, comment: _cm, ...stripped } = insert;
  void _b; void _c; void _vl; void _tn; void _cm;
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
