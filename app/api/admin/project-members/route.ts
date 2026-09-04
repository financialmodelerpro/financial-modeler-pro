/**
 * /api/admin/project-members
 *
 *   GET    -> members of one project, or the projects one user can reach
 *   POST   -> grant or change a membership
 *   DELETE -> revoke a membership
 *
 * ADMIN ONLY. Assigning projects is an admin act performed from the Modeling
 * Hub dashboard, before entering any platform, which is why this lives under
 * `/api/admin` and not under `/api/refm`. It is also why it is registry driven:
 * ERM and BVM join by declaring their membership columns in `PROJECT_SOURCES`,
 * not by growing a second copy of this route.
 *
 * ── THE OWNER CANNOT BE DEMOTED OR REMOVED HERE ───────────────────────────
 *
 * `refm_projects.user_id` remains authoritative for ownership: it drives the
 * project cap, the soft-delete purge, the FK cascade and the admin browser. A
 * membership row that disagreed with it would be a second answer to "who owns
 * this", and migration 231 exists partly to avoid exactly that. So this route
 * refuses to change or delete the owner's own membership; transferring a
 * project is a different operation on a different column, and it is not this
 * one.
 *
 * ── THE ACCOUNT BOUNDARY IS ENFORCED IN THE POST BELOW (step 2, mig 239) ──
 *
 * A candidate must be on the SAME ACCOUNT as the project's owner; a platform
 * admin is exempt in both directions (an admin candidate can be added
 * anywhere, and an admin-owned project accepts anyone, per the standing
 * "admin is never blocked" rule). The rule lives ONCE in
 * `shared/admin/accountBoundary.ts`; the GET's `candidatesFor` mode lists
 * people through the SAME rule, so the dropdown never offers a person the
 * write would refuse. The dropdown is a courtesy; THIS refusal is the scope.
 *
 * ── THE SEAT LIMIT IS ENFORCED IN THE POST BELOW, AND ONLY THERE ──────────
 *
 * This upsert is the ONLY insert into any membership table in the codebase.
 * Project create and duplicate do not seed one; the other writes to
 * `refm_project_members` update `priority` and `sort_order` on rows that
 * already exist. So one check here is genuinely one enforcement point rather
 * than the first of several, and step 8 does not add a second write path
 * (there is deliberately no Owner-adding route yet).
 *
 * The counting itself is NOT here: it lives in `shared/admin/seats.ts` and
 * iterates PROJECT_SOURCES, so ERM and BVM are counted the day they ship
 * instead of quietly contributing nothing.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { PROJECT_SOURCES, getProjectSource, hasMembership } from '@/src/shared/admin/projectSources';
import { isProjectRole, PROJECT_ROLES } from '@/src/core/collab/projectRoles';
import { checkSeatForMember, seatBlockMessage } from '@/src/shared/admin/seats';
import { checkAccountBoundary, accountBoundaryMessage, listAccountCandidates } from '@/src/shared/admin/accountBoundary';
import { notifyAccessGranted, notifyAccessRemoved } from '@/src/shared/email/teamAccessEmails';

function badRequest(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

/** Admin only, and it returns the acting admin so `added_by` records a real
 *  person. Copied in shape from the projects browser's guard, deliberately:
 *  the two screens are siblings and a second auth idiom would be a second
 *  thing to keep right. `getServerSession` is called inside the handler
 *  because it throws without a request scope (TRAPS 9.4).
 */
async function guard(): Promise<{ res: NextResponse | null; adminId: string | null }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), adminId: null };
    if ((session.user as { role?: string }).role !== 'admin') {
      return { res: NextResponse.json({ error: 'Admin only' }, { status: 403 }), adminId: null };
    }
    return { res: null, adminId: (session.user as { id?: string }).id ?? null };
  } catch {
    return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), adminId: null };
  }
}

/** The source for a platform key, refusing one with no membership wired. */
function sourceFor(key: string | null) {
  const s = getProjectSource(key ?? 'refm');
  if (!s) return { source: null, error: `Unknown platform "${key}".` };
  if (!hasMembership(s)) return { source: null, error: `${s.shortLabel} has no membership configured.` };
  return { source: s, error: null };
}

