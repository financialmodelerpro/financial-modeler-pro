import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext } from '@/src/shared/payments/subscriptionContext';
import { getInvoicePdfUrl, listSubscriptionInvoices } from '@/src/shared/payments/paddleApi';

// GET /api/payments/invoice/[id]
// Redirects to the Paddle-hosted, signed invoice/receipt PDF for one of the
// signed-in user's transactions. The Paddle API key is used server-side only;
// the client receives a 302 to the time-limited Paddle URL.
//
// OWNERSHIP: the transaction id is verified to belong to THIS user's
// subscription (it must appear in their transaction list) before any URL is
// issued, so a user cannot fetch another customer's invoice by id.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getServerClient();
  const pctx = await loadUserPaddleContext(sb, userId);
  if (pctx.state !== 'ok' || !pctx.subscriptionId) {
    return NextResponse.json({ error: 'no_subscription' }, { status: 404 });
  }

  // Ownership check: the requested transaction must be one of this user's.
  const list = await listSubscriptionInvoices(pctx.cfg, pctx.subscriptionId);
  if (!list.ok || !list.data.some((inv) => inv.transactionId === id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const res = await getInvoicePdfUrl(pctx.cfg, id);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status >= 500 ? 502 : 404 });
  }
  return NextResponse.redirect(res.data, 302);
}
