import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { withoutPrivateFields } from '@/src/hubs/training/lib/liveSessions/privateSessionFields';
import { applyCourseMedia } from '@/src/hubs/training/lib/liveCourse/courseMedia';

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

  return NextResponse.json({
    // Unauthenticated route: no join link, password or dial-in (see privateSessionFields).
    // A course session: the course banner when it has none, and the course's time zones.
    session: { ...(await applyCourseMedia(sb, [withoutPrivateFields(session)]))[0], playlist: session.live_playlists, attachments: atts ?? [] },
  });
}
