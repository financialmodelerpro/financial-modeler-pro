import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/training-sessions?type=upcoming|recorded&category=...&limit=...
 * Public — no auth required. Returns published sessions without sensitive data.
 */
export async function GET(req: NextRequest) {
  const type     = req.nextUrl.searchParams.get('type');
  const category = req.nextUrl.searchParams.get('category');
  const limit    = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10);

  try {
    const sb = getServerClient();
    let query = sb
      .from('live_sessions')
      .select('id, title, description, session_type, scheduled_datetime, timezone, category, banner_url, duration_minutes, max_attendees, difficulty_level, instructor_name, tags, is_featured, youtube_url, playlist_id, live_playlists(id, name)')
      .eq('is_published', true);

    if (type === 'upcoming') {
      query = query.in('session_type', ['upcoming', 'live']).order('scheduled_datetime', { ascending: true });
    } else if (type === 'recorded') {
      query = query.eq('session_type', 'recorded').order('scheduled_datetime', { ascending: false });
    } else {
      query = query.order('scheduled_datetime', { ascending: false });
    }

    if (category) query = query.eq('category', category);
    query = query.limit(limit);

    const { data, error: queryErr } = await query;
    if (queryErr) {
      console.error('[public/training-sessions] Query error:', queryErr.message);
      return NextResponse.json({ sessions: [], error: queryErr.message });
    }

    // Get registration counts (non-blocking — if table doesn't exist, skip)
    const sessionIds = (data ?? []).map(s => s.id);
    let regCounts: Record<string, number> = {};
    if (sessionIds.length > 0) {
      try {
        const { data: regs } = await sb
          .from('session_registrations')
          .select('session_id')
          .in('session_id', sessionIds);
        for (const r of regs ?? []) {
          regCounts[r.session_id] = (regCounts[r.session_id] ?? 0) + 1;
        }
      } catch { /* registration counts are optional */ }
    }

    const sessions = (data ?? []).map(s => ({
      id: s.id,
      title: s.title,
      description: s.description,
      session_type: s.session_type,
      scheduled_datetime: s.scheduled_datetime,
      timezone: s.timezone,
      category: s.category,
      banner_url: s.banner_url,
      duration_minutes: s.duration_minutes,
      max_attendees: s.max_attendees,
      difficulty_level: s.difficulty_level,
      instructor_name: s.instructor_name,
      tags: s.tags,
      is_featured: s.is_featured,
      youtube_url: s.session_type === 'recorded' ? s.youtube_url : null,
      playlist: s.live_playlists,
      registration_count: regCounts[s.id] ?? 0,
    }));

    return NextResponse.json({ sessions });
  } catch (err) {
    console.error('[public/training-sessions] Error:', err);
    return NextResponse.json({ sessions: [] });
  }
}
