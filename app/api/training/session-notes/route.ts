import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export const dynamic = 'force-dynamic';

/** GET /api/training/session-notes?sessionId=x&email=y */
export async function GET(req: NextRequest) {
  // The student is the SIGNED session (2026-09-26); any identity in the request is ignored.
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const email = sess.email;
  if (!sessionId || !email) {
    return NextResponse.json({ notes: '' });
  }

  const sb = getServerClient();
  const { data } = await sb
    .from('session_notes')
    .select('notes')
    .eq('session_id', sessionId)
    .eq('student_email', email)
    .maybeSingle();

  return NextResponse.json({ notes: data?.notes ?? '' });
}

/** POST /api/training/session-notes */
export async function POST(req: NextRequest) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  try {
    const { session_id, notes } = await req.json();
    const student_email = sess.email;
    if (!session_id || !student_email) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const sb = getServerClient();
    await sb.from('session_notes').upsert({
      session_id,
      student_email,
      notes: notes ?? '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id,student_email' });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
