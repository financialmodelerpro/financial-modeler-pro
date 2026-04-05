'use client';

import { useState } from 'react';
import Link from 'next/link';

type Status = 'idle' | 'loading' | 'success' | 'not_found' | 'error';

export default function TrainingForgotPage() {
  const [email,  setEmail]  = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/training/resend-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = await res.json() as { success: boolean; notFound?: boolean };
      if (json.success) {
        setStatus('success');
      } else if (json.notFound) {
        setStatus('not_found');
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
      <div style={{ width: '100%', maxWidth: 420 }}>

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
            Training Hub
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: 14,
          border: '1px solid #E5E7EB',
          boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
          padding: '36px 36px 32px',
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', marginBottom: 8, textAlign: 'center' }}>
            Recover Your Registration ID
          </h1>
          <p style={{ fontSize: 13.5, color: '#6B7280', textAlign: 'center', marginBottom: 28, lineHeight: 1.55 }}>
            Enter your registration email and we will send your Registration ID.
          </p>

          {/* Success */}
          {status === 'success' && (
            <div style={{
              background: '#F0FFF4', border: '1px solid #BBF7D0',
              borderRadius: 8, padding: '16px 18px', marginBottom: 4,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D', marginBottom: 6 }}>
                ✅ Registration ID sent!
              </div>
              <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.5, marginBottom: 14 }}>
                Your Registration ID has been sent to <strong>{email}</strong>.
              </div>
              <Link href="/signin" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: '#2EAA4A', color: '#fff',
                fontSize: 13, fontWeight: 700, padding: '9px 20px',
                borderRadius: 7, textDecoration: 'none',
              }}>
                Login Now →
              </Link>
            </div>
          )}

          {/* Not found */}
          {status === 'not_found' && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 8, padding: '14px 16px', marginBottom: 20,
              fontSize: 13, color: '#DC2626', lineHeight: 1.5,
            }}>
              ❌ No account found with that email.{' '}
              <Link href="/register" style={{ color: '#DC2626', fontWeight: 700, textDecoration: 'underline' }}>
                Register here →
              </Link>
            </div>
          )}

          {/* Generic error */}
          {status === 'error' && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 8, padding: '14px 16px', marginBottom: 20,
              fontSize: 13, color: '#DC2626', lineHeight: 1.5,
            }}>
              ❌ Something went wrong. Please try again.
            </div>
          )}

          {status !== 'success' && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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

              <button
                type="submit"
                disabled={status === 'loading'}
                style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                  background: status === 'loading' ? '#86EFAC' : '#2EAA4A',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {status === 'loading' ? (
                  <>
                    <span style={{
                      width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)',
                      borderTopColor: '#fff', borderRadius: '50%',
                      display: 'inline-block', animation: 'spin 0.7s linear infinite',
                    }} />
                    Sending…
                  </>
                ) : 'Send My ID →'}
              </button>
            </form>
          )}

          {/* Back to login */}
          <div style={{ marginTop: 24, textAlign: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 20 }}>
            <Link href="/signin" style={{ fontSize: 13, color: '#2EAA4A', fontWeight: 600, textDecoration: 'none' }}>
              ← Back to Login
            </Link>
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
