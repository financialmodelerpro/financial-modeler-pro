/**
 * /training/certificate — Public shareable certificate page.
 * No auth required. URL: /training/certificate?regId=FMP-2026-0001&course=3sfm
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { getCertificateByRegId } from '@/src/lib/sheets';
import type { SheetCertificate } from '@/src/lib/sheets';
import { COURSES } from '@/src/config/courses';

// ── Cached lookup — shared between generateMetadata and the page ──────────────

const fetchCertificate = cache(async (
  regId: string,
  course: string,
): Promise<SheetCertificate | null> => {
  const result = await getCertificateByRegId(regId, course);
  return result.success && result.data ? result.data : null;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function formatDateFull(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function courseLabel(courseId: string): string {
  return COURSES[courseId]?.title ?? courseId;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  searchParams: Promise<{ regId?: string; course?: string }>;
}

// ── SEO ───────────────────────────────────────────────────────────────────────

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { regId = '', course = '' } = await searchParams;
  if (!regId || !course) {
    return { title: 'Certificate | Financial Modeler Pro' };
  }

  const cert = await fetchCertificate(regId, course);
  if (!cert) {
    return {
      title: 'Certificate Not Found | Financial Modeler Pro',
      description: 'This certificate could not be found or may not have been issued yet.',
    };
  }

  const title       = `${cert.studentName} — ${courseLabel(cert.course)} Certificate | Financial Modeler Pro`;
  const description = `${cert.studentName} earned the ${courseLabel(cert.course)} certificate from Financial Modeler Pro on ${formatDateFull(cert.issuedAt)}. Verified by Certifier.io.`;

  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CertificatePage({ searchParams }: Props) {
  const { regId = '', course = '' } = await searchParams;

  // ── Not Found — missing params ──
  if (!regId || !course) {
    return <NotFoundView reason="invalid" />;
  }

  const cert = await fetchCertificate(regId, course);

  // ── Not Found — no certificate ──
  if (!cert) {
    return <NotFoundView reason="notfound" />;
  }

  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(cert.certifierUrl)}`;

  return (
    <div style={{
      fontFamily: "'Inter', sans-serif", background: '#F5F7FA',
      minHeight: '100vh', color: '#374151',
      padding: '40px 20px 64px',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* Back link */}
        <div style={{ marginBottom: 24 }}>
          <Link href="/training" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            ← Training Hub
          </Link>
        </div>

        {/* ── Certificate card ──────────────────────────────────────────── */}
        <div style={{
          background: '#fff', borderRadius: 16,
          border: '1px solid #E5E7EB',
          boxShadow: '0 8px 40px rgba(0,0,0,0.1)',
          overflow: 'hidden',
        }}>
          {/* Gold top stripe */}
          <div style={{ height: 6, background: 'linear-gradient(90deg, #C9A84C 0%, #E8C96E 50%, #C9A84C 100%)' }} />

          <div style={{ padding: '44px 48px 40px', textAlign: 'center' }}>

            {/* FMP Logo */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 32 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 9, background: '#2EAA4A',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
              }}>🎓</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A', lineHeight: 1.2 }}>
                  Financial Modeler Pro
                </div>
                <div style={{ fontSize: 10, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Training Academy
                </div>
              </div>
            </div>

            {/* Heading */}
            <div style={{
              fontSize: 'clamp(13px,2vw,15px)', fontWeight: 800, letterSpacing: '0.18em',
              textTransform: 'uppercase', color: '#0D2E5A', marginBottom: 18,
            }}>
              Certificate of Completion
            </div>

            {/* Gold divider */}
            <GoldRule />

            <div style={{ marginTop: 28, marginBottom: 28 }}>
              <p style={{ fontSize: 14, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 18 }}>
                This is to certify that
              </p>
              <div style={{
                fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800,
                color: '#0D2E5A', lineHeight: 1.15, marginBottom: 20,
                fontFamily: "'Georgia', 'Times New Roman', serif",
                letterSpacing: '-0.01em',
              }}>
                {cert.studentName}
              </div>
              <p style={{ fontSize: 14, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 14 }}>
                has successfully completed
              </p>
              <div style={{
                fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800,
                color: '#0D2E5A', marginBottom: 18, lineHeight: 1.3,
              }}>
                {courseLabel(cert.course)}
              </div>
              <div style={{ fontSize: 15, color: '#374151', marginBottom: 8 }}>
                {formatDate(cert.issuedAt)}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                Certificate ID: {cert.certificateId}
              </div>
            </div>

            {/* Gold divider */}
            <GoldRule />

            {/* Signatories */}
            <div style={{
              marginTop: 24, display: 'flex',
              justifyContent: 'center', alignItems: 'center',
              gap: 32, flexWrap: 'wrap',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A' }}>Ahmad Din</div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>CEO &amp; Founder</div>
              </div>
              <div style={{ width: 1, height: 32, background: '#E5E7EB', flexShrink: 0 }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A' }}>Financial Modeler Pro</div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>financialmodelerpro.com</div>
              </div>
            </div>
          </div>

          {/* Gold bottom stripe */}
          <div style={{ height: 4, background: 'linear-gradient(90deg, #C9A84C 0%, #E8C96E 50%, #C9A84C 100%)' }} />
        </div>

        {/* ── Verification badge ────────────────────────────────────────── */}
        <div style={{
          marginTop: 20, padding: '18px 20px',
          background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: '#2EAA4A', color: '#fff',
              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            }}>
              ✓ Verified
            </span>
            <span style={{ fontSize: 13, color: '#166534' }}>
              Independently verified by <strong>Certifier.io</strong>
            </span>
          </div>
          <a
            href={cert.certifierUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: '#15803D', fontWeight: 700, textDecoration: 'none' }}
          >
            Verify this certificate →
          </a>
        </div>

        {/* ── Action buttons ────────────────────────────────────────────── */}
        <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a
            href={cert.certifierUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '11px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: '#2EAA4A', color: '#fff', textDecoration: 'none',
              boxShadow: '0 2px 12px rgba(46,170,74,0.3)',
            }}
          >
            View on Certifier.io →
          </a>
          <a
            href={cert.certifierUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '11px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: '#1B4F8A', color: '#fff', textDecoration: 'none',
            }}
          >
            Download Certificate
          </a>
          <a
            href={linkedInUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '11px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: '#0A66C2', color: '#fff', textDecoration: 'none',
            }}
          >
            Share on LinkedIn →
          </a>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GoldRule() {
  return (
    <div style={{
      height: 2, margin: '0 auto',
      maxWidth: 320,
      background: 'linear-gradient(90deg, transparent, #C9A84C 20%, #E8C96E 50%, #C9A84C 80%, transparent)',
      borderRadius: 1,
    }} />
  );
}

function NotFoundView({ reason }: { reason: 'invalid' | 'notfound' }) {
  return (
    <div style={{
      fontFamily: "'Inter', sans-serif", background: '#F5F7FA',
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 9, background: '#2EAA4A',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          }}>🎓</div>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>Financial Modeler Pro</span>
        </div>

        <div style={{ fontSize: 52, marginBottom: 16 }}>🔍</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', marginBottom: 12 }}>
          Certificate Not Found
        </h1>
        <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, marginBottom: 28 }}>
          {reason === 'invalid'
            ? 'No certificate ID was provided in the URL.'
            : 'This certificate could not be found or may not have been issued yet.'}
        </p>
        <Link href="/training" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '11px 24px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          background: '#2EAA4A', color: '#fff', textDecoration: 'none',
        }}>
          ← Back to Training Hub
        </Link>
      </div>
    </div>
  );
}
