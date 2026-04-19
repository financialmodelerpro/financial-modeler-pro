import { Metadata } from 'next';
import Link from 'next/link';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ uuid: string }>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CertRow {
  certificate_id:     string | null;
  registration_id:    string | null;
  full_name:          string | null;
  email:              string | null;
  course:             string | null;
  course_code:        string | null;
  course_subheading:  string | null;
  course_description: string | null;
  grade:              string | null;
  final_score:        number | null;
  cert_status:        string | null;
  cert_pdf_url:       string | null;
  badge_url:          string | null;
  transcript_url:     string | null;
  verification_url:   string | null;
  issued_at:          string | null;
  issued_date:        string | null;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { uuid } = await params;
  const sb = getServerClient();

  const cert = await fetchCert(sb, uuid);
  if (!cert) {
    return { title: 'Certificate Not Found | Financial Modeler Pro' };
  }

  const name   = cert.full_name ?? 'Student';
  const course = cert.course ?? 'Course';
  return {
    title:       `${name} - ${course} Certificate | Financial Modeler Pro`,
    description: `Verify the ${course} certificate issued to ${name} by Financial Modeler Pro.`,
    openGraph: {
      title:       `${name} - Verified Certificate`,
      description: `${course} certificate issued by Financial Modeler Pro`,
      images:      cert.cert_pdf_url ? [{ url: cert.cert_pdf_url }] : [],
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchCert(
  sb: ReturnType<typeof getServerClient>,
  uuid: string,
): Promise<CertRow | null> {
  // Try certificate_id first (new format: FMP-3SFM-2026-0001)
  const { data: byId } = await sb
    .from('student_certificates')
    .select('*')
    .eq('certificate_id', uuid)
    .maybeSingle();
  if (byId) return byId as CertRow;

  // Fall back to certifier_uuid for legacy records
  const { data: byUuid } = await sb
    .from('student_certificates')
    .select('*')
    .eq('certifier_uuid', uuid)
    .maybeSingle();
  return (byUuid as CertRow | null) ?? null;
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  try {
    return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return raw; }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function VerifyPage({ params }: PageProps) {
  const { uuid } = await params;
  const sb   = getServerClient();
  const cert = await fetchCert(sb, uuid);

  const learnUrl = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
  const mainUrl  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';

  if (!cert || cert.cert_status !== 'Issued') {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F7FA', fontFamily: 'Inter, -apple-system, sans-serif' }}>
        {/* Top Bar */}
        <div style={{ background: '#0D2E5A', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Certificate Verification</span>
          <span style={{ color: 'rgba(255,255,255,0.4)', margin: '0 6px' }}>|</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>Financial Modeler Pro</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 48px)', padding: '40px 20px' }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 20 }}>🔍</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0D2E5A', marginBottom: 12 }}>Certificate Not Found</h1>
            <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.7, marginBottom: 8 }}>
              No certificate found with ID:
            </p>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', fontFamily: 'monospace', background: '#F3F4F6', padding: '8px 16px', borderRadius: 8, display: 'inline-block', marginBottom: 24, wordBreak: 'break-all' }}>
              {uuid}
            </div>
            <p style={{ fontSize: 13, color: '#9CA3AF', lineHeight: 1.6, marginBottom: 32 }}>
              Please check the Certificate ID and try again. Certificate IDs are case-sensitive.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/verify" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 24px', borderRadius: 8, fontSize: 13, fontWeight: 700, background: '#1B4F8A', color: '#fff', textDecoration: 'none' }}>
                Try Again →
              </Link>
              <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 24px', borderRadius: 8, fontSize: 13, fontWeight: 700, background: 'transparent', color: '#6B7280', textDecoration: 'none', border: '1.5px solid #D1D5DB' }}>
                ← Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const certId      = cert.certificate_id ?? uuid;
  const verifyUrl   = `${mainUrl}/verify/${certId}`;
  const qrSrc       = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}`;
  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}`;
  const issueDate   = cert.issued_at ?? cert.issued_date ?? '';

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
        <Link href={`${learnUrl}/training`} style={{ color: '#C9A84C', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          Training Hub →
        </Link>
      </div>

      {/* Main Card */}
      <div style={{ maxWidth: 760, margin: '32px auto', borderRadius: 12, boxShadow: '0 4px 32px rgba(0,0,0,0.12)', overflow: 'hidden', background: '#fff' }}>

        {/* Top - navy header */}
        <div style={{ background: '#0D2E5A', padding: '28px 36px', display: 'flex', alignItems: 'flex-start', gap: 28 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>✅</div>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9A84C' }}>
                CREDENTIAL VERIFIED
              </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
              {cert.full_name}
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
              has successfully completed
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#C9A84C', marginBottom: 4 }}>
              {cert.course}
            </div>
            {cert.course_subheading && (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{cert.course_subheading}</div>
            )}
          </div>
          <div style={{ flexShrink: 0, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Financial Modeler Pro</div>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(201,168,76,0.2)', border: '2px solid #C9A84C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto' }}>🎓</div>
          </div>
        </div>

        {/* Details */}
        <div style={{ padding: '24px 36px', background: '#fff' }}>
          {cert.course_description && (
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20, lineHeight: 1.6 }}>{cert.course_description}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
            {[
              { label: 'Student Name',    value: cert.full_name ?? '-' },
              { label: 'Registration ID', value: cert.registration_id ?? '-' },
              { label: 'Course',          value: cert.course ?? '-' },
              { label: 'Issue Date',      value: formatDate(issueDate) },
              { label: 'Grade',           value: cert.grade ?? '-' },
              { label: 'Certificate ID',  value: certId, mono: true },
            ].map(({ label, value, mono }) => (
              <div key={label} style={{ borderBottom: '1px solid #F3F4F6', paddingBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: mono ? 11 : 13, fontWeight: 600, color: '#1F2937', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* QR + Actions */}
        <div style={{ background: '#F9FAFB', padding: '24px 36px', display: 'flex', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap' }}>
          {/* QR */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <img src={qrSrc} alt="Verification QR Code" width={140} height={140} style={{ borderRadius: 8, border: '1px solid #E5E7EB' }} />
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>Scan to verify</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', wordBreak: 'break-all', maxWidth: 140, textAlign: 'center', lineHeight: 1.4 }}>
              {mainUrl}/verify/{certId}
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 200 }}>
            {cert.cert_pdf_url && (
              <a href={cert.cert_pdf_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', padding: '10px 18px', borderRadius: 8, background: '#0D2E5A', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                ⬇ Download Certificate PDF
              </a>
            )}
            {cert.badge_url && (
              <a href={cert.badge_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', padding: '10px 18px', borderRadius: 8, background: '#C9A84C', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                🎖 Download Badge
              </a>
            )}
            {/* Transcript: always use the cached endpoint — it 302-redirects
                to the stored URL if already generated, or generates + caches
                on first click so students never wait through a regeneration. */}
            <a href={`/api/training/transcript-cached/${certId}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '10px 18px', borderRadius: 8, background: '#1B4F8A', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
              📄 Download Transcript
            </a>
            <a href={linkedInUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '10px 18px', borderRadius: 8, background: '#0A66C2', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
              🔗 Share on LinkedIn
            </a>
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: '#0D2E5A', padding: '12px 36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', maxWidth: 500, lineHeight: 1.5 }}>
            This certificate was issued and is verified by Financial Modeler Pro
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 0, marginLeft: 16 }}>
            Issue Date: {formatDate(issueDate)}
          </div>
        </div>
      </div>
    </div>
  );
}
