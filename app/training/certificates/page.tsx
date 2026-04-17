'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { NavbarServer } from '@/src/components/layout/NavbarServer';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface CourseRef {
  id: string;
  title: string;
  slug: string;
}

interface CertificateRecord {
  certificate_number: string;
  issued_at: string;
  courses: CourseRef;
}

interface ApiResponse {
  certificates: CertificateRecord[];
  userName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ─── Certificate Modal ────────────────────────────────────────────────────────

interface CertModalProps {
  cert: CertificateRecord;
  userName: string;
  onClose: () => void;
}

function CertificateModal({ cert, userName, onClose }: CertModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    const content = printRef.current;
    if (!content) return;
    const win = window.open('', '_blank', 'width=900,height=650');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Certificate - ${cert.courses.title}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
            body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
            @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
          </style>
        </head>
        <body>${content.outerHTML}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div style={{ background: '#fff', borderRadius: 16, maxWidth: 760, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.25)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #E8F0FB' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1B3A6B' }}>Certificate Preview</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handlePrint}
              style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Print / Save PDF
            </button>
            <button
              onClick={onClose}
              style={{ background: '#F4F7FC', color: '#374151', border: '1px solid #E5E7EB', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Printable certificate */}
        <div style={{ padding: 32 }}>
          <div
            ref={printRef}
            style={{
              border: '4px solid #B8860B',
              borderRadius: 12,
              padding: '48px 56px',
              textAlign: 'center',
              fontFamily: "'Inter', sans-serif",
              background: '#FFFEF5',
              position: 'relative',
            }}
          >
            {/* Corner ornaments */}
            {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(pos => (
              <div key={pos} style={{
                position: 'absolute',
                [pos.includes('top') ? 'top' : 'bottom']: 12,
                [pos.includes('left') ? 'left' : 'right']: 12,
                width: 28,
                height: 28,
                border: '2px solid #B8860B',
                borderRadius: 2,
              }} />
            ))}

            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.25em', color: '#B8860B', textTransform: 'uppercase', marginBottom: 20 }}>
              Financial Modeler Pro
            </div>

            <div style={{ fontSize: 28, fontWeight: 900, color: '#1B3A6B', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
              Certificate of Completion
            </div>

            <div style={{ width: 80, height: 3, background: 'linear-gradient(to right, #B8860B, #DAA520, #B8860B)', borderRadius: 2, margin: '20px auto' }} />

            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
              This certifies that
            </div>

            <div style={{ fontSize: 32, fontWeight: 900, color: '#1B3A6B', marginBottom: 12, fontStyle: 'italic' }}>
              {userName || 'Valued Student'}
            </div>

            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
              has successfully completed
            </div>

            <div style={{ fontSize: 20, fontWeight: 800, color: '#1B3A6B', marginBottom: 32, maxWidth: 520, margin: '0 auto 32px' }}>
              {cert.courses.title}
            </div>

            <div style={{ width: 80, height: 3, background: 'linear-gradient(to right, #B8860B, #DAA520, #B8860B)', borderRadius: 2, margin: '0 auto 28px' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                  Certificate Number
                </div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: 700, color: '#1B3A6B', letterSpacing: '0.06em' }}>
                  {cert.certificate_number}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                  Date Issued
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  {formatDate(cert.issued_at)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CertificatesPage() {
  const { data: session } = useSession();
  const [certificates, setCertificates] = useState<CertificateRecord[]>([]);
  const [userName, setUserName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCert, setActiveCert] = useState<CertificateRecord | null>(null);

  useEffect(() => {
    fetch('/api/training/certificates')
      .then(r => r.json())
      .then((data: ApiResponse) => {
        setCertificates(data.certificates ?? []);
        setUserName(data.userName ?? session?.user?.name ?? '');
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load certificates');
        setLoading(false);
      });
  }, [session?.user?.name]);

  const displayName = userName || session?.user?.name || 'Valued Student';

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F4F7FC', minHeight: '100vh' }}>

      <NavbarServer />
      <div style={{ height: 64 }} />

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>My Certificates</h1>
            <p style={{ fontSize: 14, color: '#6B7280' }}>
              {loading ? 'Loading…' : `${certificates.length} certificate${certificates.length !== 1 ? 's' : ''} earned`}
            </p>
          </div>
          <Link
            href="/training"
            style={{ fontSize: 13, color: '#1B4F8A', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            ← Training Library
          </Link>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '14px 20px', marginBottom: 24, color: '#7F1D1D', fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 24px', color: '#9CA3AF', fontSize: 14 }}>
            Loading your certificates…
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && certificates.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '64px 40px', textAlign: 'center', boxShadow: '0 2px 16px rgba(27,58,107,0.06)' }}>
            <div style={{ fontSize: 56, marginBottom: 20 }}>🎓</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1B3A6B', marginBottom: 10 }}>No Certificates Yet</h2>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 28, maxWidth: 400, margin: '0 auto 28px' }}>
              Complete a course assessment to earn your first certificate. Each certificate validates your knowledge of the course material.
            </p>
            <Link
              href="/training"
              style={{ display: 'inline-block', background: '#1B4F8A', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 14, fontWeight: 700 }}
            >
              Browse Training Courses
            </Link>
          </div>
        )}

        {/* Certificate grid */}
        {!loading && certificates.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 20 }}>
            {certificates.map(cert => (
              <div
                key={cert.certificate_number}
                style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 12px rgba(27,58,107,0.07)', border: '1px solid #E8F0FB', display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                {/* Course name */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Course Completed
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', lineHeight: 1.4 }}>
                    {cert.courses.title}
                  </div>
                </div>

                {/* Certificate number */}
                <div style={{ background: '#F4F7FC', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                    Certificate Number
                  </div>
                  <div style={{ fontFamily: "'Courier New', monospace", fontSize: 16, fontWeight: 700, color: '#1B3A6B', letterSpacing: '0.06em' }}>
                    {cert.certificate_number}
                  </div>
                </div>

                {/* Footer row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#9CA3AF' }}>Issued</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{formatDate(cert.issued_at)}</div>
                  </div>
                  <button
                    onClick={() => setActiveCert(cert)}
                    style={{ background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Download Certificate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Certificate modal */}
      {activeCert && (
        <CertificateModal
          cert={activeCert}
          userName={displayName}
          onClose={() => setActiveCert(null)}
        />
      )}
    </div>
  );
}
