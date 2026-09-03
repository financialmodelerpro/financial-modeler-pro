/**
 * deleteRequests.ts
 *
 * DELETE APPROVAL. Module 10 Collaboration, step 9.
 *
 * An Editor asks; an admin approves or declines. The Owner never appears here:
 * they delete directly, which is already a SOFT delete with a 30-day window an
 * admin can restore from, so putting the account holder in a queue to remove
 * their own work would buy supervision nobody asked for. Reviewers and Viewers
 * have neither path.
 *
 * ── IT LIVES IN shared/admin, BESIDE THE REGISTRY ─────────────────────────
 *
 * Same reasoning as `seats.ts`: the table is platform agnostic, the admin
 * queue is registry driven, and a helper that named `refm_projects` would stop
 * being right the day ERM ships. The platform key travels with every row.
 *
 * ── THE BUG THIS FILE EXISTS TO NOT HAVE ──────────────────────────────────
 *
 * `softDeleteProject` filters `.is('deleted_at', null)`, and Supabase does not
 * report rows-affected on a service-role write, so deleting an ALREADY deleted
 * project updates zero rows and returns `{ error: null }`. Approving a stale
 * request would therefore have reported success while doing nothing, and the
 * request would read `approved` against a project somebody else had already
 * removed. So approval READS THE PROJECT FIRST and refuses with
 * `already_deleted` when `deleted_at` is set. The check is not defensive
 * padding; it is the difference between a true record and a false one.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProjectSource, type ProjectSource } from './projectSources';

export const DELETE_REQUESTS_TABLE = 'project_delete_requests';

export type DeleteRequestStatus = 'pending' | 'approved' | 'declined';

/** What a PROJECT CARD can be in. Narrower than DeleteRequestStatus on
 *  purpose: an approved request has taken its project out of the list, so a
 *  card can never be in that state and the type should not claim it can. */
export type CardDeleteState = 'pending' | 'declined';

export interface DeleteRequest {
  id: string;
  platform: string;
  projectId: string;
  projectName: string | null;
  /** Null when the requester has closed their account: the request outlives
   *  the person, and NULL reads as unknown rather than as somebody else. */
  requestedBy: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  /** Whether the requester is STILL a member of this project. False is not a
   *  reason to hide the request; it is context the admin should see. */
  requesterStillMember: boolean;
  status: DeleteRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  /** The project's own state right now, so the queue can show a request whose
   *  project somebody else already deleted. */
  projectDeletedAt: string | null;
}

/** Cached probe, like every other one: false once the table is observed
 *  absent, so a pre-238 database degrades to "no requests" rather than
 *  erroring on every dashboard load. */
let requestsApplied: boolean | undefined;

function isMissingTable(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return new RegExp(DELETE_REQUESTS_TABLE, 'i').test(String(err.message ?? ''));
}

export function deleteRequestsUnavailable(): boolean {
  return requestsApplied === false;
}

function sourceOrThrow(platform: string): ProjectSource {
  const s = getProjectSource(platform);
  if (!s) throw new Error(`Unknown platform "${platform}".`);
  return s;
}

/**
 * Raise a request, or join the one already open on this project.
 *
 * The partial unique index allows ONE pending row per project, so a second
 * editor asking for the same delete is not an error and must not read like
 * one: they are told a request is already open, with who raised it. Returning
 * a conflict for a user doing a reasonable thing would push them to ask an
 * admin why the button is broken.
 */
export async function createDeleteRequest(
  sb: SupabaseClient, platform: string, projectId: string, requesterId: string,
): Promise<{ created: boolean; existing: boolean; error: string | null; unavailable?: true }> {
  if (requestsApplied === false) return { created: false, existing: false, error: null, unavailable: true };
  try {
    const { data: open } = await sb
      .from(DELETE_REQUESTS_TABLE)
      .select('id')
      .eq('platform', platform).eq('project_id', projectId).eq('status', 'pending')
      .maybeSingle();
    if (open) return { created: false, existing: true, error: null };

    const { error } = await sb.from(DELETE_REQUESTS_TABLE).insert({
      platform, project_id: projectId, requested_by: requesterId,
    });
    if (error) {
      if (isMissingTable(error)) { requestsApplied = false; return { created: false, existing: false, error: null, unavailable: true }; }
      // The index is the authority, not the read above: two simultaneous
      // requests both pass the SELECT and one loses the INSERT. Losing that
      // race means somebody else asked first, which is the same outcome.
      if (/one_pending|duplicate key/i.test(error.message)) return { created: false, existing: true, error: null };
      return { created: false, existing: false, error: error.message };
    }
    requestsApplied = true;
    return { created: true, existing: false, error: null };
  } catch (e) {
    return { created: false, existing: false, error: (e as { message?: string }).message ?? 'delete request failed' };
  }
}

/** The open request on each of these projects, keyed by project id, so a
 *  project list can show its own state without a query per card. */
