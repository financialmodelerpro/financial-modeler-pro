'use client';

import { useEffect, useState } from 'react';
import type { Certificate } from './types';

interface CertificateImageCardProps {
  cert: Certificate;
}

interface SupaCertData {
  certificate_id:   string | null;
  cert_pdf_url:     string | null;
  badge_url:        string | null;
  transcript_url:   string | null;
  verification_url: string | null;
  grade:            string | null;
  issued_at:        string | null;
  cert_status:      string | null;
}

export function CertificateImageCard({ cert }: CertificateImageCardProps) {
  const [supaData, setSupaData] = useState<SupaCertData | null>(null);
  const [loading,  setLoading]  = useState(true);

  const learnUrl = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
  const mainUrl  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';

  useEffect(() => {
    // Fetch internal cert data from Supabase
    const param = cert.email
      ? `email=${encodeURIComponent(cert.email)}`
      : `certId=${encodeURIComponent(cert.certificateId)}`;
    fetch(`/api/training/certificate-image?${param}`)
      .then(r => r.json())
      .then((j: { cert?: SupaCertData }) => {
        if (j.cert) setSupaData(j.cert);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cert.certificateId, cert.email]);

  // Derive values - prefer internal data, fall back to legacy certifierUrl
  const certId      = supaData?.certificate_id ?? cert.certificateId ?? '';
  const certPdfUrl  = supaData?.cert_pdf_url ?? cert.certPdfUrl ?? cert.certifierUrl ?? '';
  const badgeUrl    = supaData?.badge_url ?? cert.badgeUrl ?? '';
  const transcriptUrl = supaData?.transcript_url ?? cert.transcriptUrl ?? '';
  const grade       = supaData?.grade ?? cert.grade ?? '';
  const issuedAt    = supaData?.issued_at ?? cert.issuedAt ?? '';
  const status      = supaData?.cert_status ?? 'Issued';

  const verifyUrl   = certId
    ? `${learnUrl}/verify/${certId}`
    : (supaData?.verification_url ?? cert.verificationUrl ?? cert.certifierUrl ?? '');

  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}`;

  // ── Pending state ──────────────────────────────────────────────────────────
  if (!loading && status === 'Pending') {
    return (
      <div style={{
        border: '2px solid #FCD34D', borderRadius: 12, overflow: 'hidden',
        background: '#FFFBEB', boxShadow: '0 4px 20px rgba(201,168,76,0.1)', marginTop: 20,
      }}>
        <div style={{ background: '#92400E', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Certificate Being Prepared</span>
        </div>
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E', marginBottom: 8 }}>Your certificate is being generated</div>
          <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
            It will appear here within 15 minutes once processing is complete.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      border: '2px solid #C9A84C', borderRadius: 12, overflow: 'hidden',
      background: 'linear-gradient(135deg, #FFFBF0 0%, #FFF8E1 100%)',
      boxShadow: '0 4px 20px rgba(201,168,76,0.15)', marginTop: 20,
    }}>
      {/* Header */}
      <div style={{ background: '#0D2E5A', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🏆</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{cert.course} Certificate</span>
        </div>
        {grade && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', background: 'rgba(201,168,76,0.2)', padding: '3px 10px', borderRadius: 12 }}>
            {grade}
          </span>
        )}
      </div>

      <div style={{ padding: '20px' }}>
        {/* Meta */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0D2E5A', marginBottom: 2 }}>{cert.studentName}</div>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 2 }}>{cert.course}</div>
          {certId && (
            <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', marginBottom: 2 }}>
              ID: {certId}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#6B7280' }}>
            Issued: {issuedAt ? new Date(issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'}
          </div>
        </div>

        {/* QR code */}
        {verifyUrl && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: 12, borderRadius: 8, background: '#fff', border: '1px solid #E5E7EB' }}>
            <img
              src={`/api/qr?url=${encodeURIComponent(verifyUrl)}`}
              alt="Verification QR"
              width={80}
              height={80}
              style={{ borderRadius: 6, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Scan to verify</div>
              <div style={{ fontSize: 10, color: '#9CA3AF', wordBreak: 'break-all', lineHeight: 1.4 }}>
                {learnUrl}/verify/{certId}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {certPdfUrl && (
            <a href={certPdfUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '9px 16px', borderRadius: 7, background: '#0D2E5A', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
              ⬇ Download Certificate PDF
            </a>
          )}
          {badgeUrl && (
            <a href={badgeUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '9px 16px', borderRadius: 7, background: '#C9A84C', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
              🎖 Download Badge
            </a>
          )}
          {transcriptUrl && (
            <a href={transcriptUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '9px 16px', borderRadius: 7, background: '#1B4F8A', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
              📄 Download Transcript
            </a>
          )}
          <a href={linkedInUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', padding: '9px 16px', borderRadius: 7, background: '#0A66C2', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>
            🔗 Share on LinkedIn
          </a>
          {verifyUrl && (
            <a href={verifyUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '9px 16px', borderRadius: 7, background: '#fff', color: '#374151', textDecoration: 'none', fontSize: 12, fontWeight: 700, textAlign: 'center', border: '1px solid #D1D5DB' }}>
              ✅ Verify Certificate ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
