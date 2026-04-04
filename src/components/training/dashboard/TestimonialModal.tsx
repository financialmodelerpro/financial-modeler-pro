'use client';

import { useState } from 'react';

interface TestimonialModalProps {
  mode: 'written' | 'video';
  studentName: string;
  studentEmail: string;
  regId: string;
  courseCode: string;
  courseName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function TestimonialModal({ mode, studentName, studentEmail, regId, courseCode, courseName, onClose, onSuccess }: TestimonialModalProps) {
  const [content, setContent]         = useState('');
  const [rating, setRating]           = useState(5);
  const [videoUrl, setVideoUrl]       = useState('');
  const [jobTitle, setJobTitle]       = useState('');
  const [company, setCompany]         = useState('');
  const [location, setLocation]       = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [consent, setConsent]         = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState(false);

  async function handleSubmit() {
    if (!consent) { setError('Please give your consent to submit.'); return; }
    if (mode === 'written' && content.trim().length < 50) { setError('Please write at least 50 characters.'); return; }
    if (mode === 'video' && !videoUrl.trim()) { setError('Please enter a video URL.'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/testimonials/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: regId, studentName, studentEmail, courseCode, courseName, type: mode, content, rating, videoUrl, jobTitle, company, location, linkedinUrl }),
      });
      if (res.status === 409) { setError('You have already submitted a testimonial for this course.'); setSubmitting(false); return; }
      if (!res.ok) throw new Error();
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 2800);
    } catch { setError('Submission failed. Please try again.'); }
    setSubmitting(false);
  }

  if (success) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: '44px 32px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>{mode === 'video' ? '🎥' : '✅'}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>Thank you!</div>
          <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
            {mode === 'video'
              ? 'Our team will review your video testimonial and be in touch.'
              : 'Your testimonial has been submitted for review. We\'ll notify you when it\'s published.'}
          </div>
        </div>
      </div>
    );
  }

  const fields = [
    { label: 'Job Title', value: jobTitle,    setter: setJobTitle,    placeholder: 'e.g. Financial Analyst' },
    { label: 'Company',   value: company,     setter: setCompany,     placeholder: 'e.g. Goldman Sachs' },
    { label: 'Location',  value: location,    setter: setLocation,    placeholder: 'e.g. Lahore, Pakistan' },
    { label: 'LinkedIn',  value: linkedinUrl, setter: setLinkedinUrl, placeholder: 'https://linkedin.com/in/...' },
  ];

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '26px 26px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0D2E5A' }}>
            {mode === 'video' ? '🎥 Submit Video Testimonial' : '📝 Write Your Testimonial'}
          </div>
          <button onClick={onClose} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>✕</button>
        </div>

        {/* Auto-filled */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[{ label: 'Course', val: courseName }, { label: 'Your Name', val: studentName || 'Student' }].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>{f.label.toUpperCase()}</div>
              <div style={{ padding: '8px 10px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, color: '#374151' }}>{f.val}</div>
            </div>
          ))}
        </div>

        {mode === 'written' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 6 }}>RATING</div>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1,2,3,4,5].map(i => (
                  <button key={i} onClick={() => setRating(i)}
                    style={{ fontSize: 26, background: 'none', border: 'none', cursor: 'pointer', color: i <= rating ? '#F59E0B' : '#E5E7EB', padding: '0 1px', lineHeight: 1 }}>
                    ★
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>YOUR EXPERIENCE <span style={{ color: '#DC2626' }}>*</span></div>
              <textarea value={content} onChange={e => setContent(e.target.value.slice(0, 500))} rows={5}
                placeholder="This course completely transformed how I build financial models..."
                style={{ width: '100%', padding: '9px 11px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, fontFamily: 'Inter,sans-serif', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', color: '#374151' }} />
              <div style={{ fontSize: 10, color: content.length < 50 && content.length > 0 ? '#DC2626' : '#9CA3AF', marginTop: 3 }}>
                {content.length}/500{content.length < 50 && content.length > 0 ? ` — ${50 - content.length} more required` : ''}
              </div>
            </div>
          </>
        )}

        {mode === 'video' && (
          <>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '11px 14px', marginBottom: 14, fontSize: 12, color: '#1E40AF', lineHeight: 1.7 }}>
              <strong>Option 1 — Loom (free &amp; easy):</strong> Record at loom.com, paste share link below.<br />
              <strong>Option 2 — YouTube:</strong> Upload as Unlisted, paste the YouTube URL below.
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>VIDEO URL <span style={{ color: '#DC2626' }}>*</span></div>
              <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                placeholder="https://loom.com/share/... or https://youtube.com/watch?v=..."
                style={{ width: '100%', padding: '9px 11px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
            </div>
          </>
        )}

        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8, fontWeight: 600 }}>Optional: Add your details (shown publicly with testimonial)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {fields.map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', marginBottom: 3 }}>{f.label.toUpperCase()}</div>
              <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
          I consent to this testimonial being displayed on the Financial Modeler Pro website.
        </label>

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSubmit} disabled={submitting || !consent}
            style={{ flex: 1, padding: '11px', background: submitting || !consent ? '#9CA3AF' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: submitting || !consent ? 'not-allowed' : 'pointer' }}>
            {submitting ? 'Submitting…' : mode === 'video' ? '🎥 Submit Video' : '📝 Submit Testimonial'}
          </button>
          <button onClick={onClose}
            style={{ padding: '11px 18px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, color: '#6B7280', cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
