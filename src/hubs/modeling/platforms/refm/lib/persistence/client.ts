/**
 * REFM persistence: browser-side fetch wrappers (Phase M1.6/4).
 *
 * Thin typed-fetch around the /api/refm/projects/* routes. Used by the
 * Module 1 store auto-save subscriber and by RealEstatePlatform.tsx
 * for project-list / load / save / duplicate flows.
 *
 * Each function returns either { data, error: null } or
 * { data: null, error }. Errors are surfaced to the caller; the layer
 * above decides whether to toast / retry / fall back to cache.
 *
 * No hard dependency on a specific UI, the store subscriber consumes
 * these directly and bubbles failures through its own state.
 */

import type {
  ProjectStatus,
  RefmProjectListItem,
  RefmProjectVersionRow,
  RefmProjectVersionListItem,
} from './types';
import type { HydrateSnapshot } from '../state/module1-store';
import type { Party } from '../parties';
import type { ReportInputs } from '../reportInputs';

// Project metadata returned by the API. Same as RefmProjectListItem
// but kept as its own alias so consumers don't need to know the
// internal shape.
export type RefmProjectSummary = RefmProjectListItem;

export interface FetchResult<T> {
  data:  T | null;
  error: string | null;
}

// ── Internal helpers ────────────────────────────────────────────────────────
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch { /* empty / non-json body */ }
  return `${res.status} ${res.statusText}`;
}

async function callJson<T>(
  url: string,
  init?: RequestInit,
): Promise<FetchResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' };
  }
  if (!res.ok) return { data: null, error: await readError(res) };
  try {
    const body = (await res.json()) as T;
    return { data: body, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Invalid JSON response' };
  }
}

// ── Project list / create ───────────────────────────────────────────────────
export function listProjects(): Promise<FetchResult<{ projects: RefmProjectSummary[] }>> {
  return callJson('/api/refm/projects', { method: 'GET' });
}

export interface CreateProjectInput {
  name:      string;
  snapshot:  HydrateSnapshot;
  location?: string | null;
  status?:   ProjectStatus;
  assetMix?: string[];
}

export function createProject(
  input: CreateProjectInput,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow }>> {
  return callJson('/api/refm/projects', {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

// ── Single project: load / patch / delete / duplicate ──────────────────────
export function loadProject(
  projectId: string,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow | null }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}`, { method: 'GET' });
}

export interface PatchProjectInput {
  name?:     string;
  location?: string | null;
  status?:   ProjectStatus;
  assetMix?: string[];
  archived?: boolean;
}

export function patchProject(
  projectId: string,
  patch: PatchProjectInput,
): Promise<FetchResult<{ project: RefmProjectSummary }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body:   JSON.stringify(patch),
  });
}

export function deleteProject(
  projectId: string,
): Promise<FetchResult<{ ok: true }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export function duplicateProject(
  projectId: string,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/duplicate`, {
    method: 'POST',
  });
}

// ── Version history ─────────────────────────────────────────────────────────
export function listVersions(
  projectId: string,
): Promise<FetchResult<{ versions: RefmProjectVersionListItem[] }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/versions`, { method: 'GET' });
}

export interface SaveVersionInput {
  snapshot:       HydrateSnapshot;
  label?:         string | null;
  assetMix?:      string[];
  // 2026-06-01 (auto-naming + required comment). versionLabel is the X.Y
  // string, taskName the user task label, comment the required change note.
  versionLabel?:  string | null;
  taskName?:      string | null;
  comment?:       string | null;
  // 2026-05-31 (Phase M-Versioning): when provided, the server loads
  // this version's snapshot and pre-computes change_log against it
  // so the version-history UI can render the diff without a second
  // round-trip. Passing `null` is the explicit "first version, no
  // base" case.
  baseVersionId?: string | null;
}

export function saveVersion(
  projectId: string,
  input: SaveVersionInput,
): Promise<FetchResult<{ project: RefmProjectSummary; version: RefmProjectVersionRow }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/versions`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

// 2026-05-31 (Phase M-Versioning). In-place version update. Used by
// the session-based auto-save: once the user has named the version
// they're editing, every keystroke PATCHes the same row instead of
// inserting a new one. Server re-computes change_log against the
// row's existing base_version_id on every patch.
export interface PatchVersionInput {
  snapshot?: HydrateSnapshot;
  label?:    string | null;
  assetMix?: string[];
  // 2026-06-03: let an in-place PATCH also apply the auto-naming metadata,
  // so an auto-started session (default "Edits ..." label) can be promoted
  // to a properly named + commented version without inserting a new row.
  versionLabel?: string | null;
  taskName?:     string | null;
  comment?:      string | null;
}

export function patchVersion(
  projectId: string,
  versionId: string,
  input: PatchVersionInput,
): Promise<FetchResult<{ version: RefmProjectVersionRow }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
    {
      method: 'PATCH',
      body:   JSON.stringify(input),
    },
  );
}

export function loadVersion(
  projectId: string,
  versionId: string,
): Promise<FetchResult<{ version: RefmProjectVersionRow }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
    { method: 'GET' },
  );
}

// ── Parties (Module 1, migration 190) ────────────────────────────────────────
// Identity-only per-project parties. Independent of the version snapshot, so
// these do not touch the model engine or the save/version flow.

export function listParties(projectId: string): Promise<FetchResult<{ parties: Party[] }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/parties`, { method: 'GET' });
}

export function createParty(
  projectId: string,
  input: { name: string; identifier?: string | null; roles: string[] },
): Promise<FetchResult<{ party: Party }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/parties`, {
    method: 'POST',
    body:   JSON.stringify(input),
  });
}

export function updateParty(
  projectId: string,
  input: { partyId: string; name?: string; identifier?: string | null; roles?: string[] },
): Promise<FetchResult<{ party: Party }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/parties`, {
    method: 'PATCH',
    body:   JSON.stringify(input),
  });
}

export function deleteParty(projectId: string, partyId: string): Promise<FetchResult<{ ok: true }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/parties?partyId=${encodeURIComponent(partyId)}`,
    { method: 'DELETE' },
  );
}

// ── Report inputs (Module 7 Reports, migration 191) ──────────────────────────
// Per-project presentation / narrative config for the report builder. The engine
// never reads it; financials are pulled live from the snapshot at render time.
// `inputs` is null when none are saved yet (the tab then uses defaults).

export function getReportInputs(projectId: string): Promise<FetchResult<{ inputs: ReportInputs | null }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-inputs`, { method: 'GET' });
}

export function saveReportInputs(projectId: string, inputs: ReportInputs): Promise<FetchResult<{ inputs: ReportInputs }>> {
  return callJson(`/api/refm/projects/${encodeURIComponent(projectId)}/report-inputs`, {
    method: 'PUT',
    body:   JSON.stringify(inputs),
  });
}
