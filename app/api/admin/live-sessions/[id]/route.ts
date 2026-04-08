import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** PATCH — update session */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = ['title', 'description', 'youtube_url', 'live_url', 'session_type', 'scheduled_datetime', 'timezone', 'category', 'playlist_id', 'is_published', 'display_order', 'banner_url', 'duration_minutes', 'max_attendees', 'difficulty_level', 'prerequisites', 'instructor_name', 'tags', 'is_featured', 'live_password', 'registration_url'];
  for (const k of allowed) {
    if (body[k] !== undefined) updates[k] = body[k] === '' && k === 'playlist_id' ? null : body[k];
  }

  const { error } = await sb.from('live_sessions').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE — delete session + attachments */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();
  await sb.from('course_attachments').delete().eq('tab_key', `LIVE_${id}`);
  const { error } = await sb.from('live_sessions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
