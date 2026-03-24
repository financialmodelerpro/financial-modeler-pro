'use client';

import { useState } from 'react';
import Link from 'next/link';

type Status = 'idle' | 'loading' | 'success' | 'duplicate' | 'error';

export default function TrainingRegisterPage() {
  const [name,    setName]   = useState('');
  const [email,   setEmail]  = useState('');
  const [course,  setCourse] = useState('3sfm');
  const [status,  setStatus] = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/training/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), course }),
      });
      const json = await res.json() as { success: boolean; duplicate?: boolean };
      if (json.success) {
        setStatus('success');
      } else if (json.duplicate) {
        setStatus('duplicate');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F5F7FA',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 20px',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Link href="/training" style={{ textDecoration: 'none' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: '#2EAA4A', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 18,
              }}>🎓</div>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>
                Financial Modeler Pro
              </span>
            </div>
          </Link>
          <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Training Academy
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: 14,
          border: '1px solid #E5E7EB',
          boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
          padding: '36px 36px 32px',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', marginBottom: 6, textAlign: 'center' }}>
            Register for Free Certification
          </h1>
          <p style={{ fontSize: 12.5, color: '#6B7280', textAlign: 'center', marginBottom: 28, lineHeight: 1.5 }}>
            Your name will appear exactly as entered on your certificate.
          </p>

          {/* Success */}
          {status === 'success' && (
            <div style={{
              background: '#F0FFF4', border: '1px solid #BBF7D0',
              borderRadius: 8, padding: '16px 18px', marginBottom: 20,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D', marginBottom: 6 }}>
                ✅ Registration successful!
              </div>
              <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.5, marginBottom: 14 }}>
                Your Registration ID has been sent to <strong>{email}</strong>. Check your inbox then login.
              </div>
              <Link href="/training/login" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#2EAA4A', color: '#fff',
                fontSize: 13, fontWeight: 700, padding: '9px 20px',
                borderRadius: 7, textDecoration: 'none',
              }}>
                Login Now →
              </Link>
            </div>
          )}

          {/* Duplicate */}
          {status === 'duplicate' && (
            <div style={{
              background: '#EFF6FF', border: '1px solid #BFDBFE',
              borderRadius: 8, padding: '14px 16px', marginBottom: 20,
              fontSize: 13, color: '#1D4ED8', lineHeight: 1.5,
            }}>
              ℹ️ You are already registered. Your Registration ID has been resent to <strong>{email}</strong>.
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 8, padding: '14px 16px', marginBottom: 20,
              fontSize: 13, color: '#DC2626', lineHeight: 1.5,
            }}>
              ❌ Registration failed. Please try again.
            </div>
          )}

          {status !== 'success' && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Full Name */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, letterSpacing: '0.03em' }}>
                  FULL NAME <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ahmad Din"
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 14,
                    border: '1.5px solid #D1D5DB', borderRadius: 7,
                    outline: 'none', boxSizing: 'border-box',
                    fontFamily: "'Inter', sans-serif",
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#2EAA4A'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                />
              </div>

              {/* Email */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, letterSpacing: '0.03em' }}>
                  EMAIL ADDRESS <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 14,
                    border: '1.5px solid #D1D5DB', borderRadius: 7,
                    outline: 'none', boxSizing: 'border-box',
                    fontFamily: "'Inter', sans-serif",
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#2EAA4A'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                />
              </div>

              {/* Course */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, letterSpacing: '0.03em' }}>
                  COURSE <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <select
                  required
                  value={course}
                  onChange={e => setCourse(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 14,
                    border: '1.5px solid #D1D5DB', borderRadius: 7,
                    outline: 'none', boxSizing: 'border-box',
                    fontFamily: "'Inter', sans-serif",
                    background: '#fff', cursor: 'pointer',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#2EAA4A'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                >
                  <option value="3sfm">3-Statement Financial Modeling</option>
                  <option value="bvm">Business Valuation Methods</option>
                  <option value="both">Both Courses</option>
                </select>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={status === 'loading'}
                style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                  background: status === 'loading' ? '#86EFAC' : '#2EAA4A',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'background 0.15s',
                  marginTop: 4,
                }}
              >
                {status === 'loading' ? (
                  <>
                    <span style={{
                      width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)',
                      borderTopColor: '#fff', borderRadius: '50%',
                      display: 'inline-block', animation: 'spin 0.7s linear infinite',
                    }} />
                    Registering…
                  </>
                ) : 'Register →'}
              </button>
            </form>
          )}

          {/* Bottom link */}
          <div style={{ marginTop: 24, textAlign: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 20 }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              Already have a Registration ID?{' '}
              <Link href="/training/login" style={{ color: '#2EAA4A', fontWeight: 700, textDecoration: 'none' }}>
                Login →
              </Link>
            </span>
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#9CA3AF' }}>
          <Link href="/training" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Training Hub</Link>
        </p>
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
