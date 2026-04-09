'use client';

import { useState } from 'react';

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export interface ShareExperienceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // Student info
  studentName: string;
  studentEmail: string;
  regId?: string; // Training Hub registration ID
  userId?: string; // Modeling Hub user ID
  jobTitle?: string;
  company?: string;
  linkedinUrl?: string;
  profilePhotoUrl?: string;
  // Context
  hub: 'training' | 'modeling';
  sessionsCompleted?: number;
  courseCode?: string;
  courseName?: string;
  certificationEarned?: boolean;
  verificationUrl?: string;
  // UI
  defaultTab?: 'written' | 'video' | 'social';
}

export function ShareExperienceModal({
  isOpen, onClose, onSuccess,
  studentName, studentEmail, regId, userId,
  jobTitle: initJobTitle = '', company: initCompany = '',
  linkedinUrl: initLinkedin = '', hub,
  sessionsCompleted = 0, courseCode = '', courseName = '',
  certificationEarned = false, verificationUrl = '',
  defaultTab = 'written',
}: ShareExperienceModalProps) {
  const [tab, setTab] = useState<'written' | 'video' | 'social'>(defaultTab);

  // Written review state
  const [rating, setRating]       = useState(5);
  const [name, setName]           = useState(studentName);
  const [jobTitle, setJobTitle]   = useState(initJobTitle);
  const [company, setCompany]     = useState(initCompany);
  const [content, setContent]     = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState(initLinkedin);

  // Video state
  const [videoUrl, setVideoUrl]   = useState('');
  const [videoDesc, setVideoDesc] = useState('');

  // Shared state
  const [consent, setConsent]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);
  const [copied, setCopied]       = useState(false);

  if (!isOpen) return null;

  const apiUrl = hub === 'training' ? '/api/testimonials/student' : '/api/modeling/submit-testimonial';
  const siteUrl = hub === 'training' ? LEARN_URL : APP_URL;

  // Social share text
  const shareText = hub === 'training'
    ? `I'm learning Financial Modeling at Financial Modeler Pro! ${sessionsCompleted > 0 ? `Just completed ${sessionsCompleted} sessions${courseName ? ` of the ${courseName} course` : ''}.` : ''} #FinancialModeling #Finance #Learning\n${siteUrl}`
    : `I'm using Financial Modeler Pro for professional financial modeling! #FinancialModeling #Finance\n${siteUrl}`;

  const [socialText, setSocialText] = useState(shareText);

  const certShareText = certificationEarned && verificationUrl
    ? `I just earned my ${courseName || 'Financial Modeling'} Certificate from Financial Modeler Pro! Verify it here: ${verificationUrl} #FinancialModeling #Certified`
    : '';

  function validateLinkedin(url: string): boolean {
    if (!url) return true; // optional
    return /linkedin\.com\/in\//i.test(url);
  }

  function validateVideoUrl(url: string): boolean {
    if (!url) return false;
    return /loom\.com|youtube\.com|youtu\.be/i.test(url);
  }

  async function handleSubmit(type: 'written' | 'video') {
    setError('');
    if (!consent) { setError('Please give your consent to submit.'); return; }
    if (type === 'written' && content.trim().length < 50) { setError('Please write at least 50 characters.'); return; }
    if (type === 'video' && !validateVideoUrl(videoUrl)) { setError('Please enter a valid Loom or YouTube link.'); return; }
    if (linkedinUrl && !validateLinkedin(linkedinUrl)) { setError('Please enter a valid LinkedIn profile URL (linkedin.com/in/...).'); return; }

    setSubmitting(true);
    try {
      const body = hub === 'training'
        ? { registrationId: regId, studentName: name, studentEmail, courseCode, courseName, type, content, rating, videoUrl, jobTitle, company, linkedinUrl }
        : { name, email: studentEmail, type, content, rating, videoUrl, jobTitle, company, linkedinUrl };
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 409) { setError('You have already submitted a testimonial.'); setSubmitting(false); return; }
      if (!res.ok) throw new Error();
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 3000);
    } catch { setError('Submission failed. Please try again.'); }
    setSubmitting(false);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function openShare(platform: string, text: string) {
    const encoded = encodeURIComponent(text);
    const urls: Record<string, string> = {
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(siteUrl)}`,
      twitter: `https://twitter.com/intent/tweet?text=${encoded}`,
      whatsapp: `https://wa.me/?text=${encoded}`,
    };
    if (urls[platform]) window.open(urls[platform], '_blank');
  }

  // Success screen
  if (success) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: '44px 32px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>{tab === 'video' ? '\u{1F3A5}' : '\u2705'}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Thank you!</div>
          <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
            Your {tab === 'video' ? 'video testimonial' : 'review'} has been submitted for approval. We'll notify you when it's published.
          </div>
        </div>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 13, color: '#374151', outline: 'none' };
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>Share Your Experience</div>
          <button onClick={onClose} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', lineHeight: 1 }}>&times;</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E5E7EB', margin: '16px 24px 0' }}>
          {([
            { key: 'written' as const, label: 'Written Review' },
            { key: 'video' as const, label: 'Video Testimonial' },
            { key: 'social' as const, label: 'Share' },
          ]).map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setError(''); }}
              style={{ padding: '10px 16px', fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? NAVY : '#9CA3AF', background: 'none', border: 'none', borderBottom: tab === t.key ? `2px solid ${NAVY}` : '2px solid transparent', cursor: 'pointer', marginBottom: -2 }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '20px 24px 24px' }}>

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* TAB 1 — Written Review                                         */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {tab === 'written' && (
            <div>
              {/* Star Rating */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Rating *</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button key={star} onClick={() => setRating(star)}
                      style={{ fontSize: 28, background: 'none', border: 'none', cursor: 'pointer', color: star <= rating ? '#F59E0B' : '#D1D5DB', lineHeight: 1 }}>
                      {'\u2605'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Name + Job Title row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Your Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Job Title</label>
                  <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Financial Analyst" style={inputStyle} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Company</label>
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Deloitte" style={inputStyle} />
              </div>

              {/* Review text */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Your Review * <span style={{ fontWeight: 400, color: '#9CA3AF' }}>({content.length}/500, min 50)</span></label>
                <textarea value={content} onChange={e => setContent(e.target.value.slice(0, 500))}
                  placeholder="Share how Financial Modeler Pro has helped you in your career..."
                  style={{ ...inputStyle, height: 100, resize: 'vertical' }} />
              </div>

              {/* LinkedIn */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>LinkedIn Profile URL</label>
                <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/yourname" style={inputStyle} />
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Adding your LinkedIn helps others verify your review</div>
              </div>

              {/* Consent */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
                  I consent to having my name and review displayed publicly on Financial Modeler Pro after approval.
                </span>
              </label>

              {error && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 10 }}>{error}</div>}

              <button onClick={() => handleSubmit('written')} disabled={submitting || !consent}
                style={{ width: '100%', padding: '12px', borderRadius: 8, background: submitting ? '#9CA3AF' : GREEN, color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer' }}>
                {submitting ? 'Submitting...' : 'Submit Written Review'}
              </button>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* TAB 2 — Video Testimonial                                      */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {tab === 'video' && (
            <div>
              <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16, lineHeight: 1.5 }}>
                Record a short video (30-60 seconds) using Loom or YouTube and paste the link below.
              </p>

              {/* Platform cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <a href="https://www.loom.com" target="_blank" rel="noopener noreferrer"
                  style={{ padding: '16px', borderRadius: 10, border: '1px solid #E5E7EB', textDecoration: 'none', textAlign: 'center', background: '#F9FAFB' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{'\u{1F4F9}'}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Loom</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>Free & easy screen + camera recording</div>
                </a>
                <a href="https://www.youtube.com/upload" target="_blank" rel="noopener noreferrer"
                  style={{ padding: '16px', borderRadius: 10, border: '1px solid #E5E7EB', textDecoration: 'none', textAlign: 'center', background: '#F9FAFB' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{'\u{1F4FA}'}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>YouTube</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF' }}>Upload video (can be unlisted)</div>
                </a>
              </div>

              {/* Video URL */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Video Link *</label>
                <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                  placeholder="https://loom.com/share/... or youtube.com/watch?v=..."
                  style={{ ...inputStyle, borderColor: videoUrl && !validateVideoUrl(videoUrl) ? '#DC2626' : '#D1D5DB' }} />
                {videoUrl && !validateVideoUrl(videoUrl) && (
                  <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>Please enter a valid Loom or YouTube link</div>
                )}
              </div>

              {/* Name + Job Title */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Your Name *</label>
                  <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Job Title</label>
                  <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Financial Analyst" style={inputStyle} />
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Brief Description</label>
                <textarea value={videoDesc} onChange={e => setVideoDesc(e.target.value.slice(0, 300))}
                  placeholder="What did you enjoy most about the course?"
                  style={{ ...inputStyle, height: 60, resize: 'vertical' }} />
              </div>

              {/* LinkedIn */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>LinkedIn Profile URL</label>
                <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/yourname" style={inputStyle} />
              </div>

              {/* Consent */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
                  I consent to having my video testimonial displayed publicly after approval.
                </span>
              </label>

              {error && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 10 }}>{error}</div>}

              <button onClick={() => handleSubmit('video')} disabled={submitting || !consent}
                style={{ width: '100%', padding: '12px', borderRadius: 8, background: submitting ? '#9CA3AF' : GREEN, color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer' }}>
                {submitting ? 'Submitting...' : 'Submit Video Testimonial'}
              </button>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════ */}
          {/* TAB 3 — Social Share                                           */}
          {/* ════════════════════════════════════════════════════════════════ */}
          {tab === 'social' && (
            <div>
              <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 12, lineHeight: 1.5 }}>
                Share your learning journey with your network! Edit the message below and choose a platform.
              </p>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Your Message</label>
                <textarea value={socialText} onChange={e => setSocialText(e.target.value)}
                  style={{ ...inputStyle, height: 100, resize: 'vertical', fontFamily: "'Inter', sans-serif" }} />
              </div>

              {/* Share buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
                <button onClick={() => openShare('linkedin', socialText)}
                  style={{ padding: '10px', borderRadius: 8, background: '#0A66C2', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}>
                  LinkedIn
                </button>
                <button onClick={() => openShare('twitter', socialText)}
                  style={{ padding: '10px', borderRadius: 8, background: '#1DA1F2', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}>
                  Twitter / X
                </button>
                <button onClick={() => openShare('whatsapp', socialText)}
                  style={{ padding: '10px', borderRadius: 8, background: '#25D366', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}>
                  WhatsApp
                </button>
                <button onClick={() => copyToClipboard(socialText)}
                  style={{ padding: '10px', borderRadius: 8, background: '#F3F4F6', color: '#374151', fontWeight: 700, fontSize: 12, border: '1px solid #D1D5DB', cursor: 'pointer' }}>
                  {copied ? '\u2705 Copied' : '\u{1F4CB} Copy'}
                </button>
              </div>

              {/* Certificate share (if certified) */}
              {certShareText && (
                <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Share your certificate achievement:</div>
                  <div style={{ background: '#FFFBF0', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 12 }}>
                    {certShareText}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => openShare('linkedin', certShareText)}
                      style={{ padding: '8px 16px', borderRadius: 7, background: '#0A66C2', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}>
                      Share Certificate on LinkedIn
                    </button>
                    <button onClick={() => copyToClipboard(certShareText)}
                      style={{ padding: '8px 16px', borderRadius: 7, background: '#F3F4F6', color: '#374151', fontWeight: 700, fontSize: 12, border: '1px solid #D1D5DB', cursor: 'pointer' }}>
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
