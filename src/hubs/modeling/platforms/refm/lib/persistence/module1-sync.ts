/**
 * REFM persistence: Module 1 store ↔ server sync (Phase M1.6/5).
 *
 * Bridges the Zustand `useModule1Store` to the persistence layer. The
 * lifecycle:
 *
 *   attachToProject(projectId)
 *     1. Tries to load the project + current snapshot from /api/refm.
 *     2. On success, hydrates the store and writes the snapshot to
 *        the localStorage cache.
 *     3. On failure, falls back to whatever cached snapshot exists.
 *     4. Subscribes to the store and starts the debounced auto-save
 *        loop (1.5 s after the last change).
 *
 *   detach()
 *     - Unsubscribes, clears the timer, drops the active id. Call
 *       this when the user closes the project (or before
 *       attachToProject for a different project — attach calls
 *       detach() internally for safety).
 *
 *   loadVersionInto(projectId, versionId)
 *     - Hydrates the store from a specific historical version row
 *       without writing a new save. Used by VersionModal's
 *       "load this version" path. Sets the auto-save baseline so
 *       the next user edit triggers a save (which becomes the new
 *       latest version).
 *
 * Locks:
 *   - `isLoading` skips auto-save while we're programmatically
 *     hydrating (otherwise the hydrate event itself would trigger
 *     a save loop back to the server).
 *   - `isSaving` prevents a second save from racing the first; the
 *     subscriber re-arms the timer after a save completes so any
 *     edits made mid-save still flush.
 *   - `lastSavedSnapshotJson` skips no-op saves (e.g. UI-only state
 *     changes that don't alter the HydrateSnapshot fields).
 */

import { useModule1Store, type HydrateSnapshot, DEFAULT_MODULE1_STATE } from '../state/module1-store';
import { hydrationFromAnySnapshot } from '../state/module1-migrate';
import {
  loadProject,
  loadVersion,
  saveVersion,
} from './client';
import {
  readCachedSnapshot,
  writeCachedSnapshot,
  writeActiveProjectId,
} from './cache';

const DEBOUNCE_MS = 1500;

// Module-level state. The sync module is a singleton — there is one
// active project per browser tab.
let activeProjectId: string | null = null;
let unsubscribe:    (() => void) | null = null;
let saveTimer:      ReturnType<typeof setTimeout> | null = null;
let isSaving        = false;
let isLoading       = false;
let lastSavedJson   = '';   // serialized snapshot at last successful save

// ── Snapshot extraction ─────────────────────────────────────────────────────
// Pulls the HydrateSnapshot-shaped subset out of the live store state
// using DEFAULT_MODULE1_STATE's keys as the canonical field list. This
// keeps the field set in lockstep with the store: if a new field is
// added to HydrateSnapshot via DEFAULT_MODULE1_STATE, it automatically
// participates in saves without anyone editing this file.
const SNAPSHOT_KEYS = Object.keys(DEFAULT_MODULE1_STATE) as Array<keyof HydrateSnapshot>;

