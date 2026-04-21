'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const NAVY  = '#0D2E5A';
const GREEN = '#2EAA4A';
const GOLD  = '#F5B942';

interface CourseCard {
  code:        '3SFM' | 'BVM';
  title:       string;
  subtitle:    string;
  description: string;
  accent:      string;
}

const COURSES: CourseCard[] = [
  {
    code:        '3SFM',
    title:       '3-Statement Financial Modeling',
    subtitle:    '18 sessions + final exam',
    description: 'Build an integrated income statement, balance sheet, and cash flow model. Covers linkage, revenue drivers, working capital, debt scheduling, and scenario analysis.',
    accent:      GREEN,
  },
  {
    code:        'BVM',
    title:       'Business Valuation Modeling',
    subtitle:    '6 lessons + final exam',
    description: 'DCF, trading comps, transaction comps, and LBO. Build defensible valuations you can walk an investor through.',
    accent:      GOLD,
  },
];

interface Props {
  enrolled: string[];
}

export function EnrollClient({ enrolled }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enrolledSet = new Set(enrolled);

  async function enroll(code: '3SFM' | 'BVM') {
    setError(null);
    setBusy(code);
    try {
      const res = await fetch('/api/training/enroll', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ course_code: code }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Enrollment failed');
        setBusy(null);
        return;
      }
      // Land the student directly in the course view they just enrolled in.
      const courseSlug = code.toLowerCase();
      router.push(`/training/dashboard?course=${courseSlug}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  function goDashboard() {
    router.push('/training/dashboard');
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(135deg, #071530 0%, ${NAVY} 50%, #0F3D6E 100%)`,
      padding: '40px 20px',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, marginBottom: 8 }}>
            Choose your path
          </div>
          <h1 style={{ color: '#fff', fontSize: 32, fontWeight: 800, margin: 0 }}>
            Welcome. Pick your first course.
          </h1>
          <p style={{ color: '#94A3B8', fontSize: 14, marginTop: 10, maxWidth: 560, marginInline: 'auto' }}>
            You can add the other course later from your dashboard. Both certifications stand on their own.
          </p>
        </div>

        {error && (
          <div style={{
            background: '#7F1D1D', color: '#FECACA', border: '1px solid #B91C1C',
            padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: 13, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 18,
        }}>
          {COURSES.map(c => {
            const already = enrolledSet.has(c.code);
            const loading = busy === c.code;
            return (
              <div key={c.code} style={{
                background: '#fff', borderRadius: 14, padding: '26px 24px',
                borderTop: `4px solid ${c.accent}`, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {c.code}
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: '6px 0 4px' }}>
                  {c.title}
                </h2>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>{c.subtitle}</div>
                <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, flex: 1 }}>
                  {c.description}
                </p>
                <button
                  onClick={() => !already && !loading && enroll(c.code)}
                  disabled={already || loading}
                  style={{
                    marginTop: 18,
                    padding: '11px 20px',
                    background: already ? '#E5E7EB' : c.accent,
                    color: already ? '#6B7280' : '#fff',
                    border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14,
                    cursor: already || loading ? 'default' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {already ? 'Already enrolled' : loading ? 'Enrolling...' : `Enroll in ${c.code}`}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <button
            onClick={goDashboard}
            disabled={enrolledSet.size === 0}
            style={{
              background: 'transparent', color: enrolledSet.size === 0 ? '#475569' : '#fff',
              border: `1px solid ${enrolledSet.size === 0 ? '#334155' : '#64748B'}`,
              padding: '9px 22px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: enrolledSet.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {enrolledSet.size === 0 ? 'Choose at least one course to continue' : 'Go to dashboard'}
          </button>
        </div>
      </div>
    </div>
  );
}
