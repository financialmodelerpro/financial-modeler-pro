import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { issueCertificateForPending } from '@/src/lib/training/certificateEngine';
import { COURSES } from '@/src/config/courses';
import type { PendingCertificate } from '@/src/lib/training/sheets';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/certificates/force-issue
 *
 * Admin-only override that generates a certificate for a specific student +
 * course, bypassing the watch-threshold check. Useful for fixing stuck
 * records (e.g., historical accounts that predate the watch-tracking
 * system) without having to manipulate Apps Script directly.
 *
 * Body: { email: string; courseCode: string }   // e.g. "3SFM" or "BVM"
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const adminEmail = (session.user as { email?: string }).email ?? 'unknown';

  try {
    const body = await req.json() as { email?: string; courseCode?: string };
    const email = (body.email ?? '').toLowerCase().trim();
    const code = (body.courseCode ?? '').toUpperCase().trim();
    if (!email || !code) {
      return NextResponse.json({ error: 'email and courseCode required' }, { status: 400 });
    }

    const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === code);
    if (!course) {
      return NextResponse.json({ error: `Unknown course code: ${code}` }, { status: 400 });
    }

    const sb = getServerClient();
    const { data: meta } = await sb
      .from('training_registrations_meta')
      .select('registration_id, name')
      .eq('email', email)
      .maybeSingle();
    if (!meta) {
      return NextResponse.json({ error: `No student record for ${email}` }, { status: 404 });
    }

    // Pull score summary from training_assessment_results so the cert still
    // carries meaningful numbers (grade computed from these inside the engine).
    const { data: attempts } = await sb
      .from('training_assessment_results')
      .select('score, passed, is_final')
      .eq('email', email)
      .ilike('tab_key', `${code}\\_%`);
    const passedFinal = (attempts ?? []).find(a => a.passed && a.is_final);
    const regularScores = (attempts ?? []).filter(a => a.passed && !a.is_final).map(a => Number(a.score ?? 0));
    const avg = regularScores.length ? Math.round(regularScores.reduce((a, b) => a + b, 0) / regularScores.length) : 0;

    const pending: PendingCertificate = {
      registrationId:    meta.registration_id ?? '',
      email,
      studentName:       meta.name ?? '',
      courseName:        course.title,
      courseCode:        code,
      courseSubheading:  '',
      courseDescription: course.description ?? '',
      finalScore:        Number(passedFinal?.score ?? 0),
      avgScore:          avg,
      grade:             '',
      completionDate:    new Date().toISOString(),
    };

    const result = await issueCertificateForPending(pending, {
      force: true,
      issuedVia: 'forced',
      forcedByAdmin: adminEmail,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      certificateId: result.certificateId,
      certPdfUrl:    result.certPdfUrl,
      badgeUrl:      result.badgeUrl,
      verificationUrl: result.verificationUrl,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
