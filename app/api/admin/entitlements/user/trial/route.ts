import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import { isUserLivePaddle, PADDLE_BILLED_BLOCK_MESSAGE } from '@/src/shared/payments/config';

// Trial approval shortcut: place a user on the Trial plan with an expiry. This
// is just setUserPlan(..., 'trial') -- the SAME shared plan-setting path the
// /admin/users + /admin/access plan selectors use. No second write path.
//
// SAFETY: a user with a LIVE Paddle subscription cannot be moved onto trial here
// (the SAME guard the plan route uses), so Paddle is never left billing a paid
// plan while the app shows trial.

async function checkAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return null;
  return session;
}

export async function POST(req: NextRequest) {
  const session = await checkAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { user_id, platform = 'real-estate' } = await req.json() as { user_id: string; platform?: string };
    const sb = getServerClient();
    // Block moving a Paddle-billed user onto trial (no silent divergence).
    if (await isUserLivePaddle(sb, user_id, platform)) {
      return NextResponse.json({ error: PADDLE_BILLED_BLOCK_MESSAGE, code: 'paddle_billed' }, { status: 409 });
    }
    const adminId = (session.user as { id?: string }).id ?? null;
    const res = await setUserPlan(sb, user_id, 'trial', { platform, adminId });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 500 });
    return NextResponse.json({ ok: true, trial_ends_at: res.trialEndsAt });
  } catch {
    return NextResponse.json({ error: 'Failed to approve trial' }, { status: 500 });
  }
}
