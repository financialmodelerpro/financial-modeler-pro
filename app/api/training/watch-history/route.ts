import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/watch-history?email=xxx
 * Returns all session_watch_history rows for the given student email.
 */
export async function GET(req: NextRequest) {
  // The student is the SIGNED session (2026-09-26); any identity in the request is ignored.
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  void req;
  const email = sess.email;
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
