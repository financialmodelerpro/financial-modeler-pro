import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendAutoNewsletter } from '@/src/lib/newsletter/autoNotify';
import { sendSessionAnnouncement } from '@/src/lib/training/sessionAnnouncement';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** GET - list all sessions (admin sees unpublished too) */
export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data } = await sb.from('live_sessions').select('*, live_playlists(id, name)').order('display_order').order('created_at', { ascending: false });
  return NextResponse.json({ sessions: data ?? [] });
}

/** PUT - upload banner image */
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

/** POST - create session */
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();

  // Resolve instructor: prefer explicit instructor_id, else fall back to the
  // default instructor (if configured). Denormalize name/title so legacy
  // readers still work.
  let instructorId = (body.instructor_id as string | undefined) || null;
  let instructorName = (body.instructor_name as string | undefined) ?? '';
  let instructorTitle = (body.instructor_title as string | undefined) ?? '';
  if (!instructorId) {
    const { data: def } = await sb.from('instructors').select('id, name, title').eq('is_default', true).maybeSingle();
    if (def) {
      instructorId = def.id;
      if (!instructorName) instructorName = def.name;
      if (!instructorTitle) instructorTitle = def.title;
    }
  } else {
    const { data: inst } = await sb.from('instructors').select('name, title').eq('id', instructorId).maybeSingle();
    if (inst) { instructorName = inst.name; instructorTitle = inst.title; }
  }
  if (!instructorName) instructorName = 'Ahmad Din';

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
    instructor_id:      instructorId,
    instructor_name:    instructorName,
    instructor_title:   instructorTitle,
    tags:               body.tags ?? [],
    is_featured:        body.is_featured ?? false,
    live_password:      body.live_password ?? '',
    registration_url:   body.registration_url ?? '',
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data && data.is_published) {
    // Direct announcement to every confirmed training student. Previously
    // POST only fired the newsletter (which targets subscribers, not the
    // full training roster) so new upcoming sessions went out silently to
    // everyone who'd registered. PATCH already had this flow — POST was
    // the asymmetric gap, fixed here by sharing one helper. Fire-and-
    // forget so Resend latency never blocks the admin's create.
    void sendSessionAnnouncement(sb, data).catch((err: unknown) =>
      console.error('[live-sessions POST] announcement failed:', err),
    );

    const dt = data.scheduled_datetime ? new Date(data.scheduled_datetime) : null;
    void sendAutoNewsletter('live_session_scheduled', data.id, {
      title: data.title, description: data.description ?? '',
      url: data.live_url || `${LEARN_URL}/training/dashboard?tab=live-sessions`,
      date: dt?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) ?? '',
      extra: {
        time: dt?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) ?? '',
        platform: 'YouTube',
      },
    });
  }
  return NextResponse.json({ session: data });
}
