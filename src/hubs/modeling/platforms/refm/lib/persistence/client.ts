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
 * No hard dependency on a specific UI — the store subscriber consumes
 * these directly and bubbles failures through its own state.
 */

import type {
  ProjectStatus,
  RefmProjectListItem,
  RefmProjectVersionRow,
  RefmProjectVersionListItem,
} from './types';
import type { HydrateSnapshot } from '../state/module1-store';

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
  snapshot:  HydrateSnapshot;
  label?:    string | null;
  assetMix?: string[];
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

export function loadVersion(
  projectId: string,
  versionId: string,
): Promise<FetchResult<{ version: RefmProjectVersionRow }>> {
  return callJson(
    `/api/refm/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
    { method: 'GET' },
  );
}
