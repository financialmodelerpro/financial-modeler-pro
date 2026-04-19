import { NextRequest, NextResponse } from 'next/server';
import { getCertificatesByEmail, getCertificateByRegId } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';

// Public endpoint — no auth required. Dashboard fetches here to render the
// "Your certificates" cards. Reads from BOTH Apps Script AND Supabase
// `student_certificates` and unions by certificate_id so a force-issued cert
// that never made it into Apps Script still surfaces on the student's
// dashboard immediately.

interface DashboardCert {
  certificateId:    string;
  studentName?:     string;
  email?:           string;
  course:           string;
  issuedAt:         string;
  certifierUrl?:    string;     // legacy Apps Script URL
  certPdfUrl?:      string;
  badgeUrl?:        string;
  transcriptUrl?:   string;
  verificationUrl?: string;
  grade?:           string;
}

async function fetchSupabaseCerts(email: string): Promise<DashboardCert[]> {
  const sb = getServerClient();
  const { data } = await sb
    .from('student_certificates')
    .select('certificate_id, full_name, email, course, course_code, grade, cert_pdf_url, badge_url, transcript_url, verification_url, issued_at, cert_status')
    .ilike('email', email);
  return (data ?? [])
    .filter(r => r.cert_status === 'Issued' || r.cert_status === 'Forced' || r.cert_status === null)
    .map(r => ({
      certificateId:   r.certificate_id as string,
      studentName:     (r.full_name as string) ?? undefined,
      email:           (r.email as string) ?? undefined,
      course:          (r.course_code as string) ?? (r.course as string) ?? '',
      issuedAt:        (r.issued_at as string) ?? '',
      certPdfUrl:      (r.cert_pdf_url as string) ?? undefined,
      badgeUrl:        (r.badge_url as string) ?? undefined,
      transcriptUrl:   (r.transcript_url as string) ?? undefined,
      verificationUrl: (r.verification_url as string) ?? undefined,
      grade:           (r.grade as string) ?? undefined,
    }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email  = searchParams.get('email');
    const regId  = searchParams.get('regId');
    const course = searchParams.get('course');

    // Lookup by regId + course (public certificate page) — Apps Script path only.
    if (regId && course) {
      const result = await getCertificateByRegId(regId.trim(), course.trim());
      if (!result.success || !result.data) {
        return NextResponse.json({ success: false, error: 'Certificate not found.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: result.data });
    }

    // Lookup by email (dashboard use) — union Apps Script + Supabase.
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Provide either email or regId+course.' },
        { status: 400 },
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    const [appsScriptResult, supabaseCerts] = await Promise.all([
      getCertificatesByEmail(cleanEmail).catch(() => ({ success: false, data: [] as unknown })),
      fetchSupabaseCerts(cleanEmail).catch(() => [] as DashboardCert[]),
    ]);

    const appsScriptCerts = (appsScriptResult.success && Array.isArray(appsScriptResult.data))
      ? (appsScriptResult.data as DashboardCert[])
      : [];

    // Dedup by certificate_id — Supabase wins on asset URL fields since it has
    // the freshest data for force-issued rows. Apps Script wins on legacy
    // `certifierUrl` since Supabase doesn't carry it.
    const byId = new Map<string, DashboardCert>();
    for (const c of appsScriptCerts) {
      if (!c.certificateId) continue;
      byId.set(c.certificateId, c);
    }
    for (const c of supabaseCerts) {
      if (!c.certificateId) continue;
      const existing = byId.get(c.certificateId);
      if (existing) {
        byId.set(c.certificateId, {
          ...existing,
          // Supabase has definitive asset URLs for force-issued rows.
          certPdfUrl:      c.certPdfUrl      ?? existing.certPdfUrl,
          badgeUrl:        c.badgeUrl        ?? existing.badgeUrl,
          transcriptUrl:   c.transcriptUrl   ?? existing.transcriptUrl,
          verificationUrl: c.verificationUrl ?? existing.verificationUrl,
          grade:           c.grade           ?? existing.grade,
          issuedAt:        c.issuedAt        || existing.issuedAt,
        });
      } else {
        byId.set(c.certificateId, c);
      }
    }

    return NextResponse.json({ success: true, data: Array.from(byId.values()) });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
