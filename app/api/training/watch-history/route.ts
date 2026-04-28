import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/watch-history?email=xxx
 * Returns all session_watch_history rows for the given student email.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  const sb = getServerClient();

  const { data, error } = await sb
    .from('session_watch_history')
    .select('session_id, status, watch_percentage, watched_at, points_awarded')
    .eq('student_email', email);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ history: data ?? [] });
}
