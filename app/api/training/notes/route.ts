import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/supabase';

export async function GET(req: NextRequest) {
  const registrationId = req.nextUrl.searchParams.get('registrationId');
  if (!registrationId) return NextResponse.json({ notes: [] });
  const sb = getServerClient();
  const { data } = await sb.from('student_notes').select('session_key,content,updated_at').eq('registration_id', registrationId);
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const { registrationId, sessionKey, content } = await req.json() as { registrationId: string; sessionKey: string; content: string };
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
