import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';

export async function POST(req: NextRequest) {
  // The student is the SIGNED session (2026-09-26); any identity in the request is ignored.
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const registrationId = sess.registrationId;
  try {
    const { sessionKey, rating, comment } = await req.json() as {
      registrationId?: string; sessionKey: string; rating: number; comment?: string;
    };
    if (!registrationId || !sessionKey || !rating) return NextResponse.json({ ok: false }, { status: 400 });
    const sb = getServerClient();
    const { error } = await sb.from('session_feedback').upsert(
      { registration_id: registrationId, session_key: sessionKey, rating, comment: comment ?? null },
      { onConflict: 'registration_id,session_key' }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