export async function pendingByProject(
  sb: SupabaseClient, platform: string, projectIds: readonly string[],
): Promise<Map<string, { status: CardDeleteState; declineReason: string | null; createdAt: string }>> {
  const out = new Map<string, { status: CardDeleteState; declineReason: string | null; createdAt: string }>();
  if (requestsApplied === false || projectIds.length === 0) return out;
  try {
    const { data, error } = await sb
      .from(DELETE_REQUESTS_TABLE)
      .select('project_id, status, decline_reason, created_at, decided_at')
      .eq('platform', platform)
      .in('project_id', [...projectIds])
      .in('status', ['pending', 'declined'])
      .order('created_at', { ascending: false });
    if (error) { if (isMissingTable(error)) requestsApplied = false; return out; }
    requestsApplied = true;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const pid = String(r.project_id);
      // Newest first, so the first row seen for a project is its current
      // state. An APPROVED request is not carried: the project is gone from
      // the user's list anyway, and saying "delete approved" on a card that
      // is about to vanish tells them nothing they can act on.
      if (!out.has(pid)) {
        out.set(pid, {
          status: String(r.status) as CardDeleteState,
          declineReason: (r.decline_reason as string) ?? null,
          createdAt: String(r.created_at),
        });
      }
    }
    return out;
  } catch {
    return out;
  }
}

/** The admin queue: every pending request, with the context needed to decide. */
export async function listPendingRequests(
  sb: SupabaseClient,
): Promise<{ rows: DeleteRequest[]; unavailable: boolean; error: string | null }> {
  if (requestsApplied === false) return { rows: [], unavailable: true, error: null };
  try {
    const { data, error } = await sb
      .from(DELETE_REQUESTS_TABLE)
      .select('id, platform, project_id, requested_by, status, created_at, decided_at, declined_at, decline_reason')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) { requestsApplied = false; return { rows: [], unavailable: true, error: null }; }
      return { rows: [], unavailable: false, error: error.message };
    }
    requestsApplied = true;
    const raw = (data ?? []) as Array<Record<string, unknown>>;
    if (raw.length === 0) return { rows: [], unavailable: false, error: null };

    // Names, project names and CURRENT project state, one query per concern
    // rather than per row.
    const userIds = [...new Set(raw.map((r) => String(r.requested_by ?? '')).filter(Boolean))];
    const { data: users } = userIds.length
      ? await sb.from('users').select('id, name, email').in('id', userIds)
      : { data: [] as Array<{ id: string; name: string | null; email: string | null }> };
    const byUser = new Map((users ?? []).map((u) => [String(u.id), u]));

    const rows: DeleteRequest[] = [];
    for (const r of raw) {
      const platform = String(r.platform);
      const projectId = String(r.project_id);
      const source = getProjectSource(platform);
      let projectName: string | null = null;
      let projectDeletedAt: string | null = null;
      let stillMember = false;
      if (source) {
        const cols = [source.nameColumn, source.deletedColumn].filter(Boolean).join(', ');
        const { data: proj } = await sb.from(source.table).select(cols || 'id').eq('id', projectId).maybeSingle();
        const p = proj as unknown as Record<string, unknown> | null;
        projectName = p ? ((p[source.nameColumn] as string) ?? null) : null;
        projectDeletedAt = p && source.deletedColumn ? ((p[source.deletedColumn] as string) ?? null) : null;
        if (source.membersTable && r.requested_by) {
          const { data: mem } = await sb.from(source.membersTable)
            .select(source.membersUserColumn!)
            .eq(source.membersProjectColumn!, projectId)
            .eq(source.membersUserColumn!, String(r.requested_by))
            .maybeSingle();
          stillMember = !!mem;
        }
      }
      const u = r.requested_by ? byUser.get(String(r.requested_by)) : undefined;
      rows.push({
        id: String(r.id), platform, projectId, projectName,
        requestedBy: (r.requested_by as string) ?? null,
        requesterName: u?.name ?? null,
        requesterEmail: u?.email ?? null,
        requesterStillMember: stillMember,
        status: String(r.status) as DeleteRequestStatus,
        createdAt: String(r.created_at),
        decidedAt: (r.decided_at as string) ?? null,
        decidedByName: null,
        declinedAt: (r.declined_at as string) ?? null,
        declineReason: (r.decline_reason as string) ?? null,
        projectDeletedAt,
      });
    }
    return { rows, unavailable: false, error: null };
  } catch (e) {
    return { rows: [], unavailable: false, error: (e as { message?: string }).message ?? 'queue read failed' };
  }
}

export type DecideOutcome =
  | { ok: true; action: 'approved' | 'declined'; projectName: string | null }
  | { ok: false; code: 'not_found' | 'not_pending' | 'already_deleted' | 'unavailable' | 'error'; message: string };

