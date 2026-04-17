import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/live-sessions?type=upcoming|recorded&playlist_id=...
 * Public - returns published sessions with playlist info.
 */
export async function GET(req: NextRequest) {
  const type       = req.nextUrl.searchParams.get('type');
  const playlistId = req.nextUrl.searchParams.get('playlist_id');

  try {
    const sb = getServerClient();
    let query = sb
      .from('live_sessions')
      .select('*, live_playlists(id, name)')
      .eq('is_published', true);

    if (type === 'upcoming') {
      query = query.in('session_type', ['upcoming', 'live']).order('scheduled_datetime', { ascending: true });
    } else if (type === 'recorded') {
      query = query.eq('session_type', 'recorded').order('scheduled_datetime', { ascending: false });
    } else {
      query = query.order('display_order').order('scheduled_datetime', { ascending: false });
    }

    if (playlistId) query = query.eq('playlist_id', playlistId);

    const { data } = await query;

    // Fetch attachments for all sessions
    const sessionIds = (data ?? []).map(s => `LIVE_${s.id}`);
    let attachments: Record<string, unknown[]> = {};
    if (sessionIds.length) {
      const { data: atts } = await sb
        .from('course_attachments')
        .select('id, tab_key, file_name, file_url, file_type, file_size')
        .in('tab_key', sessionIds)
        .eq('is_visible', true);
      for (const a of atts ?? []) {
        const key = (a.tab_key as string).replace('LIVE_', '');
        if (!attachments[key]) attachments[key] = [];
        attachments[key].push(a);
      }
    }

    const sessions = (data ?? []).map(s => ({
      ...s,
      playlist: s.live_playlists,
      attachments: attachments[s.id] ?? [],
    }));

    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ sessions: [] });
  }
}
