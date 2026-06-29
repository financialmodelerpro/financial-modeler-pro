import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { aggregateRevenue } from '@/src/shared/payments/config';

// GET /api/admin/revenue?from=ISO&to=ISO&platform=slug
// Total revenue across ALL users from the local ledger (payment_transactions),
// with a Paddle vs manual split + a by-plan breakdown, over a date range. The
// Paddle portion is reconcilable (each ledger row = a Paddle transaction id). One
// DB read, no per-user Paddle calls. `platform` is optional (structured so a
// per-platform split can be added later without rework).
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const platform = req.nextUrl.searchParams.get('platform');
  const sb = getServerClient();
  const summary = await aggregateRevenue(sb, { from, to, platform });
  return NextResponse.json({ ok: true, from, to, platform, summary });
}
