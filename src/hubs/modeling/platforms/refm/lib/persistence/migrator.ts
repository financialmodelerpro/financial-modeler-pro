/**
 * REFM persistence: legacy localStorage → Supabase migrator (Phase M1.6/6).
 *
 * One-shot, idempotent. Runs on the first authenticated REFM load
 * after the M1.6 ship. If the user has a pre-M1.6 `refm_v2` blob in
 * localStorage AND zero server-side projects, all local projects + all
 * their versions are uploaded to refm_projects + refm_project_versions.
 *
 * After a successful run (even partial — see error policy below), a
 * one-shot flag `refm_v2_migrated_${userId}` is written so the
 * migrator never runs again for that user. This prevents:
 *   - re-uploading and creating duplicate projects on every page load
 *   - clobbering server-side edits with stale local data if the user
 *     keeps the legacy `refm_v2` blob around in localStorage
 *
 * The legacy `refm_v2` key is intentionally NOT deleted by the
 * migrator — the user can manually verify the upload landed before
 * cleanup. A future "Cleanup Legacy Data" admin action can wipe it.
 *
 * Error policy:
 *   - Network / server errors during create / save are reported in
 *     `errors[]` but do NOT abort the run. The migrator best-efforts
 *     each project; failures are surfaced to the caller for toast
 *     display, but the migrated flag is still set so the user
 *     doesn't get the same partial run on every load.
 *   - If the user has zero local projects to migrate, the flag is
 *     set anyway so the migrator doesn't re-check on every load.
 */

import { listProjects, createProject, saveVersion, type CreateProjectInput, type SaveVersionInput } from './client';
import { hasMigrated, markMigrated } from './cache';
import { hydrationFromAnySnapshotChecked } from '../state/module1-migrate';
import { PROJECT_STATUSES, type ProjectStatus } from './types';

// ── Legacy localStorage shape (mirror of pre-M1.6 RealEstatePlatform) ──────
interface LegacyProject {
  name:         string;
  createdAt:    string;
  lastModified: string;
  location:     string;
  status:       string;
  assetMix:     string[];
  versions:     Record<string, { name: string; createdAt: string; data: unknown }>;
}
interface LegacyShape {
  projects:        Record<string, LegacyProject>;
  activeProjectId: string | null;
  activeVersionId: string | null;
}

const LEGACY_KEY = 'refm_v2';

function readLegacyStorage(): LegacyShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LegacyShape;
    if (!parsed || typeof parsed.projects !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeStatus(raw: string): ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(raw)
    ? (raw as ProjectStatus)
    : 'Draft';
}

// ── Result shape ────────────────────────────────────────────────────────────
export interface MigrationResult {
  ran:             boolean;   // true if upload work actually executed
  projectsTotal:   number;    // local projects considered
  projectsCreated: number;    // server projects successfully created
  versionsCreated: number;    // total version rows successfully created
  errors:          string[];  // human-readable per-failure messages
}

const NO_OP_RESULT: MigrationResult = {
  ran: false, projectsTotal: 0, projectsCreated: 0, versionsCreated: 0, errors: [],
};

