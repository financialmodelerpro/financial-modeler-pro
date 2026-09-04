/**
 * /api/account/team
 *
 *   GET    -> the holder's team surface: their projects, their people, who is
 *             on what
 *   POST   -> give a team member access to one of the holder's projects
 *             (body: { platform?, projectId, userId, role })
 *   DELETE -> remove that access (?projectId=&userId=)
 *
 * HOLDER-FACING, account model step 6: the scoped version of the admin Team
 * access screen. Every rule lives in `src/shared/account/team.ts`; this route
 * only authenticates and maps engine results to HTTP. The admin screen and
 * its route stay exactly as they are, the operator fallback.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { listTeam, assignTeamMember, removeTeamMember } from '@/src/shared/account/team';

async function requireUser(): Promise<{ res: NextResponse | null; userId: string | null }> {
  try {
    const session = await getServerSession(authOptions);
    const id = (session?.user as { id?: string } | undefined)?.id ?? null;
    if (!id) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null };
    return { res: null, userId: id };
  } catch {
    return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), userId: null };
  }
}

function writeStatus(code: string): number {
  return code === 'not_holder' ? 403
    : code === 'not_on_account' ? 403
    : code === 'no_project' ? 404
    : code === 'owner_immutable' ? 400
    : code === 'bad_role' ? 400
    : code === 'no_platform' ? 400 : 500;
}

export async function GET(req: NextRequest) {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  const platform = new URL(req.url).searchParams.get('platform') ?? 'refm';
  try {
    return NextResponse.json(await listTeam(getServerClient(), userId, platform));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  let body: { platform?: string; projectId?: string; userId?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be valid JSON.' }, { status: 400 }); }
  if (!body.projectId || !body.userId || !body.role) {
    return NextResponse.json({ error: 'projectId, userId and role are required.' }, { status: 400 });
  }
  const result = await assignTeamMember(getServerClient(), userId, {
    platformKey: body.platform, projectId: body.projectId, userId: body.userId, role: body.role,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: writeStatus(result.code) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const target = url.searchParams.get('userId');
  if (!projectId || !target) return NextResponse.json({ error: 'projectId and userId are required.' }, { status: 400 });
  const result = await removeTeamMember(getServerClient(), userId, {
    platformKey: url.searchParams.get('platform') ?? undefined, projectId, userId: target,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: writeStatus(result.code) });
  return NextResponse.json({ ok: true });
}
