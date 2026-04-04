'use client';

import { useEffect, useState } from 'react';
import type { Certificate } from './types';

interface CertificateImageCardProps {
  cert: Certificate;
}

export function CertificateImageCard({ cert }: CertificateImageCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [certUrl, setCertUrl]   = useState<string | null>(null);

  // Extract UUID from certifierUrl (last path segment)
  const uuid = cert.certifierUrl
    ? cert.certifierUrl.replace(/\/$/, '').split('/').pop() ?? ''
    : '';

  useEffect(() => {
    if (!uuid) return;
    fetch(`/api/training/certificate-image?uuid=${encodeURIComponent(uuid)}`)
      .then(r => r.json())
      .then((j: { imageUrl?: string | null; certUrl?: string | null }) => {
        if (j.imageUrl) setImageUrl(j.imageUrl);
        if (j.certUrl)  setCertUrl(j.certUrl);
      })
      .catch(() => {});
  }, [uuid]);

  const verifyUrl = uuid
    ? `https://financialmodelerpro.com/verify/${uuid}`
    : cert.certifierUrl;

  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}`;

  return (
    <div style={{
      border: '2px solid #C9A84C',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #FFFBF0 0%, #FFF8E1 100%)',
      boxShadow: '0 4px 20px rgba(201,168,76,0.15)',
      marginTop: 20,
    }}>
      {/* Header */}
      <div style={{ background: '#0D2E5A', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>🏆</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Your Certificate</span>
      </div>

      <div style={{ padding: '20px' }}>
        {/* Certificate image */}
        <div style={{ marginBottom: 16, textAlign: 'center' }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Certificate"
              style={{ width: 220, borderRadius: 8, border: '1px solid #E5E7EB' }}
            />
          ) : (
            <div style={{
              width: 220, height: 140, margin: '0 auto',
              borderRadius: 8, border: '2px dashed #D1D5DB',
              background: '#FAFAFA',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 6, color: '#9CA3AF', fontSize: 12,
            }}>
              <span style={{ fontSize: 28 }}>📜</span>
              Certificate
            </div>
          )}
        </div>

        {/* Details */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0D2E5A', marginBottom: 2 }}>{cert.studentName}</div>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 2 }}>{cert.course}</div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>
            Issued: {cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
          </div>
        </div>

        {/* QR code */}
        {uuid && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px', borderRadius: 8, background: '#fff', border: '1px solid #E5E7EB' }}>
            <img
              src={`/api/qr?url=${encodeURIComponent(verifyUrl)}`}
              alt="Verification QR"
              width={100}
              height={100}
              style={{ borderRadius: 6, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Scan to verify</div>
              <div style={{ fontSize: 10, color: '#9CA3AF', wordBreak: 'break-all', lineHeight: 1.4 }}>
                financialmodelerpro.com/verify/{uuid}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(certUrl || cert.certifierUrl) && (
            <a
              href={certUrl || cert.certifierUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '9px 16px', borderRadius: 7,
                background: '#0D2E5A', color: '#fff', textDecoration: 'none',
                fontSize: 12, fontWeight: 700, textAlign: 'center',
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
              display: 'block', padding: '9px 16px', borderRadius: 7,
              background: '#0A66C2', color: '#fff', textDecoration: 'none',
              fontSize: 12, fontWeight: 700, textAlign: 'center',
            }}
          >
            🔗 Share on LinkedIn
          </a>
          {uuid && (
            <a
              href={`/verify/${uuid}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '9px 16px', borderRadius: 7,
                background: '#fff', color: '#374151', textDecoration: 'none',
                fontSize: 12, fontWeight: 700, textAlign: 'center',
                border: '1px solid #D1D5DB',
              }}
            >
              Verify ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
