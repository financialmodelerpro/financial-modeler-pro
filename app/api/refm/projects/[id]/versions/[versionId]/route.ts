/**
 * /api/refm/projects/[id]/versions/[versionId] (Phase M1.6/3 +
 *   Phase M-Versioning, 2026-05-31)
 *
 *   GET   → load a specific version's snapshot. Used by the version
 *           history UI (VersionModal) when the user picks a non-current
 *           entry from the list.
 *   PATCH → update an existing version in place (snapshot + label).
 *           Used by the session-based editing flow: once the user has
 *           named a new version they're editing, every auto-save
 *           PATCHes the SAME row instead of inserting a new one, so
 *           a session = one version (not one-version-per-keystroke).
 *           Recomputes change_log against base_version_id on every
 *           PATCH so the diff stored on the row stays in sync with
 *           the snapshot.
 *
 * Auth: NextAuth session required. Ownership is verified via the
 * parent project's user_id on every method.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getProject,
  getVersionById,
  updateProject,
  updateVersion,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { SCHEMA_VERSION } from '@/src/hubs/modeling/platforms/refm/lib/persistence/types';
import type { HydrateSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { diffSnapshots } from '@/src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; versionId: string }> },
) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id: projectId, versionId } = await ctx.params;

  // Verify ownership of the parent project. getVersionById already
  // checks project_id matches, but it does not check user_id, so we
  // do that here.
  const { row: project, error: projErr } = await getProject(userId, projectId);
  if (projErr) return serverError(projErr);
  if (!project) return notFound();

  const { row: version, error: verErr } = await getVersionById(projectId, versionId);
  if (verErr) return serverError(verErr);
  if (!version) return notFound();

  return NextResponse.json({ version });
}

// ── PATCH /api/refm/projects/[id]/versions/[versionId] ─────────────────────
// Body: {
//   snapshot?: HydrateSnapshot,
//   label?:    string | null,
//   assetMix?: string[],
// }
//
// At least one of `snapshot` / `label` is required. When `snapshot`
// changes, the route recomputes change_log against the row's
// existing base_version_id (loaded fresh, not trusted from the
// client) so a polluted diff cannot be persisted by a malicious
// caller. When `assetMix` is provided, the parent project's picker-
// tile cache is refreshed in the same transaction.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; versionId: string }> },
) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id: projectId, versionId } = await ctx.params;

  let body: {
    snapshot?: HydrateSnapshot;
    label?:    string | null;
    assetMix?: string[];
    versionLabel?: string | null;
    taskName?:     string | null;
    comment?:      string | null;
  };
  try { body = await req.json(); }
  catch { return badRequest('Body must be valid JSON.'); }

  if (
    body.snapshot === undefined && body.label === undefined &&
    body.versionLabel === undefined && body.taskName === undefined && body.comment === undefined
  ) {
    return badRequest('At least one of snapshot / label / versionLabel / taskName / comment is required.');
  }

  // Verify ownership of the parent project + load the existing
  // version row in the same step.
  const { row: project, error: projErr } = await getProject(userId, projectId);
  if (projErr) return serverError(projErr);
  if (!project) return notFound();

  const { row: existing, error: verErr } = await getVersionById(projectId, versionId);
  if (verErr) return serverError(verErr);
  if (!existing) return notFound();

  const patch: {
    snapshot?: unknown; change_log?: unknown; label?: string | null;
    version_label?: string | null; task_name?: string | null; comment?: string | null;
  } = {};

  if (body.snapshot !== undefined) {
    patch.snapshot = body.snapshot;
    // Recompute change_log against the row's existing
    // base_version_id, never against a client-supplied value. If the
    // base has been deleted (FK ON DELETE SET NULL), we fall back to
    // an empty diff so the version still records its snapshot even
    // though we can't describe what changed.
    if (existing.base_version_id) {
      const { row: baseVersion, error: baseErr } = await getVersionById(projectId, existing.base_version_id);
      if (baseErr) return serverError(baseErr);
      patch.change_log = baseVersion ? diffSnapshots(baseVersion.snapshot, body.snapshot) : [];
    } else {
      patch.change_log = [];
    }
  }
  if (body.label !== undefined) {
    patch.label = body.label?.trim() ? body.label.trim() : null;
  }
  if (body.versionLabel !== undefined) {
    patch.version_label = body.versionLabel?.trim() ? body.versionLabel.trim() : null;
  }
  if (body.taskName !== undefined) {
    patch.task_name = body.taskName?.trim() ? body.taskName.trim() : null;
  }
  if (body.comment !== undefined) {
    patch.comment = body.comment?.trim() ? body.comment.trim() : null;
  }

  const { row: updatedVersion, error: updErr } = await updateVersion(versionId, patch);
  if (updErr) return serverError(updErr);
  if (!updatedVersion) return notFound();

  // If the caller also passed assetMix, refresh the parent project's
  // picker-tile cache. We do this AFTER the version update so a
  // failure here doesn't roll back the snapshot save (which is the
  // user-data write).
  if (body.assetMix !== undefined) {
    const { error: pErr } = await updateProject(userId, projectId, {
      asset_mix:      body.assetMix,
      schema_version: SCHEMA_VERSION,
    });
    if (pErr && typeof console !== 'undefined') {
      console.warn('[REFM] assetMix update failed (version save succeeded):', pErr);
    }
  }

  return NextResponse.json({ version: updatedVersion });
}
