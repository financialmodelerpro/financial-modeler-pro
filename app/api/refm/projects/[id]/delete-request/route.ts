/**
 * /api/refm/projects/[id]/delete-request
 *
 *   POST -> an Editor asks an admin to delete this project.
 *
 * ── WHY THIS ROUTE EXISTS AT ALL ──────────────────────────────────────────
 *
 * An Editor cannot delete: `canDeleteProject` is Owner-only and the DELETE on
 * the project route refuses them with a 404. Step 9 does not take anything
 * away from anyone; it gives the Editor the one thing they lacked, a way to
 * ASK. The Owner keeps deleting directly, because their delete is already soft
 * and already restorable for 30 days.
 *
 * Gated on `canRequestDelete`, which the shared matrix answers: Editor yes,
 * Reviewer and Viewer no, and OWNER NO. That last one looks inverted and is
 * not: an owner holds `canDeleteProject`, so a request would be a slower road
 * to a place they can already reach, and letting them queue one would put a
 * pending request on a project they can delete out from under it.
 *
 * It uses `getProjectForWrite` because it is the enumerated write gate, and
 * `canRequestDelete` is deliberately absent from `LOCK_REQUIRED`: asking for a
 * delete is not a model edit, and requiring the edit lock would mean an editor
 * could not raise one while somebody had the project open.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProjectForWrite } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { getServerClient } from '@/src/core/db/supabase';
import { createDeleteRequest } from '@/src/shared/admin/deleteRequests';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row: project, error: projErr } = await getProjectForWrite(userId, id, 'canRequestDelete');
  if (projErr) return NextResponse.json({ error: projErr }, { status: 500 });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sb = getServerClient();
  const res = await createDeleteRequest(sb, 'refm', id, userId);
  if (res.unavailable) {
    return NextResponse.json({ error: 'Delete requests need migration 238. Nothing was sent.' }, { status: 503 });
  }
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
  // An existing open request is NOT an error: a second editor asking for the
  // same delete is doing a reasonable thing, and a conflict here would send
  // them to an admin to ask why the button is broken.
  return NextResponse.json({
    ok: true,
    created: res.created,
    alreadyOpen: res.existing,
    message: res.existing
      ? 'A delete request is already open for this project and is waiting on an admin.'
      : 'Your delete request has been sent to an admin.',
  }, { status: res.created ? 201 : 200 });
}
