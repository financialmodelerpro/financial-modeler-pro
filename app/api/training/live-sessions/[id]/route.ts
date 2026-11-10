import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { withoutPrivateFields } from '@/src/hubs/training/lib/liveSessions/privateSessionFields';
import { applyCourseMedia } from '@/src/hubs/training/lib/liveCourse/courseMedia';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { loadRecordingUnlock, withoutCourseRecordingLink } from '@/src/hubs/training/lib/liveCourse/recordingAccess';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getServerClient();

  const [{ data: session }, { data: atts }] = await Promise.all([
    sb.from('live_sessions').select('*, live_playlists(id, name)').eq('id', id).eq('is_published', true).maybeSingle(),
    sb.from('course_attachments').select('id, file_name, file_url, file_type, file_size').eq('tab_key', `LIVE_${id}`).eq('is_visible', true),
  ]);

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // A COURSE session's recording only for a signed, enrolled student it is
  // unlocked for (recordingAccess.ts); anyone else gets the marker and the
  // reason. A single session is unchanged.
  let row: Record<string, unknown> = withoutPrivateFields(session);
  let recordingLocked: string | null = null;
  if (session.course_code && session.youtube_url) {
    const unlock = await loadRecordingUnlock(sb, await getTrainingCookieSession(), session);
    if (!unlock.unlocked) { row = withoutCourseRecordingLink(row); recordingLocked = unlock.message; }
  }

  return NextResponse.json({
    // Unauthenticated route: no join link, password or dial-in (see privateSessionFields).
    // A course session: the course banner when it has none, and the course's time zones.
    session: { ...(await applyCourseMedia(sb, [row]))[0], playlist: session.live_playlists, attachments: atts ?? [], recording_locked: recordingLocked },
  });
}
