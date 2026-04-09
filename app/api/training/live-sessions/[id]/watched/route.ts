import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/live-sessions/[id]/watched
 * Records that a student watched a recording. Awards 50 points on first watch.
 * Body: { email, regId }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const { email, regId } = await req.json() as { email: string; regId: string };
    if (!email) return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });

    const sb = getServerClient();

    // Insert watch record (UNIQUE constraint prevents duplicates)
    const { error: insertErr } = await sb
      .from('session_watch_history')
      .insert({ session_id: id, student_email: email, student_reg_id: regId, points_awarded: 50 });

    if (insertErr) {
      // Duplicate — already watched
      if (insertErr.code === '23505') {
        return NextResponse.json({ success: true, pointsAwarded: 0, alreadyWatched: true });
      }
      console.error('[watched] Insert error:', insertErr.message);
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
    }

    // Award 50 points
    const { data: profile } = await sb
      .from('student_profiles')
      .select('total_points')
      .eq('registration_id', regId)
      .maybeSingle();

    if (profile) {
      await sb
        .from('student_profiles')
        .update({ total_points: (profile.total_points ?? 0) + 50 })
        .eq('registration_id', regId);
    }

    return NextResponse.json({ success: true, pointsAwarded: 50, alreadyWatched: false });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
