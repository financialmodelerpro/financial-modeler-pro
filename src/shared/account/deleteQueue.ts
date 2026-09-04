/**
 * deleteQueue.ts (SERVER ONLY)
 *
 * THE HOLDER'S DELETE-REQUEST QUEUE, account model step 7. An Editor's
 * request used to reach only the platform admin; it now also reaches the
 * ACCOUNT HOLDER, who owns the project and holds the plan, with the same
 * approve and decline the admin has.
 *
 * NOTHING IS DECIDED HERE TWICE. The listing REUSES `listPendingRequests`
 * (the admin queue read, with its decoration and its zero-row and
 * missing-table discipline) and FILTERS it to projects the holder owns; the
 * decisions REUSE `approveDeleteRequest` / `declineDeleteRequest`, so the
 * already-deleted refusal, the required decline reason and the survive-a-
 * later-approval fields cannot fork from the admin path. This file adds
 * exactly one rule: THE ACTOR MUST OWN THE PROJECT.
 *
 * Only the holder decides (resolveAccountHolder, the step-4 one-place rule);
 * a member is refused. A request on somebody else's project gets ONE answer
 * (`no_request`), the step-6 no-existence-leak posture. The ADMIN QUEUE IS
 * UNTOUCHED and still sees everything: the operator fallback.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PROJECT_SOURCES } from '@/src/shared/admin/projectSources';
import {
  listPendingRequests, approveDeleteRequest, declineDeleteRequest,
  type DeleteRequest, type DecideOutcome,
} from '@/src/shared/admin/deleteRequests';
import { resolveAccountHolder } from '@/src/shared/admin/accountBoundary';

/** Project ids the holder owns, per platform key. Soft-deleted projects are
 *  INCLUDED: a pending request on one must still be visible to decline. */
async function ownedByPlatform(
  sb: SupabaseClient, holderUserId: string,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const source of PROJECT_SOURCES) {
    const { data, error } = await sb.from(source.table)
      .select('id').eq(source.ownerColumn, holderUserId).range(0, 1999);
    if (error) throw new Error(`delete-queue ownership read failed: ${error.message}`);
    out.set(source.key, new Set(((data ?? []) as Array<{ id: unknown }>).map((r) => String(r.id))));
  }
  return out;
}

export async function listHolderDeleteRequests(
  sb: SupabaseClient, actorUserId: string,
): Promise<{ eligible: boolean; rows: DeleteRequest[]; error: string | null }> {
  const { holderUserId, isMember } = await resolveAccountHolder(sb, actorUserId);
  if (isMember) return { eligible: false, rows: [], error: null };
  const { rows, unavailable, error } = await listPendingRequests(sb);
  if (unavailable || error) return { eligible: true, rows: [], error };
  const owned = await ownedByPlatform(sb, holderUserId);
  return {
    eligible: true,
    rows: rows.filter((r) => owned.get(r.platform)?.has(r.projectId) ?? false),
    error: null,
  };
}

export type HolderDecideOutcome =
  | DecideOutcome
  | { ok: false; code: 'not_holder' | 'no_request' | 'bad_action'; message: string };

/** The one rule this file adds: the actor must OWN the request's project.
 *  Everything after that line is the shared admin decision engine. */
export async function decideHolderDeleteRequest(
  sb: SupabaseClient, actorUserId: string, requestId: string,
  action: 'approve' | 'decline', reason?: string,
): Promise<HolderDecideOutcome> {
  if (action !== 'approve' && action !== 'decline') {
    return { ok: false, code: 'bad_action', message: 'Action must be approve or decline.' };
  }
  const { holderUserId, isMember } = await resolveAccountHolder(sb, actorUserId);
  if (isMember) return { ok: false, code: 'not_holder', message: 'Only the account holder decides delete requests.' };

  const { data: req, error } = await sb.from('project_delete_requests')
    .select('id, platform, project_id').eq('id', requestId).maybeSingle();
  if (error) return { ok: false, code: 'error', message: error.message };
  const r = req as { platform: string; project_id: string } | null;
  if (r) {
    const source = PROJECT_SOURCES.find((s) => s.key === r.platform);
    if (source) {
      const { data: proj } = await sb.from(source.table)
        .select(`id, ${source.ownerColumn}`).eq('id', r.project_id).maybeSingle();
      const owner = proj ? String((proj as unknown as Record<string, unknown>)[source.ownerColumn]) : null;
      if (owner === holderUserId) {
        return action === 'approve'
          ? approveDeleteRequest(sb, requestId, actorUserId)
          : declineDeleteRequest(sb, requestId, actorUserId, reason ?? '');
      }
    }
  }
  // One answer for "not there", "unknown platform" and "not yours": the
  // holder queue confirms nothing about other people's requests.
  return { ok: false, code: 'no_request', message: 'No such request on a project of yours.' };
}
