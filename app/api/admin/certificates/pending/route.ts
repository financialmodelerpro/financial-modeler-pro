import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { findAllEligibleFromSupabase } from '@/src/lib/training/certificateEligibility';
import { COURSES } from '@/src/config/courses';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/certificates/pending
 *
 * Safety-net view: every (email, course_code) that has `final_passed=true`
 * in the certificate_eligibility_raw view and no `Issued` row in
 * student_certificates. Populates the "Eligible but not issued" panel on
 * /admin/training-hub/certificates so an operator can trigger cert generation
 * for anyone the inline-trigger missed (network blip, PDF lib crash, etc.).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const eligible = await findAllEligibleFromSupabase();
    const reallyEligible = eligible.filter(e => e.eligible);
    if (reallyEligible.length === 0) {
      return NextResponse.json({ pending: [] });
    }

    const sb = getServerClient();
    const emails = [...new Set(reallyEligible.map(e => e.email.toLowerCase()))];
    const { data: metas } = await sb
      .from('training_registrations_meta')
      .select('email, registration_id, name')
      .in('email', emails);
    const metaByEmail = new Map<string, { registrationId: string; name: string }>();
    for (const m of metas ?? []) {
      metaByEmail.set((m.email as string).toLowerCase(), {
        registrationId: (m.registration_id as string) ?? '',
        name:           (m.name as string) ?? '',
      });
    }

    // Most recent pass timestamp across all that student's sessions for this course.
    const { data: completions } = await sb
      .from('training_assessment_results')
      .select('email, tab_key, passed, completed_at, is_final')
      .in('email', emails)
      .eq('passed', true);
    const passAtByKey = new Map<string, string>();
    for (const c of completions ?? []) {
      const email = (c.email as string).toLowerCase();
      const tk = (c.tab_key as string) ?? '';
      const courseCode = tk.toUpperCase().startsWith('BVM') ? 'BVM' : '3SFM';
      const key = `${email}|${courseCode}`;
      const existing = passAtByKey.get(key);
      const ts = (c.completed_at as string) ?? '';
      if (ts && (!existing || ts > existing)) passAtByKey.set(key, ts);
    }

    const pending = reallyEligible.map(e => {
      const emailKey = e.email.toLowerCase();
      const courseCode = e.course.toUpperCase();
      const meta = metaByEmail.get(emailKey);
      const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === courseCode);
      return {
        email:          e.email,
        name:           meta?.name ?? '',
        registrationId: meta?.registrationId ?? '',
        courseCode,
        courseName:     course?.title ?? courseCode,
        finalScore:     e.finalScore ?? null,
        avgScore:       e.avgScore ?? null,
        passedAt:       passAtByKey.get(`${emailKey}|${courseCode}`) ?? null,
      };
    });

    return NextResponse.json({ pending });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
