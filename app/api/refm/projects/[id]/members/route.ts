/**
 * GET /api/refm/projects/{id}/members
 *
 * WHO HAS ACCESS to this project, for the Module 10 Collaborate screen.
 *
 * READ ONLY, served to ANY member of the project: access is `getProject`, the
 * one membership choke point, with NO role test, the same rule as Activity
 * and Comments (every member sees the same rows; an admin sees no more on a
 * project they can open than a member does). There is deliberately no POST or
 * DELETE here: membership WRITES stay on the admin member route and the
 * holder team engine.
 *
 * No em dashes in this file.
 */

import { NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { listProjectMembers } from '@/src/hubs/modeling/platforms/refm/lib/persistence/members';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row, error: accessErr } = await getProject(userId, id);
  if (accessErr) return NextResponse.json({ error: accessErr }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ownerId = String((row as unknown as { user_id: unknown }).user_id);
  const { available, members, error } = await listProjectMembers(id, ownerId);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ available, members, viewerId: userId });
}
