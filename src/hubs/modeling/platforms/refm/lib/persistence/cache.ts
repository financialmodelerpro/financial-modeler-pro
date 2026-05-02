/**
 * REFM persistence: localStorage cache (Phase M1.6/4).
 *
 * Cache-only role: the server is the source of truth (refm_projects +
 * refm_project_versions, migration 149). This cache exists for two
 * reasons:
 *
 *   1. Offline resume. If the user's network drops mid-session the
 *      store can fall back to the last-cached snapshot for the
 *      currently-loaded project.
 *   2. First-paint speed. Hydrating from cache before the /api/refm
 *      load round-trip resolves means the user sees the project
 *      content immediately on tab open.
 *
 * Key namespacing:
 *   - `refm_v2`                (legacy, written by the pre-M1.6
 *                               localStorage-only RealEstatePlatform).
 *                               Read once by the migrator on first
 *                               authenticated load; never written here.
 *                               Deliberately preserved so users can
 *                               manually verify before cleanup.
 *   - `refm_v2_cache_${id}`    (per-project snapshot cache written
 *                               by this module).
 *   - `refm_v2_active`         (last-active project id, used to hydrate
 *                               immediately on tab open).
 *   - `refm_v2_migrated_${u}`  (one-shot flag set by the migrator
 *                               after a successful upload — see
 *                               lib/persistence/migrator.ts).
 *
 * SSR guard: every read / write checks `typeof window` so this module
 * is safe to import from server-side code paths even though it never
 * runs there.
 */

import type { HydrateSnapshot } from '../state/module1-store';

const KEY_PREFIX            = 'refm_v2_cache_';
const KEY_ACTIVE_PROJECT_ID = 'refm_v2_active';
const KEY_MIGRATED_PREFIX   = 'refm_v2_migrated_';

// ── Shape of a single cached entry ──────────────────────────────────────────
// Includes the snapshot itself + a small metadata envelope so we can
// reason about staleness in a future iteration without changing the
// shape (today nothing reads `cachedAt` except devtools).
export interface CachedSnapshot {
  projectId:  string;
  cachedAt:   string;        // ISO timestamp
  snapshot:   HydrateSnapshot;
}

// ── Snapshot cache ──────────────────────────────────────────────────────────
export function readCachedSnapshot(projectId: string): CachedSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw) as CachedSnapshot;
  } catch {
    return null;
  }
}

export function writeCachedSnapshot(projectId: string, snapshot: HydrateSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedSnapshot = {
      projectId,
      cachedAt: new Date().toISOString(),
      snapshot,
    };
    window.localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(entry));
  } catch {
    // Quota exceeded or storage disabled — fail silently. The server
    // is the source of truth, so a missing cache entry just means
    // first-paint pulls from the network.
  }
}

export function clearCachedSnapshot(projectId: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY_PREFIX + projectId); } catch { /* noop */ }
}

// ── Active project id (for first-paint) ─────────────────────────────────────
export function readActiveProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(KEY_ACTIVE_PROJECT_ID); } catch { return null; }
}

export function writeActiveProjectId(projectId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (projectId) window.localStorage.setItem(KEY_ACTIVE_PROJECT_ID, projectId);
    else window.localStorage.removeItem(KEY_ACTIVE_PROJECT_ID);
  } catch { /* noop */ }
}

// ── One-shot migration flag ─────────────────────────────────────────────────
// Set by lib/persistence/migrator.ts after a successful upload so the
// migrator never re-runs for the same user (otherwise a returning user
// who has already migrated would get their server data wiped by a
// re-upload of an old localStorage blob).
export function hasMigrated(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(KEY_MIGRATED_PREFIX + userId) === '1'; }
  catch { return false; }
}

export function markMigrated(userId: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY_MIGRATED_PREFIX + userId, '1'); } catch { /* noop */ }
}
