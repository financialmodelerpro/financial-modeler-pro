/**
 * comments.ts
 *
 * COMMENTS, server side. Module 10 Collaboration, step 7.
 * Writes to `refm_project_comments` (migration 236).
 *
 * ── THE BODY OF A DELETED COMMENT NEVER LEAVES THE SERVER ─────────────────
 *
 * A soft delete keeps the row so the thread keeps its shape and no reply is
 * orphaned, but "still in the table" must not mean "still on the wire". Every
 * read here nulls the body of a deleted row before it is serialised, so a
 * client cannot render text its author has withdrawn, and a network tab does
 * not hand it back either. `deleted: true` is all a caller gets.
 *
 * ── AUTHORSHIP IS ENFORCED IN THE WHERE CLAUSE, NOT IN AN IF ──────────────
 *
 * Edit and delete match on `user_id = me` inside the statement, so a request
 * naming somebody else's comment updates zero rows and is reported as not
 * found. A read-then-compare in application code leaves a window and one more
 * branch to get wrong; there is no branch here to get wrong.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 * No notification, no email, no unread count. A comment is written and read;
 * nothing is dispatched. Step 7 is the record, not the delivery.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';

/** Cached migration probe, like every other one: false once the table is
 *  observed absent, so a pre-236 database degrades to "comments unavailable"
 *  rather than erroring on every project open. */
let commentsApplied: boolean | undefined;

function isMissingCommentsTable(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /refm_project_comments/i.test(String(err.message ?? ''));
}

/** Postgres raised our one-level trigger, rather than failing some other way. */
export function isOneLevelViolation(err: { message?: string } | null): boolean {
  return /replies are ONE level|cannot reply to itself/i.test(String(err?.message ?? ''));
}

export interface ProjectComment {
  id: string;
  projectId: string;
  versionId: string | null;
  parentId: string | null;
  userId: string | null;
  userName: string | null;
  path: string | null;
  /** NULL when the comment is deleted. The text never leaves the server once
   *  its author has withdrawn it. */
  body: string | null;
  createdAt: string;
  updatedAt: string | null;
  edited: boolean;
  deleted: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
}

const COLS = 'id, project_id, version_id, parent_id, user_id, path, body, created_at, updated_at, deleted_at, resolved_at, resolved_by';

/** Display names for a set of ids. An id that resolves to nothing is ABSENT,
 *  and the caller renders that as unknown: a uuid is not a name, and the
 *  project owner is not the author (migration 230's rule). Never throws. */
async function resolveNames(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  if (unique.length === 0) return {};
  try {
    const sb = getServerClient();
    const { data, error } = await sb.from('users').select('id, name, email').in('id', unique);
    if (error || !data) return {};
    const out: Record<string, string> = {};
    for (const r of data as Array<{ id: string; name: string | null; email: string | null }>) {
      const label = (r.name ?? '').trim() || (r.email ?? '').trim();
      if (label) out[r.id] = label;
    }
    return out;
  } catch {
    return {};
  }
}

function toDto(r: Record<string, unknown>, names: Record<string, string>): ProjectComment {
  const deleted = r.deleted_at !== null && r.deleted_at !== undefined;
  const userId = (r.user_id as string) ?? null;
  const resolvedBy = (r.resolved_by as string) ?? null;
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    versionId: (r.version_id as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
    userId,
    userName: userId ? (names[userId] ?? null) : null,
    path: (r.path as string) ?? null,
    // THE strip. Deleted text is not sent, ever.
    body: deleted ? null : String(r.body ?? ''),
    createdAt: String(r.created_at),
    updatedAt: (r.updated_at as string) ?? null,
    edited: !deleted && r.updated_at !== null && r.updated_at !== undefined,
    deleted,
    resolvedAt: (r.resolved_at as string) ?? null,
    resolvedBy,
    resolvedByName: resolvedBy ? (names[resolvedBy] ?? null) : null,
  };
}

/**
 * Every comment on a project, oldest first.
 *
 * NOT FILTERED BY VERSION, and that is the requirement rather than an
 * omission: a comment written against v3 stays visible after v4 is saved, and
 * carries its version so a reader can see what it was written against.
 *
 * Deleted rows ARE returned, stripped, because a deleted root with live
 * replies still has to hold its thread together. The caller decides whether a
 * given tombstone is worth rendering.
 */
export async function listProjectComments(
  projectId: string,
  limit = 500,
): Promise<{ rows: ProjectComment[]; tableMissing: boolean; error: string | null }> {
  if (commentsApplied === false) return { rows: [], tableMissing: true, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_comments')
      .select(COLS)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      // Bounded: PostgREST truncates an unbounded read at its own cap without
      // saying so (TRAPS 2.1), and a comment table is one that grows.
      .limit(Math.max(1, Math.min(limit, 1000)));
    if (error) {
      if (isMissingCommentsTable(error)) { commentsApplied = false; return { rows: [], tableMissing: true, error: null }; }
      return { rows: [], tableMissing: false, error: error.message };
    }
    commentsApplied = true;
    const raw = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const names = await resolveNames([
      ...raw.map((r) => String(r.user_id ?? '')),
      ...raw.map((r) => String(r.resolved_by ?? '')),
    ]);
    return { rows: raw.map((r) => toDto(r, names)), tableMissing: false, error: null };
  } catch (e) {
    return { rows: [], tableMissing: false, error: (e as { message?: string }).message ?? 'comment read error' };
  }
}

