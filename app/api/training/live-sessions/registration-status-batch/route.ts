import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/live-sessions/registration-status-batch
 * Returns registration status for multiple sessions at once.
 * Body: { sessionIds: string[], email: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionIds, email } = await req.json() as { sessionIds: string[]; email: string };
    if (!email || !sessionIds?.length) {
      return NextResponse.json({ registrations: {} });
    }

    const sb = getServerClient();

    // Fetch registrations for this student
    const { data: regs } = await sb
      .from('session_registrations')
      .select('session_id')
      .eq('student_email', email)
      .in('session_id', sessionIds);

    // Fetch session info for join link timing
    const { data: sessions } = await sb
      .from('live_sessions')
      .select('id, scheduled_datetime, show_join_link_minutes_before, live_url')
      .in('id', sessionIds);

    const regSet = new Set((regs ?? []).map(r => r.session_id));
    const sessionMap = new Map((sessions ?? []).map(s => [s.id, s]));

    const registrations: Record<string, { registered: boolean; joinLinkAvailable: boolean }> = {};
    for (const id of sessionIds) {
      const registered = regSet.has(id);
      let joinLinkAvailable = false;
      if (registered) {
        const session = sessionMap.get(id);
        if (session?.scheduled_datetime) {
          const now = new Date();
          const sessionTime = new Date(session.scheduled_datetime);
          const minsBefore = session.show_join_link_minutes_before ?? 30;
          const showAt = new Date(sessionTime.getTime() - minsBefore * 60000);
          const endAt = new Date(sessionTime.getTime() + 180 * 60000); // 3 hours after start
          // Available from X min before until 3 hours after start, AND live_url must exist
          joinLinkAvailable = session.live_url ? (now >= showAt && now <= endAt) : false;
        }
      }
      registrations[id] = { registered, joinLinkAvailable };
    }

    return NextResponse.json({ registrations });
  } catch {
    return NextResponse.json({ registrations: {} });
  }
}
