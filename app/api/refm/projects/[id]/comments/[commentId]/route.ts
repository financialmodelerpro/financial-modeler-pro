/**
 * /api/refm/projects/[id]/comments/[commentId]
 *
 *   PATCH  -> edit the body (AUTHOR ONLY), or resolve / unresolve a thread
 *             (anyone who may comment).
 *   DELETE -> soft delete (AUTHOR ONLY).
 *
 * TWO DIFFERENT PERMISSIONS ON ONE VERB, and they are kept apart on purpose.
 * Editing is authorship: only the person who wrote a sentence may change what
 * it says, and that is enforced in the WHERE clause of the update, not by an
 * if. Resolving is not authorship: a reviewer raises a point and an editor
 * closes it, so anyone with `canAddComments` may resolve or reopen a thread.
 * Merging them would mean either that nobody but the author can close a
 * thread, or that anyone can rewrite anyone's words.
 *
 * A request that matches no row (wrong project, wrong author, already
 * deleted, or a reply asked to resolve) gets 404, the same answer a stranger
 * gets, so nothing here confirms the existence of a comment to someone who
 * may not act on it.
 *
 * DELETE IS SOFT. The row stays, the body stops being served. Nothing in this
 * platform hard deletes a comment except the project cascade.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProjectForWrite } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { updateComment, softDeleteComment, setCommentResolved } from '@/src/hubs/modeling/platforms/refm/lib/persistence/comments';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';

const MAX_BODY = 4000;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row: project, error: projErr } = await getProjectForWrite(userId, id, 'canAddComments');
  if (projErr) return NextResponse.json({ error: projErr }, { status: 500 });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let payload: { body?: unknown; resolved?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Resolve / unresolve. Not an edit, and not gated on authorship.
  if (typeof payload.resolved === 'boolean') {
    const { row, tableMissing, error } = await setCommentResolved(id, commentId, userId, payload.resolved);
    if (tableMissing) return NextResponse.json({ error: 'Comments need migration 236.' }, { status: 503 });
    if (error) return NextResponse.json({ error }, { status: 500 });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ comment: row });
  }

  // Edit. Author only, enforced inside the statement.
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return NextResponse.json({ error: 'A comment cannot be empty.' }, { status: 400 });
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: `A comment is limited to ${MAX_BODY} characters.` }, { status: 400 });
  }
  const { row, tableMissing, error } = await updateComment(id, commentId, userId, body);
  if (tableMissing) return NextResponse.json({ error: 'Comments need migration 236.' }, { status: 503 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  // No row means: not this project, not this author, or already deleted. The
  // caller is told the same thing in every case.
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ comment: row });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { row: project, error: projErr } = await getProjectForWrite(userId, id, 'canAddComments');
  if (projErr) return NextResponse.json({ error: projErr }, { status: 500 });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { deleted, tableMissing, error } = await softDeleteComment(id, commentId, userId);
  if (tableMissing) return NextResponse.json({ error: 'Comments need migration 236.' }, { status: 503 });
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
