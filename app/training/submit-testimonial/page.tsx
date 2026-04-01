'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getTrainingSession } from '@/src/lib/training-session';

const COURSE_OPTIONS = [
  { value: '3-Statement Financial Modeling (3SFM)', label: '3-Statement Financial Modeling (3SFM)' },
  { value: 'Business Valuation Modeling (BVM)', label: 'Business Valuation Modeling (BVM)' },
];

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 28, color: n <= (hover || value) ? '#F59E0B' : '#D1D5DB', padding: '0 2px', lineHeight: 1 }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function SubmitTrainingTestimonialPage() {
  const [session, setSession]             = useState<{ email: string; registrationId: string } | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [form, setForm] = useState({
    student_name:     '',
    job_title:        '',
    company:          '',
    location:         '',
    rating:           5,
    testimonial_type: 'written' as 'written' | 'video',
    written_content:  '',
    video_url:        '',
    linkedin_url:     '',
    course_name:      COURSE_OPTIONS[0].value,
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    const s = getTrainingSession();
    setSession(s);
    setSessionLoading(false);
  }, []);

  function set(key: keyof typeof form, value: string | number) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/training/submit-testimonial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_id: session.registrationId,
          email:           session.email,
          student_name:    form.student_name,
          job_title:       form.job_title || undefined,
          company:         form.company || undefined,
          location:        form.location || undefined,
          rating:          form.rating,
          testimonial_type: form.testimonial_type,
          written_content: form.testimonial_type === 'written' ? form.written_content : undefined,
          video_url:       form.testimonial_type === 'video' ? form.video_url : undefined,
          linkedin_url:    form.linkedin_url || undefined,
          course_name:     form.course_name,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Submission failed');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: 14,
    border: '1.5px solid #D1D5DB', borderRadius: 8, outline: 'none',
    background: '#FFFBEB', fontFamily: 'inherit', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6,
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      <div style={{ maxWidth: 620, margin: '0 auto', padding: '48px 24px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⭐</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>Share Your Experience</h1>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
            Tell us how FMP Training Hub has helped you. Your testimonial will be reviewed and may be featured on our site.
          </p>
        </div>

        {/* Not logged in */}
        {sessionLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading...</div>
        ) : !session ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '40px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0D2E5A', marginBottom: 10 }}>Login Required</h2>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 28, lineHeight: 1.6 }}>
              You need to be logged in to your Training Hub account to submit a testimonial.
            </p>
            <Link href="/training/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 15, padding: '12px 28px', borderRadius: 8, textDecoration: 'none' }}>
              Login to Training Hub →
            </Link>
            <p style={{ marginTop: 16, fontSize: 13, color: '#9CA3AF' }}>
              Don&apos;t have an account?{' '}
              <Link href="/training/register" style={{ color: '#2EAA4A', fontWeight: 600, textDecoration: 'none' }}>Register free</Link>
            </p>
          </div>
        ) : submitted ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #BBF7D0', padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#15803D', marginBottom: 10 }}>Thank You!</h2>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 28 }}>
              Your testimonial has been submitted and is under review. We appreciate your feedback!
            </p>
            <Link href="/training/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 24px', borderRadius: 8, textDecoration: 'none' }}>
              ← Back to Dashboard
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Course */}
            <div>
              <label style={labelStyle}>Course *</label>
              <select value={form.course_name} onChange={e => set('course_name', e.target.value)}
                style={{ ...inputStyle, background: '#fff' }}>
                {COURSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Name */}
            <div>
              <label style={labelStyle}>Your Name *</label>
              <input value={form.student_name} onChange={e => set('student_name', e.target.value)}
                required placeholder="e.g. Ahmad Din" style={inputStyle} />
            </div>

            {/* Job Title + Company */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Job Title</label>
                <input value={form.job_title} onChange={e => set('job_title', e.target.value)}
                  placeholder="e.g. Financial Analyst" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <input value={form.company} onChange={e => set('company', e.target.value)}
                  placeholder="e.g. KPMG" style={inputStyle} />
              </div>
            </div>

            {/* Location */}
            <div>
              <label style={labelStyle}>Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)}
                placeholder="e.g. Dubai, UAE" style={inputStyle} />
            </div>

            {/* Rating */}
            <div>
              <label style={labelStyle}>Rating *</label>
              <StarPicker value={form.rating} onChange={v => set('rating', v)} />
            </div>

            {/* Type toggle */}
            <div>
              <label style={labelStyle}>Testimonial Type *</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['written', 'video'] as const).map(type => (
                  <button key={type} type="button" onClick={() => set('testimonial_type', type)}
                    style={{ padding: '8px 20px', borderRadius: 7, border: `2px solid ${form.testimonial_type === type ? '#1B4F8A' : '#D1D5DB'}`, background: form.testimonial_type === type ? '#1B4F8A' : '#fff', color: form.testimonial_type === type ? '#fff' : '#374151', fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize' }}>
                    {type === 'written' ? '✍️ Written' : '🎥 Video'}
                  </button>
                ))}
              </div>
            </div>

            {/* Written content or video URL */}
            {form.testimonial_type === 'written' ? (
              <div>
                <label style={labelStyle}>Your Testimonial *</label>
                <textarea
                  value={form.written_content}
                  onChange={e => set('written_content', e.target.value)}
                  required
                  rows={5}
                  placeholder="Tell us about your experience with this course..."
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                />
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{form.written_content.length} characters</div>
              </div>
            ) : (
              <div>
                <label style={labelStyle}>YouTube / Video URL *</label>
                <input value={form.video_url} onChange={e => set('video_url', e.target.value)}
                  required placeholder="https://youtu.be/..." style={inputStyle} />
              </div>
            )}

            {/* LinkedIn */}
            <div>
              <label style={labelStyle}>LinkedIn Profile URL <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional)</span></label>
              <input value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)}
                placeholder="https://linkedin.com/in/yourprofile" style={inputStyle} />
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#DC2626', fontWeight: 600 }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={submitting}
              style={{ padding: '14px 32px', background: submitting ? '#9CA3AF' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>
              {submitting ? 'Submitting…' : 'Submit Testimonial →'}
            </button>

            <p style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 1.5 }}>
              Your testimonial will be reviewed before being published. We may edit for length or clarity.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
