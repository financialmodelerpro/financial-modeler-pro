/**
 * /api/refm/projects/[id]/versions/[versionId] (Phase M1.6/3)
 *
 *   GET → load a specific version's snapshot. Used by the version
 *         history UI (VersionModal) when the user picks a non-current
 *         entry from the list.
 *
 * Auth: NextAuth session required. Ownership is verified via the
 * parent project's user_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getProject,
  getVersionById,
} from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
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