/**
 * Approve a request: perform THE SAME soft delete the Owner performs.
 *
 * ── THE ZERO-ROW TRAP, HANDLED BEFORE IT CAN LIE ──────────────────────────
 *
 * The project is READ FIRST and the request is refused when `deleted_at` is
 * already set. Without that read, approval would call an UPDATE filtered on
 * `deleted_at IS NULL`, match nothing, and come back with no error, because a
 * service-role write reports no rows-affected. The admin would be told the
 * delete succeeded, the request would be stamped `approved`, and the truth
 * would be that somebody else had deleted it days earlier and this approval
 * did nothing at all. A record that says a thing happened when it did not is
 * worse than no record.
 */
export async function approveDeleteRequest(
  sb: SupabaseClient, requestId: string, adminId: string, nowIso: string = new Date().toISOString(),
): Promise<DecideOutcome> {
  if (requestsApplied === false) return { ok: false, code: 'unavailable', message: 'Delete requests need migration 238.' };
  const { data: req, error: readErr } = await sb
    .from(DELETE_REQUESTS_TABLE)
    .select('id, platform, project_id, status').eq('id', requestId).maybeSingle();
  if (readErr) {
    if (isMissingTable(readErr)) { requestsApplied = false; return { ok: false, code: 'unavailable', message: 'Delete requests need migration 238.' }; }
    return { ok: false, code: 'error', message: readErr.message };
  }
  if (!req) return { ok: false, code: 'not_found', message: 'No such request.' };
  const r = req as unknown as { platform: string; project_id: string; status: string };
  if (r.status !== 'pending') {
    return { ok: false, code: 'not_pending', message: `This request is already ${r.status}.` };
  }

  const source = sourceOrThrow(r.platform);
  if (!source.deletedColumn) {
    return { ok: false, code: 'error', message: `${source.shortLabel} has no soft delete, so a request cannot be approved.` };
  }
  const { data: proj, error: projErr } = await sb
    .from(source.table).select(`id, ${source.nameColumn}, ${source.deletedColumn}`).eq('id', r.project_id).maybeSingle();
  if (projErr) return { ok: false, code: 'error', message: projErr.message };
  const p = proj as unknown as Record<string, unknown> | null;
  if (!p) {
    return { ok: false, code: 'already_deleted', message: 'That project no longer exists, so nothing was deleted. The request is left pending for you to decline.' };
  }
  const name = (p[source.nameColumn] as string) ?? null;
  if (p[source.deletedColumn]) {
    return {
      ok: false, code: 'already_deleted',
      message: `"${name}" was already deleted by another route, so this approval would have changed nothing. The request is left pending; decline it to close the loop.`,
    };
  }

  const { error: delErr } = await sb
    .from(source.table).update({ [source.deletedColumn]: nowIso })
    .eq('id', r.project_id).is(source.deletedColumn, null);
  if (delErr) return { ok: false, code: 'error', message: delErr.message };

  const { error: upErr } = await sb.from(DELETE_REQUESTS_TABLE)
    .update({ status: 'approved', decided_at: nowIso, decided_by: adminId }).eq('id', requestId);
  if (upErr) return { ok: false, code: 'error', message: upErr.message };
  return { ok: true, action: 'approved', projectName: name };
}

/**
 * Decline: the project is untouched and the reason is kept.
 *
 * The reason is REQUIRED. There is no notification system, so this sentence on
 * the requester's own project card is the only way they find out, and "your
 * request was declined" with no cause invites them to ask again immediately.
 *
 * `declined_at` / `declined_by` / `decline_reason` are written here and never
 * overwritten, so a later approval leaves both halves of the history readable.
 */
export async function declineDeleteRequest(
  sb: SupabaseClient, requestId: string, adminId: string, reason: string, nowIso: string = new Date().toISOString(),
): Promise<DecideOutcome> {
  if (requestsApplied === false) return { ok: false, code: 'unavailable', message: 'Delete requests need migration 238.' };
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, code: 'error', message: 'A decline needs a reason: it is the only thing the requester will see.' };

  const { data: req, error: readErr } = await sb
    .from(DELETE_REQUESTS_TABLE).select('id, status').eq('id', requestId).maybeSingle();
  if (readErr) return { ok: false, code: 'error', message: readErr.message };
  if (!req) return { ok: false, code: 'not_found', message: 'No such request.' };
  if ((req as { status: string }).status !== 'pending') {
    return { ok: false, code: 'not_pending', message: `This request is already ${(req as { status: string }).status}.` };
  }

  const { error } = await sb.from(DELETE_REQUESTS_TABLE).update({
    status: 'declined', decided_at: nowIso, decided_by: adminId,
    declined_at: nowIso, declined_by: adminId, decline_reason: trimmed,
  }).eq('id', requestId);
  if (error) return { ok: false, code: 'error', message: error.message };
  return { ok: true, action: 'declined', projectName: null };
}
