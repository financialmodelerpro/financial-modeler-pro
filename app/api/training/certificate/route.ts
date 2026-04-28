import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

/**
 * Public certificate lookup. Supabase-only post-migration.
 * - GET ?email=          -> student's issued certificates, for the dashboard
 * - GET ?regId=&course=  -> single certificate by RegID + course, for verify
 */

interface DashboardCert {
  certificateId:    string;
  studentName?:     string;
  email?:           string;
  course:           string;
  /**
   * Canonical short code from student_certificates.course_code
   * (e.g. '3SFM', 'BVM'). `course` above is the full title
   * ('3-Statement Financial Modeling') which is display-only;
   * client-side matching against course configs should use
   * courseCode so pre-migration certs with prose-style `course`
   * values don't break the lookup.
   */
  courseCode?:      string;
  issuedAt:         string;
  certPdfUrl?:      string;
  badgeUrl?:        string;
  transcriptUrl?:   string;
  verificationUrl?: string;
  grade?:           string;
}

function mapRow(r: Record<string, unknown>): DashboardCert {
  return {
    certificateId:   (r.certificate_id as string) ?? '',
    studentName:     (r.full_name as string) ?? undefined,
    email:           (r.email as string) ?? undefined,
    course:          (r.course as string) ?? (r.course_code as string) ?? '',
    courseCode:      (r.course_code as string) ?? undefined,
    issuedAt:        (r.issued_at as string) ?? '',
    certPdfUrl:      (r.cert_pdf_url as string) ?? undefined,
    badgeUrl:        (r.badge_url as string) ?? undefined,
    transcriptUrl:   (r.transcript_url as string) ?? undefined,
    verificationUrl: (r.verification_url as string) ?? undefined,
    grade:           (r.grade as string) ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email  = searchParams.get('email');
    const regId  = searchParams.get('regId');
    const course = searchParams.get('course');

    const sb = getServerClient();

    // Lookup by regId + course (public certificate page).
    if (regId && course) {
      const { data } = await sb
        .from('student_certificates')
        .select('certificate_id, full_name, email, course, course_code, grade, cert_pdf_url, badge_url, transcript_url, verification_url, issued_at, cert_status')
        .eq('registration_id', regId.trim())
        .ilike('course', course.trim())
        .maybeSingle();
      if (!data || data.cert_status !== 'Issued') {
        return NextResponse.json({ success: false, error: 'Certificate not found.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: mapRow(data) });
    }

    // Lookup by email (dashboard use).
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Provide either email or regId+course.' },
        { status: 400 },
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const { data } = await sb
      .from('student_certificates')
      .select('certificate_id, full_name, email, course, course_code, grade, cert_pdf_url, badge_url, transcript_url, verification_url, issued_at, cert_status')
      .ilike('email', cleanEmail);

    const issued = (data ?? [])
      .filter(r => r.cert_status === 'Issued')
      .map(mapRow);

    return NextResponse.json({ success: true, data: issued });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
