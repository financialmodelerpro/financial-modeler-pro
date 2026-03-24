'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { setTrainingSession } from '@/src/lib/training-session';

type Status = 'idle' | 'loading' | 'error';
type ResendStatus = 'idle' | 'loading' | 'sent' | 'error';

export default function TrainingLoginPage() {
  const router = useRouter();

  const [regId,  setRegId]  = useState('');
  const [email,  setEmail]  = useState('');
  const [status, setStatus] = useState<Status>('idle');

  // Forgot ID inline state
  const [showForgot,     setShowForgot]     = useState(false);
  const [forgotEmail,    setForgotEmail]    = useState('');
  const [resendStatus,   setResendStatus]   = useState<ResendStatus>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/training/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), registrationId: regId.trim() }),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        setTrainingSession(email.trim().toLowerCase(), regId.trim());
        router.push('/training/dashboard');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    setResendStatus('loading');
    try {
      const res = await fetch('/api/training/resend-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });
      const json = await res.json() as { success: boolean };
      setResendStatus(json.success ? 'sent' : 'error');
    } catch {
      setResendStatus('error');
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F5F7FA',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 20px',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Link href="/training" style={{ textDecoration: 'none' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: '#2EAA4A', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 18,
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
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', marginBottom: 28, textAlign: 'center' }}>
            Login to Your Dashboard
          </h1>

          {/* Error */}
          {status === 'error' && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 8, padding: '12px 14px', marginBottom: 18,
              fontSize: 13, color: '#DC2626', lineHeight: 1.5,
            }}>
              ❌ Registration ID or email not found. Please check your registration email.
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Registration ID */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, letterSpacing: '0.03em' }}>
                REGISTRATION ID <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <input
                type="text"
                required
                value={regId}
                onChange={e => setRegId(e.target.value)}
                placeholder="FMP-2026-XXXX"
                style={{
                  width: '100%', padding: '10px 12px', fontSize: 14,
                  border: '1.5px solid #D1D5DB', borderRadius: 7,
                  outline: 'none', boxSizing: 'border-box',
                  fontFamily: "'Inter', sans-serif",
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#2EAA4A'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
              />
              <div style={{ marginTop: 5, fontSize: 11.5, color: '#9CA3AF' }}>
                Check your registration confirmation email
              </div>
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
                  Logging in…
                </>
              ) : 'Login →'}
            </button>
          </form>

          {/* Forgot Registration ID */}
          <div style={{ marginTop: 20 }}>
            <button
              onClick={() => { setShowForgot(f => !f); setResendStatus('idle'); setForgotEmail(''); }}
              style={{
                background: 'none', border: 'none', padding: 0,
                fontSize: 13, color: '#2EAA4A', fontWeight: 600,
                cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              Forgot my Registration ID?
            </button>

            {showForgot && (
              <div style={{
                marginTop: 12, padding: '16px', background: '#F9FAFB',
                border: '1px solid #E5E7EB', borderRadius: 8,
              }}>
                {resendStatus === 'sent' ? (
                  <div style={{ fontSize: 13, color: '#15803D', fontWeight: 600 }}>
                    ✅ Your Registration ID has been sent to <strong>{forgotEmail}</strong>.
                  </div>
                ) : (
                  <form onSubmit={handleResend} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 5 }}>
                        YOUR EMAIL
                      </label>
                      <input
                        type="email"
                        required
                        value={forgotEmail}
                        onChange={e => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        style={{
                          width: '100%', padding: '9px 10px', fontSize: 13,
                          border: '1.5px solid #D1D5DB', borderRadius: 6,
                          outline: 'none', boxSizing: 'border-box',
                          fontFamily: "'Inter', sans-serif",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = '#2EAA4A'; }}
                        onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={resendStatus === 'loading'}
                      style={{
                        padding: '9px 14px', fontSize: 12, fontWeight: 700,
                        background: '#2EAA4A', color: '#fff',
                        border: 'none', borderRadius: 6, cursor: 'pointer',
                        whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {resendStatus === 'loading' ? '…' : 'Send My ID'}
                    </button>
                  </form>
                )}
                {resendStatus === 'error' && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626' }}>
                    Could not find that email. <Link href="/training/register" style={{ color: '#DC2626', fontWeight: 700 }}>Register here →</Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom links */}
          <div style={{ marginTop: 22, textAlign: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 18 }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              Not registered yet?{' '}
              <Link href="/training/register" style={{ color: '#2EAA4A', fontWeight: 700, textDecoration: 'none' }}>
                Register Free →
              </Link>
            </span>
          </div>

          {/* Platform separator */}
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: '#F3F4F6' }} />
            <span style={{ fontSize: 11, color: '#D1D5DB', whiteSpace: 'nowrap' }}>separate from platform</span>
            <div style={{ flex: 1, height: 1, background: '#F3F4F6' }} />
          </div>
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              This is separate from your platform account.{' '}
              <Link href="/login" style={{ color: '#9CA3AF', textDecoration: 'underline' }}>
                Platform login →
              </Link>
            </span>
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#9CA3AF' }}>
          <Link href="/training" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Training Hub</Link>
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
