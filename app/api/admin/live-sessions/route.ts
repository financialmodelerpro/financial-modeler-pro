import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** GET — list all sessions (admin sees unpublished too) */
export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data } = await sb.from('live_sessions').select('*, live_playlists(id, name)').order('display_order').order('created_at', { ascending: false });
  return NextResponse.json({ sessions: data ?? [] });
}

/** POST — create session */
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();
  const { data, error } = await sb.from('live_sessions').insert({
    title:              body.title ?? '',
    description:        body.description ?? '',
    youtube_url:        body.youtube_url ?? '',
    live_url:           body.live_url ?? '',
    session_type:       body.session_type ?? 'recorded',
    scheduled_datetime: body.scheduled_datetime ?? null,
    timezone:           body.timezone ?? 'Asia/Riyadh',
    category:           body.category ?? '',
    playlist_id:        body.playlist_id || null,
    is_published:       body.is_published ?? false,
    display_order:      body.display_order ?? 0,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
