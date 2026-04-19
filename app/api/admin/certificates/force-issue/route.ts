import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { issueCertificateForPending } from '@/src/lib/training/certificateEngine';
import { listAllStudents } from '@/src/lib/training/sheets';
import { COURSES } from '@/src/config/courses';
import type { PendingCertificate } from '@/src/lib/training/sheets';

export const dynamic = 'force-dynamic';

interface ResolvedStudent {
  email: string;
  name: string;
  registrationId: string;
  source: 'supabase' | 'apps_script' | 'admin_override';
}

/**
 * Resolve a student across both data sources. Order:
 *   1. Supabase `training_registrations_meta` (case-insensitive `ilike` — a
 *      plain `.eq` was missing rows stored with mixed casing).
 *   2. Apps Script `listStudents` — catches students that never had a
 *      Supabase row written (pre-migration-027 history).
 *   3. Admin override: if the caller supplied `nameOverride` / `regIdOverride`
 *      in the body, accept them. Last resort so a force-issue is never
 *      impossible for a legitimate case.
 */
async function resolveStudent(
  email: string,
  overrides: { nameOverride?: string; regIdOverride?: string },
): Promise<ResolvedStudent | null> {
  const sb = getServerClient();
  const normalized = email.toLowerCase().trim();

  const { data: meta } = await sb
    .from('training_registrations_meta')
    .select('registration_id, name, email')
    .ilike('email', normalized)
    .maybeSingle();

  if (meta) {
    return {
      email:          (meta.email as string) ?? normalized,
      name:           (meta.name as string) ?? '',
      registrationId: (meta.registration_id as string) ?? '',
      source:         'supabase',
    };
  }

  // Apps Script fallback
  try {
    const list = await listAllStudents();
    if (list.success && Array.isArray(list.data)) {
      const match = list.data.find(s => (s.email ?? '').toLowerCase().trim() === normalized);
      if (match) {
        return {
          email:          match.email ?? normalized,
          name:           match.name ?? '',
          registrationId: match.registrationId ?? '',
          source:         'apps_script',
        };
      }
    }
  } catch (e) {
    console.warn('[force-issue] listAllStudents failed:', e);
  }

  // Admin override — accept whatever the admin supplied.
  if (overrides.nameOverride?.trim() || overrides.regIdOverride?.trim()) {
    return {
      email:          normalized,
      name:           overrides.nameOverride?.trim() || normalized.split('@')[0],
      registrationId: overrides.regIdOverride?.trim() || '',
      source:         'admin_override',
    };
  }

  return null;
}

/**
 * POST /api/admin/certificates/force-issue
 *
 * Admin-only override that generates a certificate for a specific student +
 * course, bypassing the watch-threshold check. Works even when the student
 * isn't in Supabase yet — falls back to Apps Script's `listStudents`, then
 * to admin-supplied overrides.
 *
 * Body: { email, courseCode, nameOverride?, regIdOverride? }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const adminEmail = (session.user as { email?: string }).email ?? 'unknown';

  try {
    const body = await req.json() as {
      email?: string;
      courseCode?: string;
      nameOverride?: string;
      regIdOverride?: string;
    };
    const email = (body.email ?? '').toLowerCase().trim();
    const code = (body.courseCode ?? '').toUpperCase().trim();
    if (!email || !code) {
      return NextResponse.json({ error: 'email and courseCode required' }, { status: 400 });
    }

    const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === code);
    if (!course) {
      return NextResponse.json({ error: `Unknown course code: ${code}` }, { status: 400 });
    }

    const student = await resolveStudent(email, {
      nameOverride: body.nameOverride,
      regIdOverride: body.regIdOverride,
    });
    if (!student) {
      return NextResponse.json({
        error: `No student record for ${email}. Re-submit with { nameOverride, regIdOverride } in the body to create the certificate with admin-supplied details.`,
        needsOverride: true,
      }, { status: 404 });
    }

    // Pull score summary from training_assessment_results so the cert carries
    // real numbers (grade computed from these inside the engine).
    const sb = getServerClient();
    const { data: attempts } = await sb
      .from('training_assessment_results')
      .select('score, passed, is_final')
      .ilike('email', email)
      .ilike('tab_key', `${code}\\_%`);
    const passedFinal = (attempts ?? []).find(a => a.passed && a.is_final);
    const regularScores = (attempts ?? []).filter(a => a.passed && !a.is_final).map(a => Number(a.score ?? 0));
    const avg = regularScores.length ? Math.round(regularScores.reduce((a, b) => a + b, 0) / regularScores.length) : 0;

    // Supabase `student_certificates.registration_id` is the unique conflict
    // key — if we've somehow landed with no regId, synthesize a deterministic
    // one so two admin-override certs for different emails never collide.
    const effectiveRegId = student.registrationId
      || `FORCED_${code}_${Buffer.from(student.email).toString('hex').slice(0, 12)}`;

    const pending: PendingCertificate = {
      registrationId:    effectiveRegId,
      email:             student.email,
      studentName:       student.name,
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
      success:         true,
      studentSource:   student.source,
      certificateId:   result.certificateId,
      certPdfUrl:      result.certPdfUrl,
      badgeUrl:        result.badgeUrl,
      verificationUrl: result.verificationUrl,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
