/**
 * REFM persistence: Module 1 store ↔ server sync.
 *
 * Lifecycle (Phase M-Versioning, 2026-05-31):
 *
 *   attachToProject(projectId)
 *     1. Loads the project + its current version snapshot.
 *     2. Hydrates the store; captures `sessionBase` (the snapshot
 *        and version id that the session STARTED from).
 *     3. Subscribes to the store. Session is in VIEWING state: no
 *        auto-save will write anywhere yet.
 *
 *   First store mutation
 *     The subscriber notices that the current snapshot differs from
 *     `sessionBase.snapshot`. It does NOT save automatically; it
 *     dispatches a `fmp:refm-session-needs-name` window event so
 *     the UI can open NameVersionModal. Until the user names the
 *     session, every mutation is held in the store (the subscriber
 *     re-fires but stays in WAITING_FOR_NAME).
 *
 *   startEditSession(label)
 *     POSTs a new version with the current snapshot, label, and
 *     `baseVersionId = sessionBase.versionId`. Stores the returned
 *     row id as `editingVersionId` and the session transitions to
 *     EDITING. Subsequent mutations PATCH that same version row
 *     (debounced 1.5 s). One session = one version row.
 *
 *   revertEditSession()
 *     Re-hydrates `sessionBase.snapshot` so the user's first edit
 *     is undone, transitions back to VIEWING. Used by the modal's
 *     Cancel button.
 *
 *   loadVersionInto(projectId, versionId)
 *     Hydrates from a specific historical version row WITHOUT
 *     creating a new save. Re-anchors `sessionBase` to that version.
 *     Used by VersionModal's "Load this version" path.
 *
 *   detach()
 *     Unsubscribes, clears the timer, drops all session state.
 *     Called when the user closes a project or switches to a
 *     different one.
 *
 * State machine:
 *
 *   VIEWING ──first edit──▶ WAITING_FOR_NAME
 *   WAITING_FOR_NAME ──startEditSession──▶ EDITING
 *   WAITING_FOR_NAME ──revertEditSession──▶ VIEWING
 *   EDITING ──store mutation──▶ EDITING (PATCH in place)
 *   * ──detach──▶ (detached)
 *
 * Concurrency locks:
 *   - `isLoading` skips auto-save while we're programmatically
 *     hydrating (otherwise the hydrate event would trigger a save
 *     loop back to the server).
 *   - `isSaving` prevents a second PATCH from racing the first; the
 *     subscriber re-arms the timer after a save completes so any
 *     edits made mid-save still flush.
 *   - `lastSavedJson` skips no-op PATCHes (e.g. UI-only state
 *     changes that don't alter the HydrateSnapshot fields).
 *   - Cross-project save guard: after the PATCH/POST await, we
 *     verify activeProjectId still matches the captured projectId
 *     before updating lastSavedJson, so a switch-mid-save doesn't
 *     pollute the new project's no-op detection.
 */

import { useModule1Store, type HydrateSnapshot, DEFAULT_MODULE1_STATE } from '../state/module1-store';
import { hydrationFromAnySnapshot, hydrationFromAnySnapshotChecked } from '../state/module1-migrate';
import {
  loadProject,
  loadVersion,
  saveVersion,
  patchVersion,
} from './client';
import {
  readCachedSnapshot,
  writeCachedSnapshot,
  writeActiveProjectId,
} from './cache';
import { snapshotsEqual } from './snapshot-diff';

const DEBOUNCE_MS = 1500;

// Module-level state. The sync module is a singleton, one active
// project per browser tab.
let activeProjectId:    string | null = null;
let unsubscribe:        (() => void) | null = null;
let saveTimer:          ReturnType<typeof setTimeout> | null = null;
let isSaving            = false;
let isLoading           = false;
let lastSavedJson       = '';   // serialized snapshot at last successful save
// Session-based versioning state (Phase M-Versioning, 2026-05-31).
let sessionBaseSnapshot: HydrateSnapshot | null = null;
let sessionBaseVersionId: string | null = null;
let editingVersionId:    string | null = null;
let editingLabel:        string | null = null;
let hasFiredNeedsName    = false;  // de-dupe the modal trigger event

// ── Snapshot extraction ─────────────────────────────────────────────────────
const SNAPSHOT_KEYS = Object.keys(DEFAULT_MODULE1_STATE) as Array<keyof HydrateSnapshot>;

