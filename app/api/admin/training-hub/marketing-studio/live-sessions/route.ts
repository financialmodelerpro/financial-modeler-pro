import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('live_sessions')
    .select('id, title, scheduled_datetime, timezone, duration_minutes, instructor_name, instructor_title, session_type, banner_url')
    .order('scheduled_datetime', { ascending: false })
    .limit(60);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sessions: data ?? [] });
}