function extractSnapshot(): HydrateSnapshot {
  const s = useModule1Store.getState();
  const out = {} as HydrateSnapshot;
  for (const k of SNAPSHOT_KEYS) {
    (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

// Picker tile cache: array of visible asset names. Mirrors the
// pre-M1.6 logic in RealEstatePlatform.computeAssetMix().
function computeAssetMix(snapshot: HydrateSnapshot): string[] {
  return snapshot.assets.filter(a => a.visible).map(a => a.name);
}

// ── attach / detach ─────────────────────────────────────────────────────────
export interface AttachResult {
  loaded:   'server' | 'cache' | 'none';
  error:    string | null;
}

export async function attachToProject(projectId: string): Promise<AttachResult> {
  // Tear down any previous project's subscription first.
  detach();

  isLoading       = true;
  activeProjectId = projectId;
  writeActiveProjectId(projectId);

  let loaded: AttachResult['loaded'] = 'none';
  let error:  string | null          = null;

  // Try server first.
  const serverRes = await loadProject(projectId);
  if (serverRes.data?.version) {
    const snap = hydrationFromAnySnapshot(serverRes.data.version.snapshot);
    useModule1Store.getState().hydrate(snap);
    writeCachedSnapshot(projectId, snap);
    lastSavedJson = JSON.stringify(snap);
    loaded = 'server';
  } else {
    // Server miss / network error — fall back to cache.
    error = serverRes.error;
    const cached = readCachedSnapshot(projectId);
    if (cached) {
      const snap = hydrationFromAnySnapshot(cached.snapshot);
      useModule1Store.getState().hydrate(snap);
      lastSavedJson = JSON.stringify(snap);
      loaded = 'cache';
    }
    // If cache also empty: leave the store on whatever it had
    // (likely DEFAULT_MODULE1_STATE). The UI surfaces the error so
    // the user knows the project failed to load.
  }

  // Wire the subscriber AFTER hydrate so the hydrate event itself
  // doesn't trigger a save. (isLoading=true would also block it, but
  // belt-and-braces.)
  unsubscribe = useModule1Store.subscribe(scheduleAutoSave);
  isLoading = false;

  return { loaded, error };
}

/**
 * Attach the auto-save subscriber to a project WITHOUT re-loading its
 * snapshot from the server.
 *
 * Used by the wizard create path (M1.8) and any other flow where the
 * store was just hydrated locally with a known-good snapshot AND that
 * exact snapshot was just persisted server-side. In those cases the
 * round-trip `loadProject` in `attachToProject` is wasteful AND
 * dangerous: `hydrationFromAnySnapshot` requires `version === 3` to
 * recognize a snapshot as "new shape" — wizard / legacy createProject
 * snapshots are bare `HydrateSnapshot` (no version discriminator), so
 * the recogniser falls through to `DEFAULT_MODULE1_STATE`, silently
 * wiping the just-hydrated wizard data (3 assets / 1 plot / sub-units
 * → empty) and dropping the user into an empty Area Program tab.
 *
 * Caller's responsibility: the store must already hold the snapshot
 * the server has saved (call `useModule1Store.getState().hydrate(snap)`
 * before this). The cache mirror is written here so offline-resume on
 * next reload uses the same snapshot.
 */
export function attachToProjectFromLocalSnapshot(
  projectId: string,
  snapshot:  HydrateSnapshot,
): void {
  detach();

  isLoading       = true;
  activeProjectId = projectId;
  writeActiveProjectId(projectId);
  writeCachedSnapshot(projectId, snapshot);
  lastSavedJson = JSON.stringify(snapshot);

  // Subscribe AFTER setting lastSavedJson so the very first store
  // event is a no-op (json === lastSavedJson) — the snapshot is
  // already on the server, no need to immediately re-save.
  unsubscribe = useModule1Store.subscribe(scheduleAutoSave);
  isLoading = false;
}

export function detach(): void {
  if (saveTimer)   { clearTimeout(saveTimer); saveTimer = null; }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  activeProjectId = null;
  isSaving        = false;
  isLoading       = false;
  lastSavedJson   = '';
}

// ── Load a specific historical version into the store ──────────────────────
// Used by VersionModal's "Load this version" action. Replaces the
// current store state without writing a new server-side save; the next
// user edit is what triggers the save (which becomes the latest
// version, branching off the loaded one).
export async function loadVersionInto(
  projectId: string,
  versionId: string,
): Promise<{ error: string | null }> {
  isLoading = true;
  const res = await loadVersion(projectId, versionId);
  if (res.data?.version) {
    const snap = hydrationFromAnySnapshot(res.data.version.snapshot);
    useModule1Store.getState().hydrate(snap);
    writeCachedSnapshot(projectId, snap);
    lastSavedJson = JSON.stringify(snap);
  }
  isLoading = false;
  return { error: res.error };
}

// ── Auto-save plumbing ──────────────────────────────────────────────────────
function scheduleAutoSave(): void {
  if (isLoading || activeProjectId === null) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void runAutoSave(); }, DEBOUNCE_MS);
}

async function runAutoSave(): Promise<void> {
  if (!activeProjectId || isSaving) return;
  const projectId = activeProjectId;

  const snapshot = extractSnapshot();
  const json     = JSON.stringify(snapshot);

  // No-op skip: store updates that don't alter HydrateSnapshot fields
  // (e.g. activeSubProjectId / activePhaseId UI flips) shouldn't write
  // a new version.
  if (json === lastSavedJson) return;

  isSaving = true;

  // Optimistic cache write BEFORE the network call. If the user
  // closes the tab between this write and the server response, the
  // cache still holds the latest state for offline-resume on next
  // open.
  writeCachedSnapshot(projectId, snapshot);

  const res = await saveVersion(projectId, {
    snapshot,
    assetMix: computeAssetMix(snapshot),
  });

  isSaving = false;

  if (res.error) {
    // Don't update lastSavedJson — the next change will retry. The
    // cache write above already happened so the user doesn't lose
    // data while offline.
    if (typeof console !== 'undefined') {
      console.warn('[REFM] auto-save failed:', res.error);
    }
    return;
  }
  lastSavedJson = json;

  // If the user kept editing during the round-trip, the subscriber
  // already re-armed the timer; nothing else to do here.
}

// ── Test / debug surface ────────────────────────────────────────────────────
// Exposed so unit tests and devtools can inspect the sync state
// without poking at module-level vars directly.
export function getActiveProjectIdForDebug(): string | null { return activeProjectId; }
export function isAttachedForDebug(): boolean              { return unsubscribe !== null; }
