import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const hub = sp.get('hub') ?? 'all';
  const status = sp.get('status') ?? 'active';
  const search = sp.get('search') ?? '';
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  const sb = getServerClient();

  // Build query
  let query = sb.from('newsletter_subscribers').select('*', { count: 'exact' });
  if (hub !== 'all') query = query.eq('hub', hub);
  if (status !== 'all') query = query.eq('status', status);
  if (search) query = query.ilike('email', `%${search}%`);
  query = query.order('subscribed_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get counts for stats
  const { count: totalActive } = await sb.from('newsletter_subscribers').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: trainingActive } = await sb.from('newsletter_subscribers').select('*', { count: 'exact', head: true }).eq('status', 'active').eq('hub', 'training');
  const { count: modelingActive } = await sb.from('newsletter_subscribers').select('*', { count: 'exact', head: true }).eq('status', 'active').eq('hub', 'modeling');
  const { count: unsubscribed } = await sb.from('newsletter_subscribers').select('*', { count: 'exact', head: true }).eq('status', 'unsubscribed');

  return NextResponse.json({
    subscribers: data ?? [],
    total: count ?? 0,
    page,
    limit,
    stats: {
      totalActive: totalActive ?? 0,
      trainingActive: trainingActive ?? 0,
      modelingActive: modelingActive ?? 0,
      unsubscribed: unsubscribed ?? 0,
    },
  });
}