// ── Entry point ─────────────────────────────────────────────────────────────
export async function runOneShotMigration(userId: string): Promise<MigrationResult> {
  // Idempotency gate.
  if (hasMigrated(userId)) return NO_OP_RESULT;

  // 1. Read the legacy blob.
  const legacy = readLegacyStorage();
  const localProjects = legacy ? Object.values(legacy.projects) : [];
  if (localProjects.length === 0) {
    // Nothing to do; mark to avoid re-checking on every load.
    markMigrated(userId);
    return NO_OP_RESULT;
  }

  // 2. Defensive: if the user already has server-side projects,
  //    abort the upload. The user may have signed in on this device
  //    after starting fresh on the server elsewhere; we'd rather
  //    leave the legacy blob untouched than create duplicates.
  const list = await listProjects();
  if (list.error) {
    // Couldn't talk to the server — don't mark, retry on next load.
    return { ...NO_OP_RESULT, errors: [`Migration check failed: ${list.error}`] };
  }
  if ((list.data?.projects?.length ?? 0) > 0) {
    markMigrated(userId);
    return NO_OP_RESULT;
  }

  // 3. Upload each project. Versions for one project are walked in
  //    chronological order so the oldest snapshot becomes
  //    version_number=1, the next becomes 2, etc. Project names that
  //    collide land as separate projects (the server has no unique
  //    constraint on (user_id, name)); the user can rename / merge
  //    after the migration.
  const result: MigrationResult = {
    ran: true,
    projectsTotal: localProjects.length,
    projectsCreated: 0,
    versionsCreated: 0,
    errors: [],
  };

  for (const proj of localProjects) {
    const versionEntries = Object.entries(proj.versions ?? {});
    if (versionEntries.length === 0) {
      result.errors.push(`Project "${proj.name}": no versions to migrate; skipped.`);
      continue;
    }

    // Sort by createdAt ascending so version_number ordering matches
    // chronology.
    versionEntries.sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));

    // Seed createProject with the OLDEST version's snapshot. This
    // becomes version_number=1 of the server project.
    //
    // M1.6/7: hydrationFromAnySnapshotChecked surfaces unrecognized
    // shapes as `recognized: false` instead of silently substituting
    // defaults. We still upload the (defaulted) snapshot — better to
    // preserve project + label + subsequent versions than skip the
    // whole project — but we tell the user via result.errors so the
    // post-migration toast doesn't claim a clean success.
    const [firstVersionId, firstVersion] = versionEntries[0];
    const firstHydration = hydrationFromAnySnapshotChecked(firstVersion.data);
    if (!firstHydration.recognized) {
      result.errors.push(
        `Project "${proj.name}" version "${firstVersion.name}": snapshot shape unrecognized; ` +
        `uploaded as defaults (likely lost data).`
      );
    }
    const firstSnapshot = firstHydration.snapshot;

    const createInput: CreateProjectInput = {
      name:     proj.name,
      snapshot: firstSnapshot,
      location: proj.location || null,
      status:   normalizeStatus(proj.status),
      assetMix: Array.isArray(proj.assetMix) ? proj.assetMix : [],
    };

    const created = await createProject(createInput);
    if (created.error || !created.data) {
      result.errors.push(`Project "${proj.name}": create failed (${created.error ?? 'no data'}); skipped.`);
      continue;
    }
    result.projectsCreated += 1;
    result.versionsCreated += 1;
    const newProjectId = created.data.project.id;

    // Walk remaining versions and save each one. Label propagates so
    // VersionModal still shows the user's original names. Same
    // recognized-flag handling as the first version above.
    for (let i = 1; i < versionEntries.length; i++) {
      const [, ver] = versionEntries[i];
      const hydration = hydrationFromAnySnapshotChecked(ver.data);
      if (!hydration.recognized) {
        result.errors.push(
          `Project "${proj.name}" version "${ver.name}": snapshot shape unrecognized; ` +
          `uploaded as defaults (likely lost data).`
        );
      }

      const saveInput: SaveVersionInput = {
        snapshot: hydration.snapshot,
        label:    ver.name?.trim() || null,
      };
      const saved = await saveVersion(newProjectId, saveInput);
      if (saved.error) {
        result.errors.push(`Project "${proj.name}" version "${ver.name}": save failed (${saved.error}); skipped.`);
        continue;
      }
      result.versionsCreated += 1;
    }
    void firstVersionId;  // kept for symmetry / future logging
  }

  // 4. Mark migrated even on partial failure — the user can re-run
  //    selectively if needed via a future admin tool, but we don't
  //    want the migrator firing on every load and creating
  //    duplicates of any project that DID succeed.
  markMigrated(userId);

  return result;
}
