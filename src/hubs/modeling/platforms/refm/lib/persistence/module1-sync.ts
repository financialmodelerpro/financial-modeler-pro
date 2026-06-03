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
// 2026-05-31 (auto-start refactor): retained as a no-op flag for
// backwards compat with the lifecycle reset sites; replaced as the
// real de-dupe gate by `isStartingSession` below.
let hasFiredNeedsName    = false;
// 2026-05-31 (auto-start refactor): set true while the first-edit
// POST is in flight; the subscriber re-entry no-ops on this so we
// don't fire two POSTs for the same session boot. Cleared by the
// POST resolution AND by every lifecycle reset (attach / detach /
// load / revert) so a project switch can't leave it stuck.
let isStartingSession    = false;

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
  isStartingSession = false;

  // Wire the subscriber AFTER hydrate so the hydrate event itself
  // doesn't trigger the first-edit auto-start or auto-save.
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
  isStartingSession    = false;

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
  isStartingSession    = false;
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
  isStartingSession    = false;
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
  meta?: { versionLabel?: string | null; taskName?: string | null; comment?: string | null },
): Promise<{ versionId: string | null; error: string | null }> {
  if (!activeProjectId) {
    return { versionId: null, error: 'No active project.' };
  }
  if (editingVersionId) {
    // Session already started (typically auto-started on the first edit
    // with a default "Edits ..." label). Treat this as an in-place
    // update of the SAME row rather than inserting a duplicate. When the
    // caller passes naming metadata (the rich create flow), promote the
    // row: apply the auto-generated label + version_label + task_name +
    // comment. Otherwise it is just a free-text relabel.
    const trimmed = label.trim() || editingLabel;
    const patchBody: {
      label?: string | null; versionLabel?: string | null;
      taskName?: string | null; comment?: string | null;
    } = {};
    if (trimmed && trimmed !== editingLabel) patchBody.label = trimmed;
    if (meta?.versionLabel != null) patchBody.versionLabel = meta.versionLabel;
    if (meta?.taskName != null)     patchBody.taskName     = meta.taskName;
    if (meta?.comment != null)      patchBody.comment      = meta.comment;
    if (Object.keys(patchBody).length > 0) {
      const patch = await patchVersion(activeProjectId, editingVersionId, patchBody);
      if (patch.error) return { versionId: editingVersionId, error: patch.error };
      if (patchBody.label) editingLabel = trimmed;
    }
    return { versionId: editingVersionId, error: null };
  }

  const snapshot = extractSnapshot();
  const res = await saveVersion(activeProjectId, {
    snapshot,
    label:         label.trim() || null,
    assetMix:      computeAssetMix(snapshot),
    baseVersionId: sessionBaseVersionId,
    versionLabel:  meta?.versionLabel ?? null,
    taskName:      meta?.taskName ?? null,
    comment:       meta?.comment ?? null,
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
  isStartingSession = false;
  isLoading = false;
}

// ── Default-label helper ───────────────────────────────────────────────────
// Generates "Edits 2026-05-31 14:32"; mirrored by NameVersionModal's
// `defaultSessionLabel()` so the UI banner reads the same string.
function defaultSessionLabel(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `Edits ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ── Store subscriber ────────────────────────────────────────────────────────
// 2026-05-31 (refactor per user request): the first-edit flow no
// longer blocks with a modal. Branches on session state:
//   - VIEWING (no editingVersionId, snapshot matches base): no-op.
//   - VIEWING → first real edit: AUTO-START a session with a default
//     timestamp label, dispatch fmp:refm-session-started so the UI
//     can show a non-blocking banner with a "Rename" button.
//   - EDITING: debounce a PATCH to editingVersionId.
//
// Concurrency: while the auto-start POST is in flight, isStartingSession
// (declared at module-state level near `hasFiredNeedsName`) gates further
// edits so we don't fire two POSTs. Edits made during the in-flight
// window naturally flush via the next PATCH cycle.
function onStoreChange(): void {
  if (isLoading || activeProjectId === null) return;

  // Distinguish snapshot-affecting mutations from UI-only flips
  // (activePhaseId / activeAssetId). The cheap proxy is JSON
  // equality with the last-saved snapshot.
  const snapshot = extractSnapshot();
  const json     = JSON.stringify(snapshot);
  if (json === lastSavedJson) return;

  // First-edit detection: differs from the session base AND no
  // editing version yet. Auto-start a session with a default label.
  if (!editingVersionId) {
    if (isStartingSession) return;  // POST already in flight.
    if (snapshotsEqual(snapshot, sessionBaseSnapshot)) return;
    isStartingSession = true;
    void (async () => {
      const label = defaultSessionLabel();
      const res = await startEditSession(label);
      isStartingSession = false;
      if (res.error) {
        if (typeof console !== 'undefined') {
          console.warn('[REFM] auto-start session failed:', res.error);
        }
        return;
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fmp:refm-session-started', {
          detail: {
            projectId:        activeProjectId,
            versionId:        res.versionId,
            label,
            baseVersionId:    sessionBaseVersionId,
          },
        }));
      }
      // Trigger the auto-save loop so the just-stamped snapshot is
      // sent as a PATCH within DEBOUNCE_MS (covers any edits the
      // user made during the in-flight POST window).
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { void runAutoSave(); }, DEBOUNCE_MS);
    })();
    return;
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
