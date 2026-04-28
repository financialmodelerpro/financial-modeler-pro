import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { issueCertificateForStudent } from '@/src/lib/training/certificateEngine';
import { findAllEligibleFromSupabase } from '@/src/lib/training/certificateEligibility';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/admin/certificates/issue-pending
 *
 * Safety-net issuance. Replaces the retired daily cron. Two modes:
 *   - { email, courseCode } → issue that one student's cert (if eligible).
 *   - { all: true }         → sweep every eligible-but-not-issued row.
 *
 * Idempotent: the helper skips students who already have an Issued row via
 * a pre-check + the unique index on (LOWER(email), course_code).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as { email?: string; courseCode?: string; all?: boolean };

    if (body.all) {
      const eligible = await findAllEligibleFromSupabase();
      const reallyEligible = eligible.filter(e => e.eligible);
      const results: Array<{ email: string; courseCode: string; ok: boolean; skipped?: boolean; error?: string; certificateId?: string }> = [];
      let issued = 0;
      let skipped = 0;
      let failed = 0;
      for (const e of reallyEligible) {
        const r = await issueCertificateForStudent(e.email, e.course, { issuedVia: 'auto' });
        if (r.ok) {
          if ((r as { skipped?: boolean }).skipped) { skipped++; results.push({ email: e.email, courseCode: e.course, ok: true, skipped: true, certificateId: r.certificateId }); }
          else                                       { issued++;  results.push({ email: e.email, courseCode: e.course, ok: true, certificateId: r.certificateId }); }
        } else {
          failed++;
          results.push({ email: e.email, courseCode: e.course, ok: false, error: r.error });
        }
      }
      return NextResponse.json({ mode: 'all', totals: { issued, skipped, failed, attempted: reallyEligible.length }, results });
    }

    const email = (body.email ?? '').trim();
    const code  = (body.courseCode ?? '').trim();
    if (!email || !code) {
      return NextResponse.json({ error: 'email and courseCode required (or pass { all: true })' }, { status: 400 });
    }

    const r = await issueCertificateForStudent(email, code, { issuedVia: 'auto' });
    if (!r.ok) {
      return NextResponse.json({ success: false, error: r.error }, { status: 500 });
    }
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
