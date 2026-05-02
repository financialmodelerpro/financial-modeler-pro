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

import { getServerClient } from '@/src/core/db/supabase';
import type {
  RefmProjectRow,
  RefmProjectVersionRow,
  RefmProjectVersionListItem,
} from './types';

const PROJECT_COLS =
  'id, user_id, name, location, status, asset_mix, schema_version, current_version_id, created_at, updated_at';
const VERSION_COLS =
  'id, project_id, version_number, schema_version, snapshot, label, created_at';
const VERSION_LIST_COLS =
  'id, project_id, version_number, schema_version, label, created_at';

// ── refm_projects ───────────────────────────────────────────────────────────
// Returns project rows decorated with `version_count` (computed via a
// second query). Two round-trips per page render is acceptable; the
// alternative (denormalized version_count column on refm_projects with
// trigger upkeep) is more moving parts than the picker UX warrants.
export async function listProjects(userId: string): Promise<{
  rows: Array<RefmProjectRow & { version_count: number }>;
  error: string | null;
}> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_projects')
    .select(PROJECT_COLS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) return { rows: [], error: error.message };

  const projects = (data ?? []) as unknown as RefmProjectRow[];
  if (projects.length === 0) {
    return { rows: [], error: null };
  }

  const projectIds = projects.map(p => p.id);
  const { data: countRows, error: countErr } = await sb
    .from('refm_project_versions')
    .select('project_id')
    .in('project_id', projectIds);
  if (countErr) return { rows: [], error: countErr.message };

  const counts: Record<string, number> = {};
  for (const r of (countRows ?? []) as Array<{ project_id: string }>) {
    counts[r.project_id] = (counts[r.project_id] ?? 0) + 1;
  }

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
  const { data, error } = await sb
    .from('refm_projects')
    .select(PROJECT_COLS)
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data ?? null) as RefmProjectRow | null, error: null };
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
    .select(PROJECT_COLS)
    .single();
  if (error) return { row: null, error: error.message };
  return { row: (data ?? null) as RefmProjectRow | null, error: null };
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
    .select(PROJECT_COLS)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data ?? null) as RefmProjectRow | null, error: null };
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

export async function deleteProject(
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

// ── refm_project_versions ───────────────────────────────────────────────────
export async function getVersionById(
  projectId: string,
  versionId: string,
): Promise<{ row: RefmProjectVersionRow | null; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_project_versions')
    .select(VERSION_COLS)
    .eq('id', versionId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data ?? null) as RefmProjectVersionRow | null, error: null };
}

export async function getLatestVersion(
  projectId: string,
): Promise<{ row: RefmProjectVersionRow | null; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_project_versions')
    .select(VERSION_COLS)
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data ?? null) as RefmProjectVersionRow | null, error: null };
}

export async function listVersions(
  projectId: string,
): Promise<{ rows: RefmProjectVersionListItem[]; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_project_versions')
    .select(VERSION_LIST_COLS)
    .eq('project_id', projectId)
    .order('version_number', { ascending: false });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as unknown as RefmProjectVersionListItem[], error: null };
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
  project_id:     string;
  version_number: number;
  schema_version: number;
  snapshot:       unknown;
  label?:         string | null;
}): Promise<{ row: RefmProjectVersionRow | null; error: string | null }> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('refm_project_versions')
    .insert(insert)
    .select(VERSION_COLS)
    .single();
  if (error) return { row: null, error: error.message };
  return { row: (data ?? null) as RefmProjectVersionRow | null, error: null };
}
