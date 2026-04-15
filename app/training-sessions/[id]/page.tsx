import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { getServerClient } from '@/src/lib/shared/supabase';
import { DetailClient, type DetailSession } from './DetailClient';

export const dynamic = 'force-dynamic';

async function getSession(id: string): Promise<DetailSession | null> {
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('live_sessions')
      .select('id, title, description, session_type, scheduled_datetime, timezone, category, banner_url, duration_minutes, max_attendees, difficulty_level, prerequisites, instructor_name, instructor_title, tags, is_featured, youtube_url, youtube_embed, show_like_button, playlist_id, live_playlists(id, name)')
      .eq('id', id)
      .eq('is_published', true)
      .single();

    if (error || !data) return null;

    // Registration count
    const { count } = await sb
      .from('session_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', id);

    // Attachments (names only)
    const { data: atts } = await sb
      .from('course_attachments')
      .select('file_name, file_type, file_size')
      .eq('tab_key', `LIVE_${id}`)
      .eq('is_visible', true);

    // Related sessions
    let related: DetailSession['related'] = [];
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
      related = ((relData ?? []) as DetailSession['related']).map(r => ({
        ...r,
        youtube_url: r.session_type === 'recorded' ? r.youtube_url : null,
      }));
    }

    return {
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
      instructor_title: data.instructor_title ?? null,
      tags: data.tags,
      is_featured: data.is_featured,
      youtube_url: data.session_type === 'recorded' ? data.youtube_url : null,
      youtube_embed: data.youtube_embed ?? false,
      show_like_button: (data as Record<string, unknown>).show_like_button !== false,
      playlist: (Array.isArray(data.live_playlists) ? data.live_playlists[0] : data.live_playlists) as DetailSession['playlist'],
      registration_count: count ?? 0,
      attachments: (atts ?? []).map(a => ({ file_name: a.file_name, file_type: a.file_type, file_size: a.file_size })),
      related,
    };
  } catch (err) {
    console.error('[training-sessions/detail] Error:', err);
    return null;
  }
}

export default async function PublicSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />
      <DetailClient session={session} />
      <SharedFooter
        company="Financial Modeler Pro"
        founder="Ahmad Din"
        copyright={`\u00A9 ${new Date().getFullYear()} Financial Modeler Pro`}
        height="compact"
      />
    </div>
  );
}
