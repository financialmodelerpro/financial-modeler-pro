import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { enrolInLiveCourse } from '@/src/hubs/training/lib/liveCourse/enrolment';
import { normaliseCourseCode } from '@/src/hubs/training/lib/liveCourse/courseSettings';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/enroll  { courseCode }
 * One-click enrolment in a live course for the SIGNED student (dashboard
 * Enrol button, and a returning student arriving from the public page).
 * Identity comes only from the cookie. Idempotent.
 */
export async function POST(req: NextRequest) {
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { courseCode?: string; from?: string };
  const courseCode = normaliseCourseCode(body.courseCode);
  if (!courseCode) return NextResponse.json({ error: 'A course is required.' }, { status: 400 });

  const sb = getServerClient();
  const { data: meta } = await sb
    .from('training_registrations_meta')
    .select('name')
    .eq('registration_id', sess.registrationId)
    .maybeSingle();

  const result = await enrolInLiveCourse(sb, {
    registrationId: sess.registrationId,
    email: sess.email,
    name: (meta?.name as string | null) ?? null,
    courseCode,
    // A returning student sent here by the public page's sign-in link.
    source: body.from === 'public_page' ? 'public_page' : 'dashboard',
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
