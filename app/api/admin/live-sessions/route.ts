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

/** PUT — upload banner image */
export async function PUT(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const sessionId = (form.get('sessionId') as string ?? '').trim();
    if (!file || !sessionId) return NextResponse.json({ error: 'file and sessionId required' }, { status: 400 });
    const sb = getServerClient();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `banners/${sessionId}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await sb.storage.from('live-session-banners').upload(path, bytes, { contentType: file.type, upsert: true });
    const { data: { publicUrl } } = sb.storage.from('live-session-banners').getPublicUrl(path);
    await sb.from('live_sessions').update({ banner_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', sessionId);
    return NextResponse.json({ success: true, url: publicUrl });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
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
    banner_url:         body.banner_url ?? null,
    duration_minutes:   body.duration_minutes ?? null,
    max_attendees:      body.max_attendees ?? null,
    difficulty_level:   body.difficulty_level ?? 'All Levels',
    prerequisites:      body.prerequisites ?? '',
    instructor_name:    body.instructor_name ?? 'Ahmad Din',
    tags:               body.tags ?? [],
    is_featured:        body.is_featured ?? false,
    live_password:      body.live_password ?? '',
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
