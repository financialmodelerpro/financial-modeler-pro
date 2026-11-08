import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import {
  SESSION_ACCESS_COLUMNS, studentHasSessionAccess, opensMinutesBeforeFor, joinStatusFrom,
  type SessionForAccess,
} from '@/src/hubs/training/lib/liveCourse/sessionAccess';

export const dynamic = 'force-dynamic';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

/**
 * GET /api/training/live-sessions/[id]/join
 *
 * The ONLY way a browser reaches a meeting link. Checks the signed student has
 * access (registered, or enrolled in the session's live course) and that the
 * join window is open, logs the click, then redirects to Teams. Anything else
 * goes back to the session page with a reason, never to the link.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionPage = `${LEARN_URL}/training/live-sessions/${encodeURIComponent(id)}`;
  const back = (reason: string) => NextResponse.redirect(`${sessionPage}?join=${reason}`, 302);

  const sess = await getTrainingCookieSession();
  if (!sess) {
    return NextResponse.redirect(`${LEARN_URL}/signin?redirect=${encodeURIComponent(`/training/live-sessions/${id}`)}`, 302);
  }

  const sb = getServerClient();
  const { data } = await sb.from('live_sessions').select(SESSION_ACCESS_COLUMNS).eq('id', id).maybeSingle();
  const session = data as SessionForAccess | null;
  if (!session) return back('not-found');

  const hasAccess = await studentHasSessionAccess(sb, sess, session);
  if (!hasAccess) return back('not-registered');
  const status = joinStatusFrom(hasAccess, session, await opensMinutesBeforeFor(sb, session));
  if (!session.live_url) return back('no-link');
  if (status.state === 'before') return back('not-open');
  if (status.state === 'ended') return back('ended');

  // Log, then go. A failed log never blocks a student from their session.
  const { error } = await sb.from('live_session_join_clicks').insert({
    session_id: id,
    student_email: sess.email.toLowerCase(),
    registration_id: sess.registrationId ?? null,
    user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
  });
  if (error) console.error('[live-sessions/join] click log failed', { id, error: error.message });

  return NextResponse.redirect(session.live_url, 302);
}
