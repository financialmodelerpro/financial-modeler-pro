import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/training-sessions/[id]
 * Public - returns single session detail without sensitive data.
 * NEVER exposes live_url or live_password.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('live_sessions')
      .select('id, title, description, session_type, scheduled_datetime, timezone, category, banner_url, duration_minutes, max_attendees, difficulty_level, prerequisites, instructor_name, tags, is_featured, youtube_url, youtube_embed, playlist_id, live_playlists(id, name)')
      .eq('id', id)
      .eq('is_published', true)
      .single();

    if (!data) {
      return NextResponse.json({ session: null }, { status: 404 });
    }

    // Registration count
    const { count } = await sb
      .from('session_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', id);

    // Attachments (names only for public view)
    const { data: atts } = await sb
      .from('course_attachments')
      .select('id, file_name, file_type, file_size')
      .eq('tab_key', `LIVE_${id}`)
      .eq('is_visible', true);

    // Related sessions (same category or playlist)
    let related: { id: string; title: string; banner_url: string | null; session_type: string; scheduled_datetime: string; duration_minutes: number | null; instructor_name: string; difficulty_level: string; youtube_url: string | null }[] = [];
    if (data.playlist_id || data.category) {
      let rq = sb
        .from('live_sessions')
        .select('id, title, banner_url, session_type, scheduled_datetime, duration_minutes, instructor_name, difficulty_level, youtube_url')
        .eq('is_published', true)
        .neq('id', id)
        .limit(3);
      if (data.playlist_id) rq = rq.eq('playlist_id', data.playlist_id);
      else if (data.category) rq = rq.eq('category', data.category);
      const { data: relData } = await rq;
      related = (relData ?? []) as typeof related;
    }

    return NextResponse.json({
      session: {
        id: data.id,
        title: data.title,
        description: data.description,
        session_type: data.session_type,
        scheduled_datetime: data.scheduled_datetime,
        timezone: data.timezone,
        category: data.category,
        banner_url: data.banner_url,
        duration_minutes: data.duration_minutes,
        max_attendees: data.max_attendees,
        difficulty_level: data.difficulty_level,
        prerequisites: data.prerequisites,
        instructor_name: data.instructor_name,
        tags: data.tags,
        is_featured: data.is_featured,
        youtube_url: data.session_type === 'recorded' ? data.youtube_url : null,
        youtube_embed: data.youtube_embed ?? false,
        playlist: data.live_playlists,
        registration_count: count ?? 0,
        attachments: (atts ?? []).map(a => ({ file_name: a.file_name, file_type: a.file_type, file_size: a.file_size })),
        related: related.map(r => ({
          id: r.id, title: r.title, banner_url: r.banner_url,
          session_type: r.session_type, scheduled_datetime: r.scheduled_datetime,
          duration_minutes: r.duration_minutes, instructor_name: r.instructor_name,
          difficulty_level: r.difficulty_level,
          youtube_url: r.session_type === 'recorded' ? r.youtube_url : null,
        })),
      },
    });
  } catch {
    return NextResponse.json({ session: null }, { status: 500 });
  }
}
