/**
 * /api/refm/projects/[id]/changes
 *
 *   GET -> this project's append-only change log, newest first.
 *
 * ── WHO SEES IT ───────────────────────────────────────────────────────────
 *
 * ANYONE WHO CAN READ THE PROJECT SEES THE WHOLE LOG. Access is exactly
 * `getProject`, the same single membership choke point every other project
 * sub-resource uses, and there is no role test beyond it: a Viewer sees the
 * same rows an Owner sees.
 *
 * That is deliberate. The log exists so a team can answer "who changed this,
 * and when", and a history that a Reviewer cannot read is one they cannot
 * review against. Nothing in it is more sensitive than the model itself, which
 * every member can already open.
 *
 * AN ADMIN SEES NO MORE THAN A MEMBER on any given project. An admin's extra
 * reach is that `getProject` admits them to more PROJECTS, which is the
 * existing platform-wide rule, not a wider view of any one log. There is no
 * per-row redaction and no admin-only field.
 *
 * There is no POST. Rows are appended by the save path (the version POST and
 * PATCH), never by a client, because a log a client can write into is not an
 * audit trail.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { listProjectChanges } from '@/src/hubs/modeling/platforms/refm/lib/persistence/changeLog';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // THE access check. Membership, resolved in one place.
  const { row, error: accessErr } = await getProject(userId, id);
  if (accessErr) return NextResponse.json({ error: accessErr }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Bounded read: an unbounded one is silently truncated by PostgREST at its
  // own cap (TRAPS 2.1), and a change log is exactly the table that grows past
  // it. A bad `limit` falls back to the default rather than to zero, since
  // Number('abc') is NaN and NaN would otherwise read as "no rows".
  const asked = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;

  const { rows, tableMissing, error } = await listProjectChanges(id, limit);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({
    // A pre-234 database reports the log as unavailable rather than as empty,
    // so the UI can say "not recorded yet" instead of "nothing has changed",
    // which would be a false statement about the project.
    available: !tableMissing,
    changes: rows,
    limit,
    truncated: rows.length >= limit,
  });
}
