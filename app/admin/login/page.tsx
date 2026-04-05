'use client';

import React, { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const NAVY  = '#0D2E5A';
const GREEN = '#2EAA4A';

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

type ResendStatus = 'idle' | 'loading' | 'sent' | 'error';

function LoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const rawCallback  = searchParams.get('callbackUrl') ?? '/admin';
  // Sanitize: never redirect back to the login page itself — breaks infinite loop
  const callbackUrl  = rawCallback.startsWith('/admin/login') ? '/admin' : rawCallback;

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Email not confirmed state
  const [emailNotConfirmed,   setEmailNotConfirmed]   = useState(false);
  const [resendStatus,        setResendStatus]        = useState<ResendStatus>('idle');

  // Device verification state
  const [deviceStep,    setDeviceStep]    = useState<'credentials' | 'otp'>('credentials');
  const [deviceEmail,   setDeviceEmail]   = useState('');
  const [deviceOtp,     setDeviceOtp]     = useState('');
  const [trustChecked,  setTrustChecked]  = useState(true);
  const [sendingOtp,    setSendingOtp]    = useState(false);
  const [verifyingOtp,  setVerifyingOtp]  = useState(false);
  const [deviceError,   setDeviceError]   = useState('');

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
    setEmailNotConfirmed(false);

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
      setDeviceEmail(email.trim().toLowerCase());
      await sendDeviceOtp(email.trim().toLowerCase());
      setDeviceStep('otp');
      return;
    }

    if (result.error === 'EmailNotConfirmed') {
      setEmailNotConfirmed(true);
      setErrorMsg('Your email address has not been confirmed yet.');
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

      // Device is now trusted — retry signIn
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

  async function handleResendConfirmation() {
    setResendStatus('loading');
    try {
      await fetch('/api/auth/resend-confirmation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setResendStatus('sent');
    } catch {
      setResendStatus('error');
    }
  }

  // ── Device verification step ───────────────────────────────────────────────
  if (deviceStep === 'otp') {
    return (
      <div style={{
        minHeight: '100vh', background: '#F5F7FA',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '40px 20px',
        fontFamily: "'Inter', sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: '36px 36px 32px' }}>
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
                  onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
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

              <button
                type="submit"
                disabled={verifyingOtp || deviceOtp.length < 6}
                style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                  background: (verifyingOtp || deviceOtp.length < 6) ? '#86EFAC' : GREEN,
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (verifyingOtp || deviceOtp.length < 6) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {verifyingOtp
                  ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Verifying…</>
                  : 'Verify & Sign In →'}
              </button>

              <button
                type="button"
                onClick={() => sendDeviceOtp(deviceEmail)}
                disabled={sendingOtp}
                style={{ background: 'none', border: 'none', fontSize: 13, color: GREEN, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' }}
              >
                {sendingOtp ? 'Sending…' : 'Resend code'}
              </button>

              <button
                type="button"
                onClick={() => { setDeviceStep('credentials'); setDeviceOtp(''); setDeviceError(''); }}
                style={{ background: 'none', border: 'none', fontSize: 13, color: '#9CA3AF', cursor: 'pointer', padding: 0, textAlign: 'center' }}
              >
                ← Back to sign in
              </button>
            </form>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Sign-in step ──────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', background: '#F5F7FA',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 20px',
      fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: '36px 36px 32px' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12, background: NAVY,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, margin: '0 auto 14px', boxShadow: '0 4px 16px rgba(13,46,90,0.3)',
            }}>🏢</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, marginBottom: 4 }}>
              Admin Sign In
            </h1>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>Financial Modeler Pro · Admin Panel</p>
          </div>

          {/* Error banner */}
          {errorMsg && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
              ❌ {errorMsg}
              {emailNotConfirmed && (
                <div style={{ marginTop: 8 }}>
                  {resendStatus === 'sent'
                    ? <span style={{ color: '#15803D', fontWeight: 600 }}>✅ Confirmation email sent — check your inbox.</span>
                    : resendStatus === 'error'
                    ? <span>Failed to send. Please try again.</span>
                    : (
                      <button type="button" onClick={handleResendConfirmation} disabled={resendStatus === 'loading'}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: GREEN, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                        {resendStatus === 'loading' ? 'Sending…' : 'Resend confirmation email →'}
                      </button>
                    )}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            <div>
              <label style={labelStyle}>EMAIL ADDRESS <span style={{ color: '#DC2626' }}>*</span></label>
              <input
                type="email" required autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setErrorMsg(''); setEmailNotConfirmed(false); }}
                placeholder="admin@financialmodelerpro.com"
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = NAVY; }}
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
                  onFocus={e => { e.currentTarget.style.borderColor = NAVY; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#9CA3AF' }}>
                  {showPw ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                background: loading ? '#6B92C4' : NAVY,
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
              }}
            >
              {loading
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Signing in…</>
                : 'Sign In to Admin Panel →'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#9CA3AF' }}>
          <Link href="/" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Main Site</Link>
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