// ── GET ─────────────────────────────────────────────────────────────────────
// ?candidatesFor=... people offerable for that project (the account boundary
//                    as a list, so the dropdown matches the write)
// ?projectId=...     members of that project
// ?userId=...        memberships held by that user
// (none)             the platforms that support membership, for the picker
export async function GET(req: NextRequest) {
  const { res: denied } = await guard();
  if (denied) return denied;

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const userId = url.searchParams.get('userId');
  const candidatesFor = url.searchParams.get('candidatesFor');
  const { source, error: srcErr } = sourceFor(url.searchParams.get('platform'));

  if (candidatesFor) {
    if (!source) return badRequest(srcErr!);
    const sb = getServerClient();
    const { data: proj, error: projErr } = await sb
      .from(source.table).select(`id, ${source.ownerColumn}`).eq('id', candidatesFor).maybeSingle();
    if (projErr) return serverError(projErr.message);
    if (!proj) return badRequest('No such project.');
    const ownerId = String((proj as unknown as Record<string, unknown>)[source.ownerColumn]);
    try {
      const { candidates, scoped } = await listAccountCandidates(sb, ownerId);
      return NextResponse.json({ candidates, scoped });
    } catch (e) {
      return serverError((e as Error).message);
    }
  }

  if (!projectId && !userId) {
    return NextResponse.json({
      platforms: PROJECT_SOURCES.filter(hasMembership)
        .map((s) => ({ key: s.key, label: s.label, shortLabel: s.shortLabel })),
      roles: PROJECT_ROLES,
    });
  }
  if (!source) return badRequest(srcErr!);

  const sb = getServerClient();
  let q = sb.from(source.membersTable!)
    .select(`${source.membersProjectColumn}, ${source.membersUserColumn}, ${source.membersRoleColumn}, added_at`);
  if (projectId) q = q.eq(source.membersProjectColumn!, projectId);
  if (userId) q = q.eq(source.membersUserColumn!, userId);

  const { data, error } = await q;
  if (error) return serverError(error.message);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  // Decorate with names, one query each, so the screen shows people and
  // projects rather than uuids.
  const userIds = [...new Set(rows.map((r) => String(r[source.membersUserColumn!])))];
  const projectIds = [...new Set(rows.map((r) => String(r[source.membersProjectColumn!])))];
  const [{ data: users }, { data: projects }] = await Promise.all([
    userIds.length
      ? sb.from('users').select('id, name, email').in('id', userIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    projectIds.length
      ? sb.from(source.table).select(`id, ${source.nameColumn}, ${source.ownerColumn}`).in('id', projectIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);
  const userById = new Map((users ?? []).map((u) => [String((u as { id: string }).id), u]));
  const projById = new Map((projects ?? []).map((p) => [String((p as { id: string }).id), p]));

  return NextResponse.json({
    members: rows.map((r) => {
      const uid = String(r[source.membersUserColumn!]);
      const pid = String(r[source.membersProjectColumn!]);
      const u = userById.get(uid) as { name?: string; email?: string } | undefined;
      const p = projById.get(pid) as Record<string, unknown> | undefined;
      const ownerId = p ? String(p[source.ownerColumn]) : null;
      return {
        projectId: pid,
        projectName: p ? String(p[source.nameColumn]) : null,
        userId: uid,
        userName: u?.name ?? null,
        userEmail: u?.email ?? null,
        role: String(r[source.membersRoleColumn!]),
        addedAt: r.added_at ?? null,
        // The screen greys the owner's own row: it cannot be changed here.
        isOwner: ownerId !== null && ownerId === uid,
      };
    }),
  });
}

// ── POST ────────────────────────────────────────────────────────────────────
// Body: { platform?, projectId, userId, role }
export async function POST(req: NextRequest) {
  const { res: denied, adminId } = await guard();
  if (denied) return denied;

  let body: { platform?: string; projectId?: string; userId?: string; role?: string };
  try { body = await req.json(); } catch { return badRequest('Body must be valid JSON.'); }

  const { source, error: srcErr } = sourceFor(body.platform ?? null);
  if (!source) return badRequest(srcErr!);
  if (!body.projectId) return badRequest('projectId is required.');
  if (!body.userId) return badRequest('userId is required.');
  // Rejected, never coerced: a typo must not silently become a viewer, and it
  // certainly must not become an owner.
  if (!isProjectRole(body.role)) {
    return badRequest(`role must be one of: ${PROJECT_ROLES.join(', ')}`);
  }

  const sb = getServerClient();
  const { data: proj, error: projErr } = await sb
    .from(source.table).select(`id, ${source.ownerColumn}`).eq('id', body.projectId).maybeSingle();
  if (projErr) return serverError(projErr.message);
  if (!proj) return badRequest('No such project.');

  const ownerId = String((proj as unknown as Record<string, unknown>)[source.ownerColumn]);
  if (ownerId === body.userId) {
    return badRequest(
      'This user owns the project. Ownership comes from the project row, not from a membership, so it cannot be changed here.',
    );
  }

  const { data: user, error: userErr } = await sb
    .from('users').select('id, email').eq('id', body.userId).maybeSingle();
  if (userErr) return serverError(userErr.message);
  if (!user) return badRequest('No such user.');

  // ── ACCOUNT BOUNDARY (account model step 2) ───────────────────────────
  //
  // BEFORE the seat check: a cross-account candidate must hear "wrong
  // account", never "no seats left", because the second message invites the
  // operator to buy a seat for a grant that must not happen at any price.
  // A failed read REFUSES for the same reason a failed seat count does: an
  // unmeasurable boundary must not become an accidental grant.
  let boundary;
  try {
    boundary = await checkAccountBoundary(sb, ownerId, body.userId);
  } catch (e) {
    return serverError(`Account boundary check failed, nothing was changed: ${(e as Error).message}`);
  }
  if (!boundary.allowed) {
    const { data: holder } = await sb.from('users').select('email').eq('id', ownerId).maybeSingle();
    return NextResponse.json({
      error: accountBoundaryMessage(
        (user as { email?: string } | null)?.email ?? null,
        (holder as { email?: string } | null)?.email ?? null,
      ),
      boundary: { reason: boundary.reason },
    }, { status: 403 });
  }

  // ── SEATS (Module 10 step 8) ──────────────────────────────────────────
  //
  // AFTER the user lookup, so a seat is never refused for someone who does
  // not exist, and BEFORE the upsert, so the refusal is a block and not a
  // warning after the fact.
  //
  // The account is the project's OWNER, because the plan is theirs. A role
  // change costs nothing: the decision asks whether this person already holds
  // a seat anywhere on the account, not whether a row is about to be written.
  let seat;
  try {
    seat = await checkSeatForMember(sb, ownerId, body.userId);
  } catch (e) {
    // A counting failure must not become an accidental grant. Refusing is the
    // safe direction: an admin can retry, whereas a seat handed out by an
    // errored read is invisible until someone audits it.
    return serverError(`Seat check failed, nothing was changed: ${(e as Error).message}`);
  }
  if (!seat.allowed) {
    const { data: holder } = await sb.from('users').select('email').eq('id', ownerId).maybeSingle();
    return NextResponse.json({
      error: seatBlockMessage(
        seat,
        (holder as { email?: string } | null)?.email ?? null,
        (user as { email?: string } | null)?.email ?? null,
      ),
      seat: { used: seat.used, wouldUse: seat.wouldUse, limit: seat.limit, source: seat.limitSource },
    }, { status: 409 });
  }

  // What was true BEFORE the write, so the notification can tell a real
  // change from a repeat (change detection is the first dedupe layer).
  const { data: prior } = await sb.from(source.membersTable!)
    .select(source.membersRoleColumn!)
    .eq(source.membersProjectColumn!, body.projectId)
    .eq(source.membersUserColumn!, body.userId)
    .maybeSingle();
  const previousRole = prior
    ? String((prior as unknown as Record<string, unknown>)[source.membersRoleColumn!])
    : null;

  const { error } = await sb.from(source.membersTable!).upsert({
    [source.membersProjectColumn!]: body.projectId,
    [source.membersUserColumn!]: body.userId,
    [source.membersRoleColumn!]: body.role,
    added_by: adminId,
  }, { onConflict: `${source.membersProjectColumn},${source.membersUserColumn}` });
  if (error) return serverError(error.message);

  // AFTER the successful write, and the outcome never affects it: the
  // notifier never throws, and a failed send costs a log line, not access.
  await notifyAccessGranted(sb, {
    platformKey: source.key, projectId: body.projectId, targetUserId: body.userId,
    actorUserId: adminId ?? body.userId, role: body.role, previousRole,
  });
  return NextResponse.json({ ok: true });
}

// ── DELETE ──────────────────────────────────────────────────────────────────
// ?projectId=...&userId=...
export async function DELETE(req: NextRequest) {
  const { res: denied, adminId } = await guard();
  if (denied) return denied;

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const userId = url.searchParams.get('userId');
  const { source, error: srcErr } = sourceFor(url.searchParams.get('platform'));
  if (!source) return badRequest(srcErr!);
  if (!projectId || !userId) return badRequest('projectId and userId are required.');

  const sb = getServerClient();
  const { data: proj } = await sb
    .from(source.table).select(`id, ${source.ownerColumn}`).eq('id', projectId).maybeSingle();
  if (proj && String((proj as unknown as Record<string, unknown>)[source.ownerColumn]) === userId) {
    return badRequest(
      'This user owns the project. Removing their membership would leave the project unreachable by its owner.',
    );
  }

  const { error, count } = await sb.from(source.membersTable!).delete({ count: 'exact' })
    .eq(source.membersProjectColumn!, projectId)
    .eq(source.membersUserColumn!, userId);
  if (error) return serverError(error.message);

  // AFTER the successful write; removing access nobody had sends nothing.
  await notifyAccessRemoved(sb, {
    platformKey: source.key, projectId, targetUserId: userId,
    actorUserId: adminId ?? userId, removed: (count ?? 0) > 0,
  });
  return NextResponse.json({ ok: true });
}
