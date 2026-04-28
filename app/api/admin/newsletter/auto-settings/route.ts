import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('newsletter_auto_settings')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { event_type, enabled } = await req.json() as { event_type: string; enabled: boolean };
    if (!event_type || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'event_type and enabled required' }, { status: 400 });
    }

    const sb = getServerClient();
    const { error } = await sb
      .from('newsletter_auto_settings')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('event_type', event_type);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
  }
}
