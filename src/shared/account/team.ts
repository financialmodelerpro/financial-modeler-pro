/**
 * team.ts (SERVER ONLY)
 *
 * HOLDER SELF-SERVICE TEAM MANAGEMENT, account model step 6: the scoped
 * version of the admin Team access screen. THE single engine behind
 * /api/account/team, so the rules cannot fork from the HTTP glue.
 *
 * THE SCOPE, stated once:
 *   - THEIR OWN PROJECTS: only projects the holder owns (soft-deleted ones
 *     excluded; archived ones included, they are still openable).
 *   - THEIR OWN PEOPLE: the account's members, through the SAME
 *     listAccountCandidates rule the admin dropdown uses (step 2), minus the
 *     holder themselves (ownership comes from the project row and is not
 *     assignable).
 *   - THE ROLES: the same four, validated by the same isProjectRole; 'owner'
 *     is refused here explicitly because ownership is not a membership.
 *
 * ONLY THE HOLDER MANAGES THE TEAM. A member calling any of this is refused
 * (resolveAccountHolder, the step-4 one-place rule). The BOUNDARY is reused,
 * never restated: assignment requires checkAccountBoundary to answer
 * same_account (or owner_admin for the operator's own internal account, or
 * pre_migration on a pre-239 database). A candidate allowed only as
 * candidate_admin is REFUSED on this route: FMP staff are attached by FMP
 * through the admin screen, not pulled in by a client.
 *
 * NO SEAT ARITHMETIC HERE, on purpose: since step 3 a seat is held by BEING
 * ON THE ACCOUNT, and this engine can only name people already on it, so
 * every assignment is seat-free by construction. The admin screen stays as
 * it is, the operator fallback.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProjectSource, hasMembership, type ProjectSource } from '@/src/shared/admin/projectSources';
import { isProjectRole, PROJECT_ROLES } from '@/src/core/collab/projectRoles';
import { resolveAccountHolder, checkAccountBoundary, listAccountCandidates } from '@/src/shared/admin/accountBoundary';
import { notifyAccessGranted, notifyAccessRemoved } from '@/src/shared/email/teamAccessEmails';

export interface TeamProject { id: string; name: string; archived: boolean }
export interface TeamPerson { id: string; name: string | null; email: string }
export interface TeamMembership { projectId: string; userId: string; role: string }

export interface TeamView {
  eligible: boolean;
  reason?: 'member' | 'no_platform' | 'no_people';
  projects: TeamProject[];
  people: TeamPerson[];
  memberships: TeamMembership[];
}

const EMPTY: Omit<TeamView, 'eligible' | 'reason'> = { projects: [], people: [], memberships: [] };

function sourceFor(key: string): ProjectSource | null {
  const s = getProjectSource(key);
  return s && hasMembership(s) ? s : null;
}

/** The holder's team surface: their projects, their people, who is on what.
 *  A member, a platform without membership, or an account with nobody else
 *  on it all come back ineligible (the card then renders nothing). */
export async function listTeam(
  sb: SupabaseClient, actorUserId: string, platformKey = 'refm',
): Promise<TeamView> {
  const source = sourceFor(platformKey);
  if (!source) return { eligible: false, reason: 'no_platform', ...EMPTY };

  const { holderUserId, isMember } = await resolveAccountHolder(sb, actorUserId);
  if (isMember) return { eligible: false, reason: 'member', ...EMPTY };

  const { candidates } = await listAccountCandidates(sb, holderUserId);
  const people: TeamPerson[] = candidates
    .filter((c) => c.id !== holderUserId)
    .map((c) => ({ id: c.id, name: c.name, email: c.email }));
  if (people.length === 0) return { eligible: false, reason: 'no_people', ...EMPTY };

  let q = sb.from(source.table)
    .select(`id, ${source.nameColumn}${source.archivedColumn ? `, ${source.archivedColumn}` : ''}`)
    .eq(source.ownerColumn, holderUserId).range(0, 999);
  if (source.deletedColumn) q = q.is(source.deletedColumn, null);
  const { data: projRows, error: projErr } = await q;
  if (projErr) throw new Error(`team listing failed: ${projErr.message}`);
  const projects: TeamProject[] = ((projRows ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r[source.nameColumn] ?? ''),
    archived: source.archivedColumn ? !!r[source.archivedColumn] : false,
  }));

  let memberships: TeamMembership[] = [];
  if (projects.length > 0) {
    const { data: mem, error: memErr } = await sb.from(source.membersTable!)
      .select(`${source.membersProjectColumn}, ${source.membersUserColumn}, ${source.membersRoleColumn}`)
      .in(source.membersProjectColumn!, projects.map((p) => p.id)).range(0, 1999);
    if (memErr) throw new Error(`team listing failed: ${memErr.message}`);
    memberships = ((mem ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
      projectId: String(r[source.membersProjectColumn!]),
      userId: String(r[source.membersUserColumn!]),
      role: String(r[source.membersRoleColumn!]),
    }));
  }

  return { eligible: true, projects, people, memberships };
}

export type TeamWriteResult =
  | { ok: true }
  | { ok: false; code: 'not_holder' | 'no_platform' | 'no_project' | 'owner_immutable' | 'bad_role' | 'not_on_account' | 'failed'; error: string };

