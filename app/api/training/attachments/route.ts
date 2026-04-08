import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/attachments?tabKey=3SFM_S1
 * Public — returns visible attachments for a session.
 */
export async function GET(req: NextRequest) {
  const tabKey = req.nextUrl.searchParams.get('tabKey');
  if (!tabKey) {
    return NextResponse.json({ attachments: [] });
  }

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('course_attachments')
      .select('id, tab_key, file_name, file_url, file_type, file_size')
      .eq('tab_key', tabKey)
      .eq('is_visible', true)
      .order('uploaded_at');

    return NextResponse.json({ attachments: data ?? [] });
  } catch {
    return NextResponse.json({ attachments: [] });
  }
}
