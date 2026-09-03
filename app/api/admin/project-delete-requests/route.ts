/**
 * /api/admin/project-delete-requests
 *
 *   GET  -> the pending queue, with the context needed to decide
 *   POST -> { id, action: 'approve' | 'decline', reason? }
 *
 * ADMIN ONLY. It sits under /api/admin and its screen is the PROJECTS BROWSER,
 * not the Plans page: approving a delete and restoring one from the Deleted
 * bin are the same job on the same objects, and splitting them across two
 * screens would mean an admin approving a delete on one page and undoing it on
 * another.
 *
 * ── APPROVAL CAN FAIL HONESTLY ────────────────────────────────────────────
 *
 * `already_deleted` is a real outcome, not an error path nobody hits: a
 * project can be soft-deleted by its Owner, or hard-deleted by an admin, while
 * a request sits pending. Approving then would update zero rows and, because a
 * service-role write reports no rows-affected, would have looked like success.
 * The engine reads the project first and refuses; this route turns that into a
 * 409 that says so, and LEAVES THE REQUEST PENDING so the admin can decline it
 * and tell the requester what happened.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { listPendingRequests, approveDeleteRequest, declineDeleteRequest } from '@/src/shared/admin/deleteRequests';

/** Admin only, returning the acting admin so a decision records a real person.
 *  Same shape as its siblings on this screen; `getServerSession` is called
 *  inside the handler because it throws without a request scope (TRAPS 9.4). */
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

export async function GET() {
  const { res: denied } = await guard();
  if (denied) return denied;

  const { rows, unavailable, error } = await listPendingRequests(getServerClient());
  if (error) return NextResponse.json({ error }, { status: 500 });
  // A pre-238 database reports the queue as unavailable rather than empty, so
  // the screen can say "not enabled" instead of the false "nobody has asked".
  return NextResponse.json({ available: !unavailable, requests: rows });
}

export async function POST(req: NextRequest) {
  const { res: denied, adminId } = await guard();
  if (denied || !adminId) return denied ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { id?: unknown; action?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body must be valid JSON.' }, { status: 400 }); }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const sb = getServerClient();

  if (body.action === 'approve') {
    const out = await approveDeleteRequest(sb, id, adminId);
    if (out.ok) return NextResponse.json({ ok: true, action: 'approved', projectName: out.projectName });
    const status = out.code === 'not_found' ? 404
      : out.code === 'already_deleted' || out.code === 'not_pending' ? 409
      : out.code === 'unavailable' ? 503 : 500;
    return NextResponse.json({ error: out.message, code: out.code }, { status });
  }

  if (body.action === 'decline') {
    const reason = typeof body.reason === 'string' ? body.reason : '';
    const out = await declineDeleteRequest(sb, id, adminId, reason);
    if (out.ok) return NextResponse.json({ ok: true, action: 'declined' });
    const status = out.code === 'not_found' ? 404 : out.code === 'not_pending' ? 409
      : out.code === 'unavailable' ? 503 : 400;
    return NextResponse.json({ error: out.message, code: out.code }, { status });
  }

  return NextResponse.json({ error: "action must be 'approve' or 'decline'." }, { status: 400 });
}