/** Resolve the actor to holder + verify the project is THEIRS. Shared by
 *  assign and remove so the two cannot diverge on whose projects count. */
async function holderAndProject(
  sb: SupabaseClient, actorUserId: string, platformKey: string, projectId: string,
): Promise<{ ok: true; holderUserId: string; source: ProjectSource } | Extract<TeamWriteResult, { ok: false }>> {
  const source = sourceFor(platformKey);
  if (!source) return { ok: false, code: 'no_platform', error: `Unknown platform "${platformKey}".` };
  const { holderUserId, isMember } = await resolveAccountHolder(sb, actorUserId);
  if (isMember) return { ok: false, code: 'not_holder', error: 'Only the account holder manages the team.' };
  let q = sb.from(source.table).select(`id, ${source.ownerColumn}`).eq('id', projectId);
  if (source.deletedColumn) q = q.is(source.deletedColumn, null);
  const { data: proj, error } = await q.maybeSingle();
  if (error) return { ok: false, code: 'failed', error: error.message };
  const owner = proj ? String((proj as unknown as Record<string, unknown>)[source.ownerColumn]) : null;
  if (!proj || owner !== holderUserId) {
    // One answer for "not there" and "not yours": a holder route must not
    // confirm the existence of other people's projects.
    return { ok: false, code: 'no_project', error: 'No such project of yours.' };
  }
  return { ok: true, holderUserId, source };
}

export async function assignTeamMember(sb: SupabaseClient, actorUserId: string, args: {
  platformKey?: string; projectId: string; userId: string; role: string;
}): Promise<TeamWriteResult> {
  const ctx = await holderAndProject(sb, actorUserId, args.platformKey ?? 'refm', args.projectId);
  if (!ctx.ok) return ctx;
  const { holderUserId, source } = ctx;

  if (args.userId === holderUserId) {
    return { ok: false, code: 'owner_immutable', error: 'You own this project; ownership is not a membership.' };
  }
  // Rejected, never coerced (the admin route's rule); 'owner' is refused on
  // top, because ownership comes from the project row.
  if (!isProjectRole(args.role) || args.role === 'owner') {
    return { ok: false, code: 'bad_role', error: `Role must be one of: ${PROJECT_ROLES.filter((r) => r !== 'owner').join(', ')}.` };
  }

  // THE boundary, reused, and STRICTER here than the admin route: only a
  // same-account person qualifies (owner_admin covers the operator's own
  // internal account; pre_migration is a pre-239 database). candidate_admin
  // is deliberately NOT accepted: a client does not pull FMP staff in.
  let boundary;
  try {
    boundary = await checkAccountBoundary(sb, holderUserId, args.userId);
  } catch (e) {
    return { ok: false, code: 'failed', error: `The account check failed, nothing was changed: ${(e as Error).message}` };
  }
  const admissible = boundary.allowed
    && (boundary.reason === 'same_account' || boundary.reason === 'owner_admin' || boundary.reason === 'pre_migration');
  if (!admissible) {
    return { ok: false, code: 'not_on_account', error: 'That person is not on your account. Invite them to your team first.' };
  }

  // What was true BEFORE the write, for the notification's change detection.
  const { data: prior } = await sb.from(source.membersTable!)
    .select(source.membersRoleColumn!)
    .eq(source.membersProjectColumn!, args.projectId)
    .eq(source.membersUserColumn!, args.userId)
    .maybeSingle();
  const previousRole = prior
    ? String((prior as unknown as Record<string, unknown>)[source.membersRoleColumn!])
    : null;

  const { error } = await sb.from(source.membersTable!).upsert({
    [source.membersProjectColumn!]: args.projectId,
    [source.membersUserColumn!]: args.userId,
    [source.membersRoleColumn!]: args.role,
    added_by: actorUserId,
  }, { onConflict: `${source.membersProjectColumn},${source.membersUserColumn}` });
  if (error) return { ok: false, code: 'failed', error: error.message };

  // AFTER the successful write; the notifier never throws and its outcome
  // never affects the access change.
  await notifyAccessGranted(sb, {
    platformKey: source.key, projectId: args.projectId, targetUserId: args.userId,
    actorUserId, role: args.role, previousRole,
  });
  return { ok: true };
}

export async function removeTeamMember(sb: SupabaseClient, actorUserId: string, args: {
  platformKey?: string; projectId: string; userId: string;
}): Promise<TeamWriteResult> {
  const ctx = await holderAndProject(sb, actorUserId, args.platformKey ?? 'refm', args.projectId);
  if (!ctx.ok) return ctx;
  const { holderUserId, source } = ctx;
  if (args.userId === holderUserId) {
    return { ok: false, code: 'owner_immutable', error: 'You own this project; the owner cannot be removed from it.' };
  }
  const { error, count } = await sb.from(source.membersTable!).delete({ count: 'exact' })
    .eq(source.membersProjectColumn!, args.projectId)
    .eq(source.membersUserColumn!, args.userId);
  if (error) return { ok: false, code: 'failed', error: error.message };

  // AFTER the successful write; removing access nobody had sends nothing.
  await notifyAccessRemoved(sb, {
    platformKey: source.key, projectId: args.projectId, targetUserId: args.userId,
    actorUserId, removed: (count ?? 0) > 0,
  });
  return { ok: true };
}
