/**
 * /api/refm/projects/[id]/comments
 *
 *   GET  -> every comment on this project, oldest first.
 *   POST -> a new comment or reply.
 *
 * ── WHO READS, AND WHO WRITES ─────────────────────────────────────────────
 *
 * READING is `getProject`, the one membership choke point, with NO role test
 * after it: ALL FOUR ROLES SEE THE SAME COMMENTS, including a Viewer who may
 * not write one. A review a reviewer cannot read back is not a review, and
 * nothing in a comment is more sensitive than the model it is about, which
 * every member can already open. Same rule the change log follows.
 *
 * WRITING is `getProjectForWrite(userId, id, 'canAddComments')`. That gates on
 * the shared matrix (Owner, Editor and Reviewer may comment; a Viewer may
 * not) and it is the function `verify-project-membership` ENUMERATES, so a
 * write handler that reached for the read resolver would fail the build.
 *
 * THE EDIT LOCK IS NOT INVOLVED, and that is a decision rather than an
 * oversight: `LOCK_REQUIRED` lists the permissions that mutate the MODEL, and
 * `canAddComments` is deliberately absent from it. Two people commenting at
 * once collide over nothing, and requiring the lock would mean a reviewer
 * could not leave a note while the editor had the project open, which is
 * precisely when a review happens.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject, getProjectForWrite } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { listProjectComments, createComment, isOneLevelViolation } from '@/src/hubs/modeling/platforms/refm/lib/persistence/comments';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_BODY = 4000;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row, error: accessErr } = await getProject(userId, id);
  if (accessErr) return NextResponse.json({ error: accessErr }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const asked = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;

  const { rows, tableMissing, error } = await listProjectComments(id, limit);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({
    // A pre-236 database reports comments as unavailable rather than as an
    // empty conversation, so the UI can say "not enabled yet" instead of the
    // false statement "nobody has said anything".
    available: !tableMissing,
    comments: rows,
    // So the client can render its own controls without guessing who it is.
    viewerId: userId,
    limit,
    truncated: rows.length >= limit,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row: project, error: projErr } = await getProjectForWrite(userId, id, 'canAddComments');
  if (projErr) return NextResponse.json({ error: projErr }, { status: 500 });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let payload: { body?: unknown; parentId?: unknown; versionId?: unknown; path?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return NextResponse.json({ error: 'A comment cannot be empty.' }, { status: 400 });
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: `A comment is limited to ${MAX_BODY} characters.` }, { status: 400 });
  }

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const { row, tableMissing, error } = await createComment({
    projectId: id,
    userId,
    body,
    parentId: str(payload.parentId),
    versionId: str(payload.versionId),
    path: str(payload.path),
  });
  if (tableMissing) {
    return NextResponse.json({ error: 'Comments need migration 236. Not saved.' }, { status: 503 });
  }
  // The one-level rule is enforced by the database, so the refusal arrives as
  // an error rather than as a branch here. It is turned into a 409 naming the
  // rule, because "you replied to a reply" is actionable and a 500 is not.
  if (error && isOneLevelViolation({ message: error })) {
    return NextResponse.json({ error: 'Replies are one level deep. Reply to the original comment instead.' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ comment: row }, { status: 201 });
}
