import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import { isUserLivePaddle, PADDLE_BILLED_BLOCK_MESSAGE } from '@/src/shared/payments/config';

// Admin trial-request queue (used when "Trial requires approval" is on).
//   GET  -> pending requests joined with the requester's email/name/company/title.
//   POST -> { id, action: 'approve' | 'decline' }. Approve reuses the SHARED
//           setUserPlan(..., 'trial') (same path as every plan change), then
//           marks the row; decline just marks it. Tolerant if mig 173 is absent.

const PLATFORM = 'real-estate';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return null;
  return session;
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  const { data, error } = await sb
    .from('trial_requests')
    .select('id, user_id, status, company, job_title, created_at, users(email, name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  // Table absent (mig 173 not applied) -> empty queue, never error the admin UI.
  if (error) return NextResponse.json({ requests: [], migrationApplied: false });
  return NextResponse.json({ requests: data ?? [], migrationApplied: true });
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, action } = await req.json() as { id: string; action: 'approve' | 'decline' };
    if (!id || (action !== 'approve' && action !== 'decline')) {
      return NextResponse.json({ error: 'id and action (approve|decline) required' }, { status: 400 });
    }
    const sb = getServerClient();
    const adminId = (session.user as { id?: string }).id ?? null;

    const { data: reqRow, error: rErr } = await sb
      .from('trial_requests').select('id, user_id, status').eq('id', id).maybeSingle();
    if (rErr || !reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if ((reqRow as { status: string }).status !== 'pending') {
      return NextResponse.json({ error: 'Request already decided' }, { status: 409 });
    }
    const targetUserId = (reqRow as { user_id: string }).user_id;

    if (action === 'approve') {
      // Block approving a trial for a Paddle-billed user (no silent divergence).
      if (await isUserLivePaddle(sb, targetUserId, PLATFORM)) {
        return NextResponse.json({ error: PADDLE_BILLED_BLOCK_MESSAGE, code: 'paddle_billed' }, { status: 409 });
      }
      // SAME shared plan-setting path as admin plan changes.
      const res = await setUserPlan(sb, targetUserId, 'trial', { platform: PLATFORM, adminId });
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 });
    }

    await sb.from('trial_requests').update({
      status: action === 'approve' ? 'approved' : 'declined',
      decided_at: new Date().toISOString(),
      decided_by: adminId,
    }).eq('id', id);

    return NextResponse.json({ ok: true, action });
  } catch {
    return NextResponse.json({ error: 'Failed to process trial request' }, { status: 500 });
  }
}
