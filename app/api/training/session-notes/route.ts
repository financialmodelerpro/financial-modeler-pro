import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/** GET /api/training/session-notes?sessionId=x&email=y */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const email = req.nextUrl.searchParams.get('email');
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
  try {
    const { session_id, student_email, notes } = await req.json();
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
