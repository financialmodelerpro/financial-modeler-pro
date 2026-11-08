import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { getLiveCourseSettings, isLiveCourseRow } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { joinStatusFrom, SESSION_ACCESS_COLUMNS, type SessionForAccess } from '@/src/hubs/training/lib/liveCourse/sessionAccess';
import { DEFAULT_OPENS_MINUTES_BEFORE } from '@/src/hubs/training/lib/liveCourse/joinWindow';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/live-sessions/registration-status-batch
 * Registration and Join status for many sessions at once, for the SIGNED
 * student. Same rules as the single-session GET (sessionAccess.ts): access is
 * a registration or an enrolment in the session's live course, and Join
 * follows THE window. The link returned is the logged join route.
 * Body: { sessionIds: string[] }
 */
export async function POST(req: NextRequest) {
  // The student is the SIGNED session (2026-09-26); any identity in the request is ignored.
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  try {
    const { sessionIds } = await req.json() as { sessionIds: string[]; email?: string };
    const email = sess.email;
    if (!email || !sessionIds?.length) {
      return NextResponse.json({ registrations: {} });
    }

    const sb = getServerClient();
    const lower = email.trim().toLowerCase();

    const [{ data: regs }, { data: sessions }, { data: enrolments }] = await Promise.all([
      sb.from('session_registrations').select('session_id').in('student_email', [lower, email]).in('session_id', sessionIds),
      sb.from('live_sessions').select(SESSION_ACCESS_COLUMNS).in('id', sessionIds),
      sb.from('training_enrollments').select('course_code').eq('registration_id', sess.registrationId),
    ]);

    const regSet = new Set((regs ?? []).map((r) => r.session_id as string));
    const enrolled = new Set((enrolments ?? []).map((e) => e.course_code as string));
    const sessionMap = new Map(((sessions ?? []) as SessionForAccess[]).map((s) => [s.id, s]));

    // Course rules, read once per course in this batch.
    const opensBy = new Map<string, number>();
    for (const code of new Set([...sessionMap.values()].map((s) => s.course_code).filter(Boolean) as string[])) {
      const c = await getLiveCourseSettings(sb, code);
      if (isLiveCourseRow(c)) opensBy.set(code, c.joinOpensMinutesBefore);
    }

    const registrations: Record<string, {
      registered: boolean; joinLinkAvailable: boolean; liveUrl: string | null;
      joinOpensAt: string | null; joinClosesAt: string | null;
    }> = {};
    for (const id of sessionIds) {
      const session = sessionMap.get(id);
      if (!session) { registrations[id] = { registered: false, joinLinkAvailable: false, liveUrl: null, joinOpensAt: null, joinClosesAt: null }; continue; }
      const registered = regSet.has(id) || (!!session.course_code && enrolled.has(session.course_code));
      const opens = session.course_code && opensBy.has(session.course_code)
        ? opensBy.get(session.course_code)!
        : (session.show_join_link_minutes_before ?? DEFAULT_OPENS_MINUTES_BEFORE);
      const st = joinStatusFrom(registered, session, opens);
      registrations[id] = {
        registered,
        joinLinkAvailable: st.canJoinNow,
        liveUrl: st.joinUrl,
        joinOpensAt: st.window?.opensAt ?? null,
        joinClosesAt: st.window?.closesAt ?? null,
      };
    }

    return NextResponse.json({ registrations });
  } catch {
    return NextResponse.json({ registrations: {} });
  }
}
