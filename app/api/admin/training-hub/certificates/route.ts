import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export const revalidate = 0;

/**
 * Admin certificate list. Supabase-only post-migration; Apps Script no
 * longer holds certificate records. Reads student_certificates where
 * cert_status = 'Issued' and overlays revocation flags from
 * training_admin_actions.
 */

interface AdminCert {
  certificateId:   string;
  studentName:     string;
  email:           string;
  course:          string;
  issuedAt:        string;
  certifierUrl:    string;
  registrationId?: string;
  issuedVia?:      string;
  issuedByAdmin?:  string | null;
  certPdfUrl?:     string;
  badgeUrl?:       string;
  transcriptUrl?:  string;
  verificationUrl?: string;
  emailSentAt?:    string | null;
  isRevoked:       boolean;
  revokeActionId:  string | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();

  const [certsRes, revsRes] = await Promise.all([
    sb.from('student_certificates')
      .select('certificate_id, registration_id, full_name, email, course, course_code, cert_status, cert_pdf_url, badge_url, transcript_url, verification_url, issued_at, issued_via, issued_by_admin, email_sent_at')
      .eq('cert_status', 'Issued'),
    sb.from('training_admin_actions')
      .select('id, registration_id, course')
      .eq('action_type', 'revoke_certificate')
      .eq('is_active', true),
  ]);

  const revokeMap = new Map(
    (revsRes.data ?? []).map(r => [`${r.registration_id}::${r.course ?? ''}`, r.id as string]),
  );

  const certificates: AdminCert[] = (certsRes.data ?? []).map(r => {
    const registrationId = (r.registration_id as string) ?? undefined;
    const course         = (r.course_code as string) ?? (r.course as string) ?? '';
    const revokeKey      = `${registrationId ?? ''}::${course}`;
    return {
      certificateId:   (r.certificate_id as string) ?? '',
      studentName:     (r.full_name as string) ?? '',
      email:           (r.email as string) ?? '',
      course,
      issuedAt:        (r.issued_at as string) ?? '',
      certifierUrl:    (r.verification_url as string) ?? '',
      registrationId,
      issuedVia:       (r.issued_via as string) ?? 'auto',
      issuedByAdmin:   (r.issued_by_admin as string | null) ?? null,
      certPdfUrl:      (r.cert_pdf_url as string) ?? undefined,
      badgeUrl:        (r.badge_url as string) ?? undefined,
      transcriptUrl:   (r.transcript_url as string) ?? undefined,
      verificationUrl: (r.verification_url as string) ?? undefined,
      emailSentAt:     (r.email_sent_at as string | null) ?? null,
      isRevoked:       revokeMap.has(revokeKey),
      revokeActionId:  revokeMap.get(revokeKey) ?? null,
    };
  });

  const revoked = certificates.filter(c => c.isRevoked).length;

  return NextResponse.json({
    certificates,
    totalCerts:           certificates.length,
    sfmCerts:             certificates.filter(c => c.course === '3SFM').length,
    bvmCerts:             certificates.filter(c => c.course === 'BVM').length,
    revokedCerts:         revoked,
    dataAvailable:        true,
    appsScriptConfigured: true,
    sources: {
      appsScriptCount: 0,
      supabaseCount:   certificates.length,
      unionCount:      certificates.length,
    },
  });
}
