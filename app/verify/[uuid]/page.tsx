import { Metadata } from 'next';
import Link from 'next/link';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getCertifierCredential } from '@/src/lib/training/certifier';

export const dynamic = 'force-dynamic';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupaCert {
  certifier_uuid: string;
  registration_id: string;
  full_name: string;
  email: string;
  course: string;
  completion_date: string | null;
  final_exam_score: string | null;
  avg_session_score: string | null;
  cert_status: string;
  certificate_url: string | null;
  issued_date: string | null;
}

interface PageProps {
  params: Promise<{ uuid: string }>;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { uuid } = await params;
  const sb = getServerClient();
  const { data } = await sb
    .from('student_certificates')
    .select('full_name, course, certificate_url')
    .eq('certifier_uuid', uuid)
    .single();

  const name = (data as SupaCert | null)?.full_name ?? 'Student';
  const course = (data as SupaCert | null)?.course ?? 'Course';
  const certUrl = (data as SupaCert | null)?.certificate_url ?? '';

  return {
    title: `Certificate Verification — ${name} | Financial Modeler Pro`,
    description: `Verify the ${course} certificate issued to ${name} by Financial Modeler Pro.`,
    openGraph: {
      title: `${name} — Verified Certificate`,
      description: `${course} certificate issued by Financial Modeler Pro`,
      images: certUrl ? [{ url: certUrl }] : [],
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  try {
    return new Date(raw).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return raw;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function VerifyPage({ params }: PageProps) {
  const { uuid } = await params;

  const sb = getServerClient();
  const { data: supaRow } = await sb
    .from('student_certificates')
    .select('*')
    .eq('certifier_uuid', uuid)
    .single();

  const cert = supaRow as SupaCert | null;

  // Also try Certifier API for the image
  const certifierData = await getCertifierCredential(uuid);

  const found = Boolean(cert);
  const imageUrl = certifierData?.imageUrl ?? cert?.certificate_url ?? '';
  const certUrl = certifierData?.certUrl ?? cert?.certificate_url ?? '';
  const studentName = cert?.full_name ?? certifierData?.recipientName ?? '';
  const courseTitle = cert?.course ?? certifierData?.courseTitle ?? '';
  const issueDate = cert?.issued_date ?? certifierData?.issuedOn ?? '';
  const finalScore = cert?.final_exam_score ?? '';
  const registrationId = cert?.registration_id ?? '';
  const verifyUrl = `${process.env.NEXT_PUBLIC_MAIN_URL || 'https://financialmodelerpro.com'}/verify/${uuid}`;

  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}`;

  return (
    <div style={{ minHeight: '100vh', background: '#F5F7FA', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>

      {/* Top Bar */}
      <div style={{ background: '#0D2E5A', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff' }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Certificate Verification</span>
          <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 6px' }}>|</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Financial Modeler Pro</span>
        </div>
        <Link href="/training" style={{ color: '#C9A84C', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          Training Hub →
        </Link>
      </div>

      {/* Main Card */}
      <div style={{ maxWidth: 760, margin: '32px auto', borderRadius: 12, boxShadow: '0 4px 32px rgba(0,0,0,0.12)', overflow: 'hidden', background: '#fff' }}>

        {found ? (
          <>
            {/* Top Section — navy */}
            <div style={{ background: '#0D2E5A', padding: '28px 36px', display: 'flex', alignItems: 'flex-start', gap: 28 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, flexShrink: 0,
                  }}>
                    ✅
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: '#C9A84C',
                  }}>
                    VERIFIED CERTIFICATE
                  </span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
                  {studentName}
                </div>
                <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
                  {courseTitle}
                </div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Certificate"
                    style={{ width: 200, borderRadius: 8, border: '2px solid rgba(255,255,255,0.2)' }}
                  />
                ) : (
                  <div style={{
                    width: 200, height: 130, borderRadius: 8,
                    border: '2px solid rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 8, color: 'rgba(255,255,255,0.5)',
                    fontSize: 13,
                  }}>
                    <span style={{ fontSize: 28 }}>📜</span>
                    Certificate
                  </div>
                )}
              </div>
            </div>

            {/* Details Section */}
            <div style={{ padding: '24px 36px', background: '#fff' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                {[
                  { label: 'Student Name',    value: studentName },
                  { label: 'Registration ID', value: registrationId },
                  { label: 'Course',          value: courseTitle },
                  { label: 'Issue Date',      value: formatDate(issueDate) },
                  { label: 'Final Score',     value: finalScore ? `${finalScore}%` : '—' },
                  { label: 'Certificate ID',  value: uuid, mono: true },
                ].map(({ label, value, mono }) => (
                  <div key={label} style={{ borderBottom: '1px solid #F3F4F6', paddingBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                      {label}
                    </div>
                    <div style={{
                      fontSize: mono ? 11 : 13, fontWeight: 600, color: '#1F2937',
                      fontFamily: mono ? 'monospace' : undefined,
                      wordBreak: 'break-all',
                    }}>
                      {value || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* QR + Actions Section */}
            <div style={{ background: '#F9FAFB', padding: '24px 36px', display: 'flex', alignItems: 'flex-start', gap: 32 }}>
              {/* QR */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <img
                  src={`/api/qr?url=${encodeURIComponent(verifyUrl)}`}
                  alt="Verification QR Code"
                  width={140}
                  height={140}
                  style={{ borderRadius: 8, border: '1px solid #E5E7EB' }}
                />
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>Scan to verify</div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                {certUrl && (
                  <a
                    href={certUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block', padding: '10px 18px', borderRadius: 8,
                      background: '#0D2E5A', color: '#fff', textDecoration: 'none',
                      fontSize: 13, fontWeight: 600, textAlign: 'center',
                    }}
                  >
                    ⬇ Download Certificate
                  </a>
                )}
                <a
                  href={linkedInUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'block', padding: '10px 18px', borderRadius: 8,
                    background: '#0A66C2', color: '#fff', textDecoration: 'none',
                    fontSize: 13, fontWeight: 600, textAlign: 'center',
                  }}
                >
                  🔗 Share on LinkedIn
                </a>
                {certUrl && (
                  <a
                    href={certUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block', padding: '10px 18px', borderRadius: 8,
                      background: '#fff', color: '#374151', textDecoration: 'none',
                      fontSize: 13, fontWeight: 600, textAlign: 'center',
                      border: '1px solid #D1D5DB',
                    }}
                  >
                    🌐 View on Certifier
                  </a>
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              background: '#0D2E5A', padding: '12px 36px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', maxWidth: 500, lineHeight: 1.5 }}>
                This certificate was issued by Financial Modeler Pro and is independently verified by Certifier.io
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 0, marginLeft: 16 }}>
                Issue Date: {formatDate(issueDate)}
              </div>
            </div>
          </>
        ) : (
          /* Not Found State */
          <div style={{ padding: '64px 36px', textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>❌</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1F2937', marginBottom: 10, margin: '0 0 10px' }}>
              Certificate Not Found
            </h1>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 28, lineHeight: 1.6 }}>
              The certificate ID you entered could not be verified. Please check the URL and try again.
            </p>
            <Link
              href="/training"
              style={{
                display: 'inline-block', padding: '12px 28px', borderRadius: 8,
                background: '#0D2E5A', color: '#fff', textDecoration: 'none',
                fontSize: 14, fontWeight: 600,
              }}
            >
              Go to Training Hub →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
