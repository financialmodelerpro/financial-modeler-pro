'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

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

export default function SubmitModelingTestimonialPage() {
  const { data: session, status } = useSession();

  const [form, setForm] = useState({
    name:             '',
    role:             '',
    company:          '',
    rating:           5,
    testimonial_type: 'written' as 'written' | 'video',
    text:             '',
    video_url:        '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState('');

  function set(key: keyof typeof form, value: string | number) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/modeling/submit-testimonial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:             form.name,
          role:             form.role || undefined,
          company:          form.company || undefined,
          rating:           form.rating,
          testimonial_type: form.testimonial_type,
          text:             form.testimonial_type === 'written' ? form.text : undefined,
          video_url:        form.testimonial_type === 'video' ? form.video_url : undefined,
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
      {/* Simple header */}
      <div style={{ background: '#0D2E5A', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/modeling" style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, textDecoration: 'none' }}>← Modeling Hub</Link>
        <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Submit Testimonial</span>
      </div>

      <div style={{ maxWidth: 580, margin: '0 auto', padding: '48px 24px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⭐</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>Share Your Experience</h1>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
            How has the FMP Modeling Hub helped your work? Your feedback helps us improve and inspires others.
          </p>
        </div>

        {status === 'loading' ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading...</div>
        ) : !session?.user ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '40px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0D2E5A', marginBottom: 10 }}>Login Required</h2>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 28, lineHeight: 1.6 }}>
              Please log in to your Modeling Hub account to submit a testimonial.
            </p>
            <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0D2E5A', color: '#fff', fontWeight: 700, fontSize: 15, padding: '12px 28px', borderRadius: 8, textDecoration: 'none' }}>
              Login to Modeling Hub →
            </Link>
          </div>
        ) : submitted ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #BBF7D0', padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#15803D', marginBottom: 10 }}>Thank You!</h2>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 28 }}>
              Your testimonial has been submitted for review. We appreciate your feedback!
            </p>
            <Link href="/modeling" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0D2E5A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 24px', borderRadius: 8, textDecoration: 'none' }}>
              ← Back to Modeling Hub
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '36px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Name */}
            <div>
              <label style={labelStyle}>Your Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                required placeholder="e.g. Ahmad Din" style={inputStyle} />
            </div>

            {/* Role + Company */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Role / Title</label>
                <input value={form.role} onChange={e => set('role', e.target.value)}
                  placeholder="e.g. Investment Analyst" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <input value={form.company} onChange={e => set('company', e.target.value)}
                  placeholder="e.g. BlackRock" style={inputStyle} />
              </div>
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
                    style={{ padding: '8px 20px', borderRadius: 7, border: `2px solid ${form.testimonial_type === type ? '#0D2E5A' : '#D1D5DB'}`, background: form.testimonial_type === type ? '#0D2E5A' : '#fff', color: form.testimonial_type === type ? '#fff' : '#374151', fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize' }}>
                    {type === 'written' ? '✍️ Written' : '🎥 Video'}
                  </button>
                ))}
              </div>
            </div>

            {form.testimonial_type === 'written' ? (
              <div>
                <label style={labelStyle}>Your Testimonial *</label>
                <textarea
                  value={form.text}
                  onChange={e => set('text', e.target.value)}
                  required
                  rows={5}
                  placeholder="How has the Modeling Hub helped your work? What did you build?"
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                />
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{form.text.length} characters</div>
              </div>
            ) : (
              <div>
                <label style={labelStyle}>YouTube / Video URL *</label>
                <input value={form.video_url} onChange={e => set('video_url', e.target.value)}
                  required placeholder="https://youtu.be/..." style={inputStyle} />
              </div>
            )}

            {error && (
              <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#DC2626', fontWeight: 600 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting}
              style={{ padding: '14px 32px', background: submitting ? '#9CA3AF' : '#0D2E5A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>
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
