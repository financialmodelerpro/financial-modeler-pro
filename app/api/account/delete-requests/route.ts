/**
 * /api/account/delete-requests
 *
 *   GET  -> pending delete requests on the caller's OWN projects
 *   POST -> decide one: { requestId, action: 'approve' | 'decline', reason? }
 *
 * HOLDER-FACING, account model step 7. Every rule lives in
 * `src/shared/account/deleteQueue.ts`, which reuses the admin decision engine
 * verbatim; this route only authenticates and maps outcomes to HTTP. The
 * admin queue on the Projects Browser is untouched and still sees everything.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { listHolderDeleteRequests, decideHolderDeleteRequest } from '@/src/shared/account/deleteQueue';

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

export async function GET() {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  try {
    return NextResponse.json(await listHolderDeleteRequests(getServerClient(), userId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { res, userId } = await requireUser();
  if (res || !userId) return res!;
  let body: { requestId?: string; action?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be valid JSON.' }, { status: 400 }); }
  if (!body.requestId || !body.action) {
    return NextResponse.json({ error: 'requestId and action are required.' }, { status: 400 });
  }
  const result = await decideHolderDeleteRequest(
    getServerClient(), userId, body.requestId,
    body.action as 'approve' | 'decline', body.reason,
  );
  if (!result.ok) {
    const status =
      result.code === 'not_holder' ? 403 :
      result.code === 'no_request' ? 404 :
      result.code === 'bad_action' ? 400 :
      result.code === 'not_pending' ? 409 :
      result.code === 'already_deleted' ? 409 :
      result.code === 'unavailable' ? 503 :
      result.code === 'not_found' ? 404 : 500;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, action: result.action, projectName: result.projectName });
}
