import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext } from '@/src/shared/payments/subscriptionContext';
import { listSubscriptionInvoices } from '@/src/shared/payments/paddleApi';

// GET /api/payments/invoices
// Lists the signed-in user's invoices / receipts for their subscription from
// Paddle's API (server-side). Each row carries the transaction id; the PDF is
// fetched on demand via /api/payments/invoice/[id] (which keeps the API key
// server-side and redirects to the Paddle-hosted signed URL). A user with no
// subscription gets an empty list, not an error.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getServerClient();
  const ctx = await loadUserPaddleContext(sb, userId);
  if (ctx.state !== 'ok' || !ctx.subscriptionId) {
    return NextResponse.json({ invoices: [], reason: ctx.state });
  }

  const res = await listSubscriptionInvoices(ctx.cfg, ctx.subscriptionId);
  if (!res.ok) {
    return NextResponse.json({ invoices: [], reason: res.error }, { status: res.status >= 500 ? 502 : 200 });
  }
  return NextResponse.json({ invoices: res.data });
}
