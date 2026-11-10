import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { withoutPrivateFields } from '@/src/hubs/training/lib/liveSessions/privateSessionFields';
import { applyCourseMedia } from '@/src/hubs/training/lib/liveCourse/courseMedia';
import { publicSessionFilter } from '@/src/hubs/training/lib/liveCourse/publicVisibility';
import { showInLiveSessions, withoutCourseRecordingLink } from '@/src/hubs/training/lib/liveCourse/recordingAccess';

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
      .eq('is_published', true)
      .or(await publicSessionFilter(sb));

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
    const attachments: Record<string, unknown[]> = {};
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

    // Unauthenticated route: the join link, password and dial-in never leave
    // here. A registered student gets them from the register status routes.
    // A course session with no banner shows the course banner (courseMedia.ts).
    // A course session is listed only while upcoming or live (once its recording
    // is added it lives in the course under My Courses), and never with its
    // recording link (recordingAccess.ts). Single sessions are unchanged.
    const now = Date.now();
    const listed = (data ?? []).filter((s) => showInLiveSessions(s, now)).map((s) => withoutCourseRecordingLink(s));
    const sessions = (await applyCourseMedia(sb, listed.map(s => withoutPrivateFields(s)))).map(s => ({
      ...s,
      playlist: (s as Record<string, unknown>).live_playlists,
      attachments: attachments[String((s as Record<string, unknown>).id)] ?? [],
    }));

    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ sessions: [] });
  }
}
