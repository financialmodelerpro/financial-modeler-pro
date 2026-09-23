/**
 * /api/refm/projects/[id]/last-seen
 *
 *   GET  -> when this person last opened this project (null if never).
 *   POST -> record that they have now opened it.
 *
 * ── TWO CALLS ON PURPOSE ──────────────────────────────────────────────────
 *
 * Opening the Collaborate screen both ANSWERS "what changed since last time"
 * and BECOMES the new last time. If one call did both, the answer would always
 * be "nothing new", which is the whole feature lost to an ordering mistake. So
 * the client READS with the rest of the screen and POSTS only after it has
 * rendered its answer.
 *
 * ── ACCESS ────────────────────────────────────────────────────────────────
 *
 * `getProject`, the same single membership choke point every other project
 * sub-resource uses. No role test beyond it: a marker is per PERSON, so every
 * member has one and nobody can read or move anybody else's. The user id comes
 * from the session, never from the body, so there is no way to stamp another
 * person's marker.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { getLastSeen, markSeen } from '@/src/hubs/modeling/platforms/refm/lib/persistence/lastSeen';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row, error } = await getProject(userId, id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ lastSeenAt: await getLastSeen(userId, id) });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row, error } = await getProject(userId, id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // THE USER ID IS THE SESSION'S. Taking it from the body would let anyone
  // move anyone else's marker, which is small but is still somebody else's
  // state being written by a stranger.
  const { written } = await markSeen(userId, id);
  return NextResponse.json({ written });
}
