import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { clearScheduledChange } from '@/src/shared/payments/config';

// POST /api/payments/subscription/cancel-scheduled-change?platform=<slug>
// Cancels a PENDING deferred downgrade before it applies, so the user stays on
// their current plan. This is app-side scheduling (mig 178), so cancelling is
// just clearing the stored fields; Paddle was never touched for the downgrade.
// Does not change the user's plan or entitlements.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || DEFAULT_PAYMENTS_PLATFORM;
  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId, platform);
  if (!ctx.scheduled) {
    return NextResponse.json({ ok: false, reason: 'no_scheduled_change' }, { status: 400 });
  }
  await clearScheduledChange(sb, userId, platform);
  return NextResponse.json({ ok: true });
}
