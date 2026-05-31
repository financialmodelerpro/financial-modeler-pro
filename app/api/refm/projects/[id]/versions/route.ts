/**
 * /api/refm/projects/[id]/versions (Phase M1.6/3)
 *
 *   GET  → list versions for a project (metadata only, no snapshot
 *          payload). Sorted by version_number DESC for the version
 *          history UI.
 *   POST → save a new version of the project's snapshot. Auto-bumps
 *          refm_projects.current_version_id so the next load reads
 *          this version. Optional `label` and `assetMix` (for the
 *          picker tile) on the body.
 *
 * Auth: NextAuth session required. Ownership of the parent project is
 * verified before any version-level work happens.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getProject,
  getVersionById,
  listVersions,
  insertVersion,
  nextVersionNumber,
  setProjectCurrentVersion,
  updateProject,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { SCHEMA_VERSION } from '@/src/hubs/modeling/platforms/refm/lib/persistence/types';
import type { HydrateSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-store';
import { diffSnapshots } from '@/src/hubs/modeling/platforms/refm/lib/persistence/snapshot-diff';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

// ── GET /api/refm/projects/[id]/versions ────────────────────────────────────
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id: projectId } = await ctx.params;

  // Verify ownership of the parent project before exposing version
  // history.
  const { row: project, error: projErr } = await getProject(userId, projectId);
  if (projErr) return serverError(projErr);
  if (!project) return notFound();

  const { rows, error } = await listVersions(projectId);
  if (error) return serverError(error);
  return NextResponse.json({ versions: rows });
}

// ── POST /api/refm/projects/[id]/versions ───────────────────────────────────
// Body: {
//   snapshot:       HydrateSnapshot,
//   label?:         string | null,
//   assetMix?:      string[],
//   baseVersionId?: string | null,   // (2026-05-31) version this one
//                                    //  branches from; null means
//                                    //  "first version of project".
// }
//
// `assetMix` updates the picker-tile cache on refm_projects in the
// same write, the snapshot is the source of truth, but the cached
// asset_mix avoids the picker having to read every snapshot to render
// the project list.
//
// 2026-05-31 (Phase M-Versioning): when `baseVersionId` is provided
// the route loads that version's snapshot and computes the
// `change_log` diff so the version-history UI can render "what
// changed in this version" without a second fetch. Diff entries are
// stored pre-computed on the row (see migration 152).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id: projectId } = await ctx.params;

  let body: {
    snapshot?:      HydrateSnapshot;
    label?:         string | null;
    assetMix?:      string[];
    baseVersionId?: string | null;
  };
  try { body = await req.json(); }
  catch { return badRequest('Body must be valid JSON.'); }

  if (!body.snapshot) return badRequest('snapshot is required.');

  // Verify ownership of the parent project before writing.
  const { row: project, error: projErr } = await getProject(userId, projectId);
  if (projErr) return serverError(projErr);
  if (!project) return notFound();

  // Resolve base version (if any) and compute change_log against it.
  // baseVersionId === null is the explicit "no base" case for the
  // first version of a project; baseVersionId === undefined means the
  // caller didn't ask for diff tracking (legacy auto-save callers).
  let baseVersionId: string | null = null;
  let changeLog: ReturnType<typeof diffSnapshots> = [];
  if (body.baseVersionId) {
    const { row: baseVersion, error: baseErr } = await getVersionById(projectId, body.baseVersionId);
    if (baseErr) return serverError(baseErr);
    // Tolerate a missing base (race with delete): treat as "no base"
    // rather than 4xx-ing the caller's save.
    if (baseVersion) {
      baseVersionId = baseVersion.id;
      changeLog = diffSnapshots(baseVersion.snapshot, body.snapshot);
    }
  }

  // Read the current MAX(version_number) and write +1. The unique
  // index on (project_id, version_number) guarantees no concurrent
  // duplicate even if two saves race; on collision the second insert
  // returns 23505 and the client retries.
  const { next, error: nextErr } = await nextVersionNumber(projectId);
  if (nextErr) return serverError(nextErr);

  const { row: versionRow, error: insErr } = await insertVersion({
    project_id:      projectId,
    version_number:  next,
    schema_version:  SCHEMA_VERSION,
    snapshot:        body.snapshot,
    label:           body.label?.trim() ? body.label.trim() : null,
    base_version_id: baseVersionId,
    change_log:      changeLog,
  });
  if (insErr || !versionRow) return serverError(insErr ?? 'Failed to insert version.');

  // Bump current_version_id so the next load reads this version. Also
  // refresh asset_mix + schema_version on the project row in the same
  // call so the picker tile reflects the latest snapshot's mix.
  const projectPatch: Record<string, unknown> = {
    current_version_id: versionRow.id,
    schema_version:     SCHEMA_VERSION,
  };
  if (body.assetMix !== undefined) projectPatch.asset_mix = body.assetMix;

  const { row: updatedProject, error: updErr } = await updateProject(userId, projectId, projectPatch);
  if (updErr) return serverError(updErr);

  // updatedProject can be null if the project was deleted between the
  // ownership check and this write (vanishingly unlikely; treat as
  // not-found).
  if (!updatedProject) return notFound();
  const { user_id: _u, ...projectOut } = updatedProject;

  return NextResponse.json({ project: projectOut, version: versionRow });
}