export interface NewComment {
  projectId: string;
  userId: string;
  body: string;
  /** A reply carries NO anchor of its own: the thread's root owns the version
   *  and the path, and a reply claiming a different one would be incoherent. */
  parentId?: string | null;
  versionId?: string | null;
  path?: string | null;
}

export async function createComment(
  input: NewComment,
): Promise<{ row: ProjectComment | null; tableMissing: boolean; error: string | null }> {
  if (commentsApplied === false) return { row: null, tableMissing: true, error: null };
  const isReply = !!input.parentId;
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_comments')
      .insert({
        project_id: input.projectId,
        user_id: input.userId,
        body: input.body,
        parent_id: input.parentId ?? null,
        // A reply inherits its thread's anchor; it never stores its own.
        version_id: isReply ? null : (input.versionId ?? null),
        path: isReply ? null : (input.path ?? null),
      })
      .select(COLS)
      .single();
    if (error) {
      if (isMissingCommentsTable(error)) { commentsApplied = false; return { row: null, tableMissing: true, error: null }; }
      return { row: null, tableMissing: false, error: error.message };
    }
    commentsApplied = true;
    const r = data as unknown as Record<string, unknown>;
    const names = await resolveNames([String(r.user_id ?? '')]);
    return { row: toDto(r, names), tableMissing: false, error: null };
  } catch (e) {
    return { row: null, tableMissing: false, error: (e as { message?: string }).message ?? 'comment write error' };
  }
}

/**
 * Edit a comment. AUTHOR ONLY, matched in the WHERE clause.
 *
 * `updated_at` is stamped here rather than by a trigger, because it means
 * "the author edited this" and not "any column changed": resolving a thread
 * must not make its root read as edited.
 */
export async function updateComment(
  projectId: string,
  commentId: string,
  userId: string,
  body: string,
): Promise<{ row: ProjectComment | null; tableMissing: boolean; error: string | null }> {
  if (commentsApplied === false) return { row: null, tableMissing: true, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_comments')
      .update({ body, updated_at: new Date().toISOString() })
      .eq('id', commentId)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      // A withdrawn comment is not editable back into existence.
      .is('deleted_at', null)
      .select(COLS)
      .maybeSingle();
    if (error) {
      if (isMissingCommentsTable(error)) { commentsApplied = false; return { row: null, tableMissing: true, error: null }; }
      return { row: null, tableMissing: false, error: error.message };
    }
    if (!data) return { row: null, tableMissing: false, error: null };
    const r = data as unknown as Record<string, unknown>;
    return { row: toDto(r, await resolveNames([String(r.user_id ?? '')])), tableMissing: false, error: null };
  } catch (e) {
    return { row: null, tableMissing: false, error: (e as { message?: string }).message ?? 'comment edit error' };
  }
}

/**
 * SOFT delete. AUTHOR ONLY, matched in the WHERE clause.
 *
 * The row survives so the thread keeps its shape; the body is left in the
 * table (an admin undoing a mis-click has something to restore) and is
 * stripped by every read from here on.
 */
export async function softDeleteComment(
  projectId: string,
  commentId: string,
  userId: string,
): Promise<{ deleted: boolean; tableMissing: boolean; error: string | null }> {
  if (commentsApplied === false) return { deleted: false, tableMissing: true, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', commentId)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      if (isMissingCommentsTable(error)) { commentsApplied = false; return { deleted: false, tableMissing: true, error: null }; }
      return { deleted: false, tableMissing: false, error: error.message };
    }
    return { deleted: !!data, tableMissing: false, error: null };
  } catch (e) {
    return { deleted: false, tableMissing: false, error: (e as { message?: string }).message ?? 'comment delete error' };
  }
}

/**
 * Resolve or unresolve a THREAD. Anyone who may comment may do this, which is
 * deliberate: a reviewer raises a point and an editor closes it, and requiring
 * the original author to close it would leave threads open forever when
 * somebody leaves.
 *
 * ROOTS ONLY: `parent_id IS NULL` is in the WHERE, so a request naming a reply
 * matches nothing and is reported as not found. A resolved reply would be a
 * second, contradicting resolve state inside one thread.
 */
export async function setCommentResolved(
  projectId: string,
  commentId: string,
  userId: string,
  resolved: boolean,
): Promise<{ row: ProjectComment | null; tableMissing: boolean; error: string | null }> {
  if (commentsApplied === false) return { row: null, tableMissing: true, error: null };
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('refm_project_comments')
      .update(resolved
        ? { resolved_at: new Date().toISOString(), resolved_by: userId }
        : { resolved_at: null, resolved_by: null })
      .eq('id', commentId)
      .eq('project_id', projectId)
      .is('parent_id', null)
      .is('deleted_at', null)
      .select(COLS)
      .maybeSingle();
    if (error) {
      if (isMissingCommentsTable(error)) { commentsApplied = false; return { row: null, tableMissing: true, error: null }; }
      return { row: null, tableMissing: false, error: error.message };
    }
    if (!data) return { row: null, tableMissing: false, error: null };
    const r = data as unknown as Record<string, unknown>;
    const names = await resolveNames([String(r.user_id ?? ''), String(r.resolved_by ?? '')]);
    return { row: toDto(r, names), tableMissing: false, error: null };
  } catch (e) {
    return { row: null, tableMissing: false, error: (e as { message?: string }).message ?? 'comment resolve error' };
  }
}
