/**
 * members.ts
 *
 * WHO HAS ACCESS to one project, for the Module 10 Collaborate screen.
 *
 * READ ONLY, and served to ANY member of the project: the same visibility
 * rule as Activity (step 6) and Comments (step 7), where every member sees
 * the same rows and an admin sees no more on a project they can open than a
 * member does. Access is decided by the ROUTE calling `getProject` first,
 * the one membership choke point; this module only shapes the answer.
 *
 * MEMBERSHIP WRITES DO NOT LIVE HERE and never will: granting and revoking
 * stay on the admin member route and the holder team engine, the one write
 * path per action.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';

/** Cached migration probe, like every other one: false once the table is
 *  observed absent, so a pre-231 database degrades to "members unavailable"
 *  rather than erroring. */
let membersApplied: boolean | undefined;

function isMissingMembersTable(err: { message?: string; code?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /refm_project_members/i.test(String(err.message ?? ''));
}

export interface ProjectMemberRow {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  role: string;
  /** From the project row, not the membership: ownership is the project's
   *  `user_id`, the authoritative pointer (mig 231's rule). */
  isOwner: boolean;
  addedAt: string | null;
}

export async function listProjectMembers(
  projectId: string, ownerUserId: string,
): Promise<{ available: boolean; members: ProjectMemberRow[]; error: string | null }> {
  if (membersApplied === false) return { available: false, members: [], error: null };
  const sb = getServerClient();
  const { data, error } = await sb.from('refm_project_members')
    .select('user_id, role, added_at')
    .eq('project_id', projectId)
    .range(0, 499);
  if (error) {
    if (isMissingMembersTable(error)) { membersApplied = false; return { available: false, members: [], error: null }; }
    return { available: true, members: [], error: error.message };
  }
  membersApplied = true;
  const rows = (data ?? []) as Array<{ user_id: string; role: string; added_at: string | null }>;

  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: users } = ids.length
    ? await sb.from('users').select('id, name, email').in('id', ids)
    : { data: [] as Array<{ id: string; name: string | null; email: string | null }> };
  const byUser = new Map((users ?? []).map((u) => [String(u.id), u]));

  const members = rows.map((r) => {
    const u = byUser.get(r.user_id) as { name?: string | null; email?: string | null } | undefined;
    return {
      userId: r.user_id,
      userName: u?.name ?? null,
      userEmail: u?.email ?? null,
      role: r.role,
      isOwner: r.user_id === ownerUserId,
      addedAt: r.added_at,
    };
  });
  // Owner first, then by role order as stored, then by name: a stable,
  // predictable list rather than insertion order.
  members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner)
    || (a.userName ?? a.userEmail ?? '').localeCompare(b.userName ?? b.userEmail ?? ''));
  return { available: true, members, error: null };
}
