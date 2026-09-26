import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export async function GET(req: NextRequest) {
  // The student is the SIGNED session (2026-09-26); any identity in the request is ignored.
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  void req;
  const registrationId = sess.registrationId;
  if (!registrationId) return NextResponse.json({ notes: [] });
  const sb = getServerClient();
  const { data } = await sb.from('student_notes').select('session_key,content,updated_at').eq('registration_id', registrationId);
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const registrationId = sess.registrationId;
  try {
    const { sessionKey, content } = await req.json() as { registrationId?: string; sessionKey: string; content: string };
    if (!registrationId || !sessionKey) return NextResponse.json({ ok: false }, { status: 400 });
    const sb = getServerClient();
    await sb.from('student_notes').upsert(
      { registration_id: registrationId, session_key: sessionKey, content: content ?? '', updated_at: new Date().toISOString() },
      { onConflict: 'registration_id,session_key' }
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
