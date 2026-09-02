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
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { PROJECT_SOURCES, getProjectSource, hasMembership } from '@/src/shared/admin/projectSources';
import { isProjectRole, PROJECT_ROLES } from '@/src/core/collab/projectRoles';

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
// ?projectId=...  members of that project
// ?userId=...     memberships held by that user
// (neither)       the platforms that support membership, for the picker
export async function GET(req: NextRequest) {
  const { res: denied } = await guard();
  if (denied) return denied;

  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const userId = url.searchParams.get('userId');
  const { source, error: srcErr } = sourceFor(url.searchParams.get('platform'));

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
    .from('users').select('id').eq('id', body.userId).maybeSingle();
  if (userErr) return serverError(userErr.message);
  if (!user) return badRequest('No such user.');

  const { error } = await sb.from(source.membersTable!).upsert({
    [source.membersProjectColumn!]: body.projectId,
    [source.membersUserColumn!]: body.userId,
    [source.membersRoleColumn!]: body.role,
    added_by: adminId,
  }, { onConflict: `${source.membersProjectColumn},${source.membersUserColumn}` });
  if (error) return serverError(error.message);
  return NextResponse.json({ ok: true });
}

// ── DELETE ──────────────────────────────────────────────────────────────────
// ?projectId=...&userId=...
export async function DELETE(req: NextRequest) {
  const { res: denied } = await guard();
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

  const { error } = await sb.from(source.membersTable!).delete()
    .eq(source.membersProjectColumn!, projectId)
    .eq(source.membersUserColumn!, userId);
  if (error) return serverError(error.message);
  return NextResponse.json({ ok: true });
}