function extractSnapshot(): HydrateSnapshot {
  const s = useModule1Store.getState();
  const out = {} as HydrateSnapshot;
  for (const k of SNAPSHOT_KEYS) {
    (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

function computeAssetMix(snapshot: HydrateSnapshot): string[] {
  return snapshot.assets.filter(a => a.visible).map(a => a.name);
}

// ── attach / detach ─────────────────────────────────────────────────────────
export interface AttachResult {
  loaded:   'server' | 'cache' | 'none';
  error:    string | null;
  migrationNotice?: string;
  /** Version row id the session was anchored to (for the
   *  RealEstatePlatform shell to display as the "active version"). */
  versionId?: string | null;
}

export async function attachToProject(projectId: string): Promise<AttachResult> {
  // Tear down any previous project's subscription first.
  detach();

  isLoading       = true;
  activeProjectId = projectId;
  writeActiveProjectId(projectId);

  let loaded: AttachResult['loaded'] = 'none';
  let error:  string | null          = null;
  let migrationNotice: string | undefined;
  let versionId: string | null = null;

  // Try server first.
  const serverRes = await loadProject(projectId);
  if (serverRes.data?.version) {
    const checked = hydrationFromAnySnapshotChecked(serverRes.data.version.snapshot);
    useModule1Store.getState().hydrate(checked.snapshot);
    writeCachedSnapshot(projectId, checked.snapshot);
    lastSavedJson = JSON.stringify(checked.snapshot);
    sessionBaseSnapshot  = checked.snapshot;
    sessionBaseVersionId = serverRes.data.version.id;
    versionId = serverRes.data.version.id;
    loaded = 'server';
    migrationNotice = checked.migrationNotice;
    if (checked.error) error = checked.error;
  } else {
    // Server miss / network error, fall back to cache.
    error = serverRes.error;
    const cached = readCachedSnapshot(projectId);
    if (cached) {
      const checked = hydrationFromAnySnapshotChecked(cached.snapshot);
      useModule1Store.getState().hydrate(checked.snapshot);
      lastSavedJson = JSON.stringify(checked.snapshot);
      sessionBaseSnapshot  = checked.snapshot;
      sessionBaseVersionId = null;  // can't trust cache to know which version
      loaded = 'cache';
      migrationNotice = checked.migrationNotice;
    }
  }

  editingVersionId  = null;
  editingLabel      = null;
  hasFiredNeedsName = false;

  // Wire the subscriber AFTER hydrate so the hydrate event itself
  // doesn't trigger the first-edit modal or auto-save.
  unsubscribe = useModule1Store.subscribe(onStoreChange);
  isLoading = false;

  // M2.0h legacy: if a migration ran on hydrate the v8 snapshot
  // should be persisted. Under the session-based model we surface
  // this as a notice; the user names the session and the save lands
  // through the editing path.
  void migrationNotice;
  return { loaded, error, migrationNotice, versionId };
}

/**
 * Attach the auto-save subscriber to a project WITHOUT re-loading
 * its snapshot from the server. Used by the wizard create path: the
 * store was just hydrated locally with a known-good snapshot AND
 * that exact snapshot was just persisted server-side as version 1.
 */
export function attachToProjectFromLocalSnapshot(
  projectId: string,
  snapshot:  HydrateSnapshot,
  versionId: string | null = null,
): void {
  detach();

  isLoading       = true;
  activeProjectId = projectId;
  writeActiveProjectId(projectId);
  writeCachedSnapshot(projectId, snapshot);
  lastSavedJson        = JSON.stringify(snapshot);
  sessionBaseSnapshot  = snapshot;
  sessionBaseVersionId = versionId;
  editingVersionId     = null;
  editingLabel         = null;
  hasFiredNeedsName    = false;

  // Subscribe AFTER setting lastSavedJson so the very first store
  // event is a no-op (json === lastSavedJson).
  unsubscribe = useModule1Store.subscribe(onStoreChange);
  isLoading = false;
}

export function detach(): void {
  if (saveTimer)   { clearTimeout(saveTimer); saveTimer = null; }
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  activeProjectId      = null;
  isSaving             = false;
  isLoading            = false;
  lastSavedJson        = '';
  sessionBaseSnapshot  = null;
  sessionBaseVersionId = null;
  editingVersionId     = null;
  editingLabel         = null;
  hasFiredNeedsName    = false;
}

// ── Load a specific historical version into the store ──────────────────────
// Re-anchors the session base to the loaded version. The next user
// edit will fire the name-prompt modal again (so historic loads also
// land in their own named version, not silently overwriting the
// loaded one).
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
    lastSavedJson        = JSON.stringify(snap);
    sessionBaseSnapshot  = snap;
    sessionBaseVersionId = res.data.version.id;
    editingVersionId     = null;
    editingLabel         = null;
    hasFiredNeedsName    = false;
  }
  isLoading = false;
  return { error: res.error };
}

// ── Session controls (called from RealEstatePlatform) ───────────────────────

export interface SessionState {
  projectId:        string | null;
  baseVersionId:    string | null;
  editingVersionId: string | null;
  editingLabel:     string | null;
  /** True iff the store currently differs from sessionBaseSnapshot. */
  hasUncommittedEdits: boolean;
}

export function getSessionState(): SessionState {
  return {
    projectId:           activeProjectId,
    baseVersionId:       sessionBaseVersionId,
    editingVersionId,
    editingLabel,
    hasUncommittedEdits: !snapshotsEqual(extractSnapshot(), sessionBaseSnapshot),
  };
}

/**
 * Begin an editing session. Called from the NameVersionModal "Save"
 * button after the user picks a label. POSTs a new version row
 * branched off `sessionBaseVersionId` and stores its id as
 * `editingVersionId` so subsequent autosaves PATCH that row.
 *
 * Returns the new version's id on success (or null on failure).
 */
export async function startEditSession(
  label: string,
): Promise<{ versionId: string | null; error: string | null }> {
  if (!activeProjectId) {
    return { versionId: null, error: 'No active project.' };
  }
  if (editingVersionId) {
    // Session already started (e.g. modal re-opened). Treat as a
    // label rename rather than creating a duplicate row.
    const trimmed = label.trim() || editingLabel;
    if (trimmed && trimmed !== editingLabel) {
      const patch = await patchVersion(activeProjectId, editingVersionId, { label: trimmed });
      if (patch.error) return { versionId: editingVersionId, error: patch.error };
      editingLabel = trimmed;
    }
    return { versionId: editingVersionId, error: null };
  }

  const snapshot = extractSnapshot();
  const res = await saveVersion(activeProjectId, {
    snapshot,
    label:         label.trim() || null,
    assetMix:      computeAssetMix(snapshot),
    baseVersionId: sessionBaseVersionId,
  });
  if (res.error || !res.data) {
    return { versionId: null, error: res.error ?? 'Failed to start edit session.' };
  }
  editingVersionId = res.data.version.id;
  editingLabel     = res.data.version.label;
  lastSavedJson    = JSON.stringify(snapshot);
  // From this point onward, the auto-save subscriber will PATCH this
  // version row in place rather than POSTing new versions.
  return { versionId: editingVersionId, error: null };
}

/**
 * Revert any uncommitted edits back to the session base. Called from
 * the NameVersionModal "Cancel" path.
 */
export function revertEditSession(): void {
  if (!sessionBaseSnapshot) return;
  isLoading = true;
  useModule1Store.getState().hydrate(sessionBaseSnapshot);
  lastSavedJson    = JSON.stringify(sessionBaseSnapshot);
  hasFiredNeedsName = false;
  isLoading = false;
}

// ── Store subscriber ────────────────────────────────────────────────────────
// Called on every Zustand mutation. Branches on session state:
//   - VIEWING (no editingVersionId, snapshot matches base): no-op.
//   - VIEWING → first real edit: fire the 'needs name' event ONCE.
//   - WAITING_FOR_NAME: hold (modal is open; further edits are
//     allowed but won't save until the user picks a name).
//   - EDITING: debounce a PATCH to editingVersionId.
function onStoreChange(): void {
  if (isLoading || activeProjectId === null) return;

  // Distinguish snapshot-affecting mutations from UI-only flips
  // (activePhaseId / activeAssetId). The cheap proxy is JSON
  // equality with the last-saved snapshot; if equal, we don't even
  // need to check sessionBaseSnapshot.
  const snapshot = extractSnapshot();
  const json     = JSON.stringify(snapshot);
  if (json === lastSavedJson) return;

  // First-edit detection: differs from the session base AND no
  // editing version yet. Fire the modal-trigger event exactly once
  // per session; the modal stays mounted until the user dismisses
  // it.
  if (!editingVersionId) {
    if (!hasFiredNeedsName && !snapshotsEqual(snapshot, sessionBaseSnapshot)) {
      hasFiredNeedsName = true;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fmp:refm-session-needs-name', {
          detail: { projectId: activeProjectId, baseVersionId: sessionBaseVersionId },
        }));
      }
    }
    return;  // Until startEditSession runs, no PATCHes go out.
  }

  // EDITING: debounce a PATCH to the editing version row.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void runAutoSave(); }, DEBOUNCE_MS);
}

