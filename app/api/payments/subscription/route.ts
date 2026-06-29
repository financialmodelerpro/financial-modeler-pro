import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext } from '@/src/shared/payments/subscriptionContext';
import { getSubscription } from '@/src/shared/payments/paddleApi';

// GET /api/payments/subscription
// Returns the signed-in user's subscription summary, read from Paddle's API on
// the SERVER (the API key never reaches the client). A user with no subscription
// (trial / none / not configured) gets a clean { subscription: null } state, not
// an error, so the panel can render an appropriate empty state.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId);
  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    // No managed subscription on record: not an error, just nothing to show.
    return NextResponse.json({ subscription: null, reason: ctx.state });
  }

  const res = await getSubscription(ctx.cfg, ctx.subscriptionId);
  if (!res.ok) {
    return NextResponse.json({ subscription: null, reason: res.error }, { status: res.status >= 500 ? 502 : 200 });
  }
  return NextResponse.json({ subscription: res.data });
}
