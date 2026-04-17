import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const hub = sp.get('hub') ?? 'all';
  const status = sp.get('status') ?? 'active';

  const sb = getServerClient();
  let query = sb.from('newsletter_subscribers').select('email, hub, status, subscribed_at');
  if (hub !== 'all') query = query.eq('hub', hub);
  if (status !== 'all') query = query.eq('status', status);
  query = query.order('subscribed_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { email: string; hub: string; status: string; subscribed_at: string }[];
  const csv = ['email,hub,status,subscribed_at', ...rows.map(r => `${r.email},${r.hub},${r.status},${r.subscribed_at}`)].join('\n');

  const date = new Date().toISOString().split('T')[0];
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="newsletter-subscribers-${hub}-${date}.csv"`,
    },
  });
}
