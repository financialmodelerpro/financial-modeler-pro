import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { listAllCertificates } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';

export const revalidate = 0;

/**
 * Admin certificate list — unions Apps Script + Supabase so force-issued
 * records (which only land in `student_certificates`) are visible. Dedups
 * by certificate_id; Supabase wins on the URL fields since it carries the
 * freshest data for force-issues. Apps Script wins on legacy `certifierUrl`
 * where Supabase doesn't carry it.
 */

interface AdminCert {
  certificateId:   string;
  studentName:     string;
  email:           string;
  course:          string;
  issuedAt:        string;
  certifierUrl:    string;
  registrationId?: string;
  issuedVia?:      string;         // 'auto' | 'forced' | 'apps_script'
  issuedByAdmin?:  string | null;
  certPdfUrl?:     string;
  badgeUrl?:       string;
  transcriptUrl?:  string;
  verificationUrl?: string;
  emailSentAt?:    string | null;  // migration 124 — null means email never sent
  isRevoked:       boolean;
  revokeActionId:  string | null;
}

async function loadSupabaseCerts(): Promise<AdminCert[]> {
  const sb = getServerClient();
  const { data } = await sb
    .from('student_certificates')
    .select('certificate_id, registration_id, full_name, email, course, course_code, cert_status, cert_pdf_url, badge_url, transcript_url, verification_url, issued_at, issued_via, issued_by_admin, email_sent_at')
    .eq('cert_status', 'Issued');
  return (data ?? []).map(r => ({
    certificateId:   (r.certificate_id as string) ?? '',
    studentName:     (r.full_name as string) ?? '',
    email:           (r.email as string) ?? '',
    course:          (r.course_code as string) ?? (r.course as string) ?? '',
    issuedAt:        (r.issued_at as string) ?? '',
    certifierUrl:    (r.verification_url as string) ?? '',
    registrationId:  (r.registration_id as string) ?? undefined,
    issuedVia:       (r.issued_via as string) ?? 'auto',
    issuedByAdmin:   (r.issued_by_admin as string | null) ?? null,
    certPdfUrl:      (r.cert_pdf_url as string) ?? undefined,
    badgeUrl:        (r.badge_url as string) ?? undefined,
    transcriptUrl:   (r.transcript_url as string) ?? undefined,
    verificationUrl: (r.verification_url as string) ?? undefined,
    emailSentAt:     (r.email_sent_at as string | null) ?? null,
    isRevoked:       false,      // overlaid below
    revokeActionId:  null,
  }));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [appsResult, supabaseCerts] = await Promise.all([
    listAllCertificates().catch(() => ({ success: false, data: [] as unknown[], error: 'fetch_failed' })),
    loadSupabaseCerts().catch(() => [] as AdminCert[]),
  ]);
  const sb = getServerClient();

  const { data: revocations } = await sb
    .from('training_admin_actions')
    .select('id, registration_id, course')
    .eq('action_type', 'revoke_certificate')
    .eq('is_active', true);

  const revokeMap = new Map(
    (revocations ?? []).map(r => [`${r.registration_id}::${r.course ?? ''}`, r.id as string]),
  );

  const appsCerts: AdminCert[] = (appsResult.success && Array.isArray(appsResult.data))
    ? (appsResult.data as unknown[]).map(c => {
        const raw = c as Record<string, unknown>;
        return {
          certificateId:  (raw.certificateId as string) ?? '',
          studentName:    (raw.studentName   as string) ?? '',
          email:          (raw.email         as string) ?? '',
          course:         (raw.course        as string) ?? '',
          issuedAt:       (raw.issuedAt      as string) ?? '',
          certifierUrl:   (raw.certifierUrl  as string) ?? '',
          registrationId: (raw.registrationId as string) ?? undefined,
          issuedVia:      'apps_script',
          issuedByAdmin:  null,
          isRevoked:      false,
          revokeActionId: null,
        };
      })
    : [];

  // Union by certificate_id.
  const byId = new Map<string, AdminCert>();
  for (const c of appsCerts) {
    if (!c.certificateId) continue;
    byId.set(c.certificateId, c);
  }
  for (const c of supabaseCerts) {
    if (!c.certificateId) continue;
    const prev = byId.get(c.certificateId);
    if (prev) {
      byId.set(c.certificateId, {
        ...prev,
        certPdfUrl:      c.certPdfUrl      ?? prev.certPdfUrl,
        badgeUrl:        c.badgeUrl        ?? prev.badgeUrl,
        transcriptUrl:   c.transcriptUrl   ?? prev.transcriptUrl,
        verificationUrl: c.verificationUrl ?? prev.verificationUrl,
        issuedVia:       c.issuedVia       ?? prev.issuedVia,
        issuedByAdmin:   c.issuedByAdmin   ?? prev.issuedByAdmin,
        emailSentAt:     c.emailSentAt     ?? prev.emailSentAt,
        issuedAt:        c.issuedAt        || prev.issuedAt,
        studentName:     c.studentName     || prev.studentName,
      });
    } else {
      byId.set(c.certificateId, c);
    }
  }

  const certificates = Array.from(byId.values()).map(c => {
    const key = `${c.registrationId ?? ''}::${c.course}`;
    return { ...c, isRevoked: revokeMap.has(key), revokeActionId: revokeMap.get(key) ?? null };
  });

  const revoked = certificates.filter(c => c.isRevoked).length;

  return NextResponse.json({
    certificates,
    totalCerts:           certificates.length,
    sfmCerts:             certificates.filter(c => c.course === '3SFM').length,
    bvmCerts:             certificates.filter(c => c.course === 'BVM').length,
    revokedCerts:         revoked,
    dataAvailable:        certificates.length > 0 || appsResult.success,
    appsScriptConfigured: !('error' in appsResult && appsResult.error === 'APPS_SCRIPT_URL not configured'),
    sources: {
      appsScriptCount: appsCerts.length,
      supabaseCount:   supabaseCerts.length,
      unionCount:      certificates.length,
    },
  });
}
