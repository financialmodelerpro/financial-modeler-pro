import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function POST(req: NextRequest) {
  try {
    const { registrationId, sessionKey, rating, comment } = await req.json() as {
      registrationId: string; sessionKey: string; rating: number; comment?: string;
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
