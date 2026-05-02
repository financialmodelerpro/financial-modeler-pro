/**
 * /api/refm/projects/[id]/duplicate (Phase M1.6/3)
 *
 *   POST → clone a project. Mints a new project with name "Copy of
 *          {original}", same snapshot data (most recent version),
 *          same metadata (location/status/asset_mix/schema_version),
 *          new id + timestamps. The clone gets exactly one version
 *          row (version_number=1), regardless of how many the
 *          original had — version history does not carry over.
 *
 * Auth: NextAuth session required. Ownership of the source project is
 * verified before the clone runs; the new project is owned by the
 * same user.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getProject,
  getVersionById,
  getLatestVersion,
  insertProject,
  insertVersion,
  setProjectCurrentVersion,
  deleteProject,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { id: sourceId } = await ctx.params;

  // Step 1: load source project (with ownership check).
  const { row: source, error: srcErr } = await getProject(userId, sourceId);
  if (srcErr) return serverError(srcErr);
  if (!source) return notFound();

  // Step 2: load the source's current snapshot. Prefer
  // current_version_id; fall back to the most recent version row.
  let snapshot: unknown = null;
  if (source.current_version_id) {
    const { row, error } = await getVersionById(source.id, source.current_version_id);
    if (error) return serverError(error);
    if (row) snapshot = row.snapshot;
  }
  if (!snapshot) {
    const { row, error } = await getLatestVersion(source.id);
    if (error) return serverError(error);
    if (!row) {
      // Project exists but has no version rows — vanishingly rare
      // (M1.6/2 always seeds version 1 alongside the project) but
      // possible if a manual SQL edit pruned versions. Refuse to
      // duplicate an empty project rather than seed an arbitrary
      // default snapshot.
      return serverError('Source project has no snapshot to clone.');
    }
    snapshot = row.snapshot;
  }

  // Step 3: insert the clone project. Same metadata as source, fresh
  // id + timestamps, name prefixed "Copy of ". User can rename via
  // PATCH after.
  const { row: clone, error: cloneErr } = await insertProject({
    user_id:        userId,
    name:           `Copy of ${source.name}`,
    location:       source.location,
    status:         source.status,
    asset_mix:      source.asset_mix,
    schema_version: source.schema_version,
  });
  if (cloneErr || !clone) return serverError(cloneErr ?? 'Failed to create clone.');

  // Step 4: insert the snapshot as version 1 of the clone.
  const { row: cloneVersion, error: verErr } = await insertVersion({
    project_id:     clone.id,
    version_number: 1,
    schema_version: source.schema_version,
    snapshot,
  });
  if (verErr || !cloneVersion) {
    await deleteProject(userId, clone.id);
    return serverError(verErr ?? 'Failed to write clone version.');
  }

  // Step 5: stamp the pointer.
  const { error: ptrErr } = await setProjectCurrentVersion(clone.id, cloneVersion.id);
  if (ptrErr) return serverError(ptrErr);

  // Strip user_id from the response (caller is the owner).
  const { user_id: _u, ...projectOut } = clone;
  return NextResponse.json({
    project: { ...projectOut, current_version_id: cloneVersion.id },
    version: cloneVersion,
  });
}
