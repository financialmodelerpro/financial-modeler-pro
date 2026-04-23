'use client';

import React, { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const NAVY      = '#0D2E5A';
const NAVY_DEEP = '#1F3864';
const GOLD      = '#C9A84C';
const GOLD_HOVER = '#B8962E';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 14,
  border: '1.5px solid #D1D5DB', borderRadius: 7,
  outline: 'none', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif", background: '#fff',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 700,
  color: '#374151', marginBottom: 6, letterSpacing: '0.03em',
};

/**
 * Single-page admin login flow. Renders directly at /admin for any
 * unauthenticated visitor (FIX 1, 2026-04-23 - removed the 4-step
 * welcome / intermediate / login / form chain that previously sat
 * in front of the credential form). After credentials succeed, an
 * unrecognised device triggers the OTP step (FIX 2 - admins now go
 * through the same trusted-device flow as students; previously the
 * admin role bypassed it entirely in auth.ts).
 */
function AdminLoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  // callbackUrl can come from NextAuth (when middleware redirected an
  // unauthenticated admin away from a protected /admin/* route). Sanitize
  // so we never bounce back to the auth pages themselves.
  const rawCallback  = searchParams.get('callbackUrl') ?? '/admin/dashboard';
  const callbackUrl  = (rawCallback.startsWith('/admin/login') || rawCallback === '/admin' || rawCallback.startsWith('/login'))
    ? '/admin/dashboard'
    : rawCallback;

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Device-verification state (mirrors the Training Hub OTP flow that
  // already worked for students; admins now share the same UX).
  const [deviceStep,   setDeviceStep]   = useState<'credentials' | 'otp'>('credentials');
  const [deviceEmail,  setDeviceEmail]  = useState('');
  const [deviceOtp,    setDeviceOtp]    = useState('');
  const [trustChecked, setTrustChecked] = useState(true);
  const [sendingOtp,   setSendingOtp]   = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [deviceError,  setDeviceError]  = useState('');

  async function sendDeviceOtp(toEmail: string) {
    setSendingOtp(true);
    setDeviceError('');
    try {
      await fetch('/api/auth/device-verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'send', email: toEmail }),
      });
    } catch { /* non-fatal */ }
    setSendingOtp(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const result = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });
    setLoading(false);

    if (!result?.error) {
      router.push(callbackUrl);
      router.refresh();
      return;
    }

    if (result.error === 'DEVICE_VERIFICATION_REQUIRED') {
      const cleanEmail = email.trim().toLowerCase();
      setDeviceEmail(cleanEmail);
      await sendDeviceOtp(cleanEmail);
      setDeviceStep('otp');
      return;
    }

    setErrorMsg('Invalid email or password. Please try again.');
  }

  async function handleDeviceVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceOtp.trim()) return;
    setVerifyingOtp(true);
    setDeviceError('');
    try {
      const res  = await fetch('/api/auth/device-verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:      'check',
          email:       deviceEmail,
          code:        deviceOtp.trim(),
          trustDevice: trustChecked,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        setDeviceError(json.error ?? 'Invalid code. Please try again.');
        setVerifyingOtp(false);
        return;
      }

      // Device is now trusted - retry signIn (the trust cookie is set
      // by the verify response so authorize() will accept this attempt).
      const result = await signIn('credentials', {
        email:    deviceEmail,
        password,
        redirect: false,
      });

      if (!result?.error) {
        router.push(callbackUrl);
        router.refresh();
        return;
      }
      setDeviceError('Sign in failed after verification. Please try again.');
    } catch {
      setDeviceError('Verification failed. Please try again.');
    }
    setVerifyingOtp(false);
  }

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: `linear-gradient(160deg, ${NAVY_DEEP} 0%, ${NAVY} 60%, #0A1F3D 100%)`,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: "'Inter', sans-serif",
  };

  const cardStyle: React.CSSProperties = {
    width: '100%', maxWidth: 460,
    background: '#fff', borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    overflow: 'hidden',
  };

  // ── Device OTP step ─────────────────────────────────────────────────────
  if (deviceStep === 'otp') {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ height: 4, background: `linear-gradient(90deg, ${GOLD}, ${GOLD_HOVER})` }} />
          <div style={{ padding: '36px 36px 32px' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: 0, marginBottom: 6 }}>New Device Detected</h1>
              <p style={{ fontSize: 13, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
                We sent a verification code to <strong>{deviceEmail}</strong>.<br />Enter it below to continue.
              </p>
            </div>

            {deviceError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626' }}>
                ❌ {deviceError}
              </div>
            )}

            <form onSubmit={handleDeviceVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle}>VERIFICATION CODE</label>
                <input
                  type="text"
                  value={deviceOtp}
                  onChange={e => setDeviceOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  maxLength={6}
                  autoFocus
                  style={{ ...inputStyle, fontSize: 22, fontWeight: 700, textAlign: 'center', letterSpacing: '0.3em' }}
                  onFocus={e => { e.currentTarget.style.borderColor = GOLD; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                />
                <div style={{ marginTop: 6, fontSize: 11.5, color: '#9CA3AF' }}>Code expires in 10 minutes</div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={trustChecked}
                  onChange={e => setTrustChecked(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                Trust this device for 30 days
              </label>

              <button type="submit" disabled={verifyingOtp || deviceOtp.length < 6}
                style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                  background: (verifyingOtp || deviceOtp.length < 6) ? '#E5C87A' : `linear-gradient(135deg, ${GOLD}, ${GOLD_HOVER})`,
                  color: '#1A1A1A', border: 'none', borderRadius: 8,
                  cursor: (verifyingOtp || deviceOtp.length < 6) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {verifyingOtp
                  ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#1A1A1A', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Verifying…</>
                  : 'Verify & Sign In →'}
              </button>

              <button type="button" onClick={() => sendDeviceOtp(deviceEmail)} disabled={sendingOtp}
                style={{ background: 'none', border: 'none', fontSize: 13, color: GOLD_HOVER, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' }}>
                {sendingOtp ? 'Sending…' : 'Resend code'}
              </button>

              <button type="button"
                onClick={() => { setDeviceStep('credentials'); setDeviceOtp(''); setDeviceError(''); }}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#9CA3AF', cursor: 'pointer', padding: 0, textAlign: 'center' }}>
                ← Back to sign in
              </button>
            </form>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Credentials step ───────────────────────────────────────────────────
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${GOLD}, ${GOLD_HOVER})` }} />
        <div style={{ padding: '36px 36px 32px' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 52, height: 52, borderRadius: 12, background: NAVY_DEEP,
              boxShadow: '0 4px 16px rgba(13,46,90,0.3)', marginBottom: 14,
            }}>
              <span style={{ fontSize: 24 }}>🏢</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD_HOVER, marginBottom: 4 }}>
              Admin Panel
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0 }}>Sign In</h1>
          </div>

          {errorMsg && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
              ❌ {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={labelStyle}>EMAIL ADDRESS <span style={{ color: '#DC2626' }}>*</span></label>
              <input
                type="email" required autoComplete="email" autoFocus
                value={email}
                onChange={e => { setEmail(e.target.value); setErrorMsg(''); }}
                placeholder="admin@financialmodelerpro.com"
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = GOLD; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
                <Link href="/forgot-password" style={{ fontSize: 12, color: NAVY, fontWeight: 600, textDecoration: 'none', opacity: 0.7 }}>
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setErrorMsg(''); }}
                  placeholder="••••••••"
                  style={{ ...inputStyle, paddingRight: 42 }}
                  onFocus={e => { e.currentTarget.style.borderColor = GOLD; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                />
                <button type="button" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#9CA3AF' }}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              style={{
                width: '100%', padding: '13px', fontSize: 14, fontWeight: 700, marginTop: 4,
                background: loading ? '#E5C87A' : `linear-gradient(135deg, ${GOLD}, ${GOLD_HOVER})`,
                color: '#1A1A1A', border: 'none', borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: loading ? 'none' : '0 4px 14px rgba(201,168,76,0.3)',
              }}
            >
              {loading
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(0,0,0,0.2)', borderTopColor: '#1A1A1A', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Signing in…</>
                : 'Sign In to Admin Panel →'}
            </button>
          </form>

          <p style={{ marginTop: 24, fontSize: 12, textAlign: 'center' }}>
            <Link href="/" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Main Site</Link>
          </p>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function AdminLoginClient() {
  return (
    <Suspense>
      <AdminLoginInner />
    </Suspense>
  );
}
