import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

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
    session: { ...session, playlist: session.live_playlists, attachments: atts ?? [] },
  });
}
