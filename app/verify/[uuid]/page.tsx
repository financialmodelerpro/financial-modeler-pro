import { Metadata } from 'next';
import Link from 'next/link';
import { getServerClient } from '@/src/lib/shared/supabase';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { VerifyActions } from './VerifyActions';

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
  const grade  = cert.grade ? ` with grade ${cert.grade}` : '';
  const issued = cert.issued_at ? ` Verified certificate issued ${new Date(cert.issued_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.` : '';

  const title = `${name} earned ${course} Certification | Financial Modeler Pro`;
  const description = `${name} completed ${course} from Financial Modeler Pro${grade}.${issued} Scan or click to verify.`;

  // Dynamic, branded OG image — rich LinkedIn / Twitter / WhatsApp preview
  // with student name + course + grade + date. Absolute URLs (not relative)
  // guarantee the social card footer always shows learn.* regardless of
  // which subdomain the user originally shared from.
  const learnUrl  = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
  const certId    = cert.certificate_id ?? uuid;
  const ogImage   = `${learnUrl}/api/og/certificate/${certId}`;
  const canonical = `${learnUrl}/verify/${certId}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title:       `${name} — Verified ${course} Certificate`,
      description,
      type:        'profile',
      url:         canonical,
      siteName:    'Financial Modeler Pro',
      images:      [{ url: ogImage, width: 1200, height: 630, alt: `${name} ${course} Certificate` }],
    },
    twitter: {
      card:  'summary_large_image',
      title: `${name} — Verified ${course} Certificate`,
      description,
      images: [ogImage],
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

/**
 * Inline PDF preview card — renders the first page of a PDF via iframe
 * (browser-native viewer) with a branded header and "Open Full ↗" link.
 * `#toolbar=0&navpanes=0&scrollbar=0&view=FitH` hides the browser's chrome
 * so the document feels embedded rather than "in a frame".
 */
function DocumentPreview({
  label, accent, embedUrl, openUrl, aspectRatio,
}: { label: string; accent: string; embedUrl: string; openUrl: string; aspectRatio: string }) {
  const framedUrl = `${embedUrl}${embedUrl.includes('#') ? '&' : '#'}toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
  return (
    <div style={{
      background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 2px 6px rgba(13,46,90,0.06)',
    }}>
      {/* Header strip */}
      <div style={{
        background: '#0D2E5A', padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: '0.12em' }}>
          {label}
        </span>
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: '#fff', textDecoration: 'none', fontWeight: 600, opacity: 0.9 }}
        >
          Open Full ↗
        </a>
      </div>

      {/* PDF frame */}
      <div style={{ aspectRatio, background: '#fff', position: 'relative' }}>
        <iframe
          src={framedUrl}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#fff' }}
          title={`${label} preview`}
          loading="lazy"
        />
        {/* Mobile-friendly tap overlay — opens the PDF full-screen on
            devices where the iframe viewer renders a download prompt or
            blank placeholder instead of the embedded PDF. */}
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${label.toLowerCase()} in new tab`}
          style={{
            position: 'absolute', bottom: 10, right: 10,
            padding: '6px 12px', borderRadius: 999,
            background: 'rgba(13,46,90,0.92)', color: '#fff',
            fontSize: 10, fontWeight: 700, textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            letterSpacing: '0.04em',
          }}
        >
          ⛶ View
        </a>
      </div>
    </div>
  );
}

/**
 * Inline image preview card — mirrors DocumentPreview's visual language
 * but renders a raster image (e.g. the achievement badge PNG) instead of
 * a PDF iframe. Uses a subtle gradient backdrop so transparent-background
 * badges don't look hollow on white.
 */