async function runAutoSave(): Promise<void> {
  if (!activeProjectId || !editingVersionId || isSaving || isLoading) return;
  const projectId = activeProjectId;
  const versionId = editingVersionId;

  const snapshot = extractSnapshot();
  const json     = JSON.stringify(snapshot);
  if (json === lastSavedJson) return;

  isSaving = true;

  // Optimistic cache write BEFORE the network call.
  writeCachedSnapshot(projectId, snapshot);

  const res = await patchVersion(projectId, versionId, {
    snapshot,
    assetMix: computeAssetMix(snapshot),
  });

  // Cross-project save guard (see commit ca5c152). If the user
  // switched away during the PATCH, do not update lastSavedJson.
  if (activeProjectId !== projectId || editingVersionId !== versionId) {
    isSaving = false;
    return;
  }

  isSaving = false;

  if (res.error) {
    if (typeof console !== 'undefined') {
      console.warn('[REFM] auto-save (PATCH) failed:', res.error);
    }
    return;
  }
  lastSavedJson = json;
}

// ── Test / debug surface ────────────────────────────────────────────────────
export function getActiveProjectIdForDebug(): string | null { return activeProjectId; }
export function isAttachedForDebug(): boolean              { return unsubscribe !== null; }
export function getEditingVersionIdForDebug(): string | null { return editingVersionId; }