function ImagePreview({
  label, accent, url, altText,
}: { label: string; accent: string; url: string; altText: string }) {
  return (
    <div style={{
      background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 2px 6px rgba(13,46,90,0.06)',
    }}>
      {/* Header strip — matches DocumentPreview. */}
      <div style={{
        background: '#0D2E5A', padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: '0.12em' }}>
          {label}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: '#fff', textDecoration: 'none', fontWeight: 600, opacity: 0.9 }}
        >
          Open Full ↗
        </a>
      </div>

      {/* Image frame */}
      <div style={{
        aspectRatio: '1 / 1',
        background: 'radial-gradient(circle at center, #FFFBF0 0%, #FFF 70%)',
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={altText}
          loading="lazy"
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${label.toLowerCase()} in new tab`}
          style={{
            position: 'absolute', bottom: 10, right: 10,
            padding: '6px 12px', borderRadius: 999,
            background: 'rgba(13,46,90,0.92)', color: '#fff',
            fontSize: 10, fontWeight: 700, textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            letterSpacing: '0.04em',
          }}
        >
          ⛶ View
        </a>
      </div>
    </div>
  );
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
        <NavbarServer />
        <div style={{ height: 64 }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 64px)', padding: '40px 20px' }}>
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
  // Canonical verification URL is on learn.* — matches the QR encoded in
  // the certificate + transcript PDFs, and makes the share preview
  // consistent regardless of which subdomain the student arrived on.
  const verifyUrl   = `${learnUrl}/verify/${certId}`;
  const qrSrc       = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}`;
  const issueDate   = cert.issued_at ?? cert.issued_date ?? '';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #071530 0%, #0D2E5A 50%, #0F3D6E 100%)', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero lead-in */}
      <div style={{ padding: '40px 24px 16px', textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 14px', borderRadius: 999,
          background: 'rgba(46,170,74,0.15)', border: '1px solid rgba(46,170,74,0.4)',
          color: '#8FDCA0', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
          marginBottom: 14,
        }}>
          ✅ Credential Verified
        </div>
        <div style={{ fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 800, color: '#fff', lineHeight: 1.15, marginBottom: 6 }}>
          Certificate Verified
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', maxWidth: 520, margin: '0 auto' }}>
          This credential is authentic and issued by Financial Modeler Pro.
        </div>
      </div>

      {/* Main Card */}
      <div style={{ maxWidth: 760, margin: '16px auto 32px', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden', background: '#fff' }}>

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

        {/* Document Previews — inline previews for Certificate + Badge + Transcript.
            Left column stacks the two landscape/square credential artifacts;
            right column holds the taller portrait transcript. */}
        <div style={{ padding: '4px 36px 24px', background: '#fff', borderTop: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              📄 Documents
            </div>
            <div style={{ flex: 1, height: 1, background: '#F3F4F6' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
            {/* Left column: Certificate + Badge stacked. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {cert.cert_pdf_url && (
                <DocumentPreview
                  label="CERTIFICATE"
                  accent="#C9A84C"
                  embedUrl={cert.cert_pdf_url}
                  openUrl={cert.cert_pdf_url}
                  aspectRatio="4 / 3"
                />
              )}
              {cert.badge_url && (
                <ImagePreview
                  label="BADGE"
                  accent="#C9A84C"
                  url={cert.badge_url}
                  altText={`${cert.course ?? 'Course'} badge for ${cert.full_name ?? 'student'}`}
                />
              )}
            </div>

            {/* Right column: Transcript. */}
            <DocumentPreview
              label="TRANSCRIPT"
              accent="#8FBCEC"
              /* Prefer direct storage URL when already cached — iframe
                 hash params (toolbar=0) survive without the 302 hop. */
              embedUrl={cert.transcript_url ?? `/api/training/transcript-cached/${certId}`}
              openUrl={`/api/training/transcript-cached/${certId}`}
              aspectRatio="3 / 4"
            />
          </div>
        </div>

        {/* QR + Actions */}
        <div style={{ background: '#F9FAFB', padding: '24px 36px', display: 'flex', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap' }}>
          {/* QR */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <img src={qrSrc} alt="Verification QR Code" width={140} height={140} style={{ borderRadius: 8, border: '1px solid #E5E7EB' }} />
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>Scan to verify</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', wordBreak: 'break-all', maxWidth: 140, textAlign: 'center', lineHeight: 1.4 }}>
              {learnUrl}/verify/{certId}
            </div>
          </div>

          {/* Buttons — client component owns the share copy-to-clipboard flow. */}
          <VerifyActions
            certId={certId}
            fullName={cert.full_name ?? 'Student'}
            course={cert.course ?? 'Course'}
            grade={cert.grade ?? ''}
            issuedLabel={formatDate(issueDate)}
            verifyUrl={verifyUrl}
            certPdfUrl={cert.cert_pdf_url}
            badgeUrl={cert.badge_url}
          />
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
