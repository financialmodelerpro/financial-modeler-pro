'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { setTrainingSession } from '@/src/lib/training/training-session';
import { Navbar } from '@/src/components/layout/Navbar';

const GREEN = '#2EAA4A';
const NAVY  = '#0D2E5A';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 14,
  border: '1.5px solid #D1D5DB', borderRadius: 7,
  outline: 'none', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 700,
  color: '#374151', marginBottom: 6, letterSpacing: '0.03em',
};

type ResendStatus = 'idle' | 'loading' | 'sent' | 'error';

function TrainingSignInInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const confirmed    = searchParams.get('confirmed') === 'true';
  const reason       = searchParams.get('reason');
  const urlError     = searchParams.get('error');

  const [identifier,  setIdentifier]  = useState('');
  const [secondField, setSecondField] = useState('');
  const [password,    setPassword]    = useState('');
  const [loading,     setLoading]     = useState(false);
  const [errorMsg,    setErrorMsg]    = useState('');

  const [needsBoth,   setNeedsBoth]   = useState(false);
  const [provideType, setProvideType] = useState<'email' | 'registrationId'>('email');

  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupEmail, setSetupEmail] = useState('');
  const [setupRegId, setSetupRegId] = useState('');

  const [showForgot,   setShowForgot]   = useState(false);
  const [forgotEmail,  setForgotEmail]  = useState('');
  const [resendStatus, setResendStatus] = useState<ResendStatus>('idle');

  // Resend confirmation email
  const [emailNotConfirmed,    setEmailNotConfirmed]    = useState(false);
  const [resendConfirmEmail,   setResendConfirmEmail]   = useState('');
  const [resendConfirmStatus,  setResendConfirmStatus]  = useState<ResendStatus>('idle');

  const [showPw, setShowPw] = useState(false);

  // Device verification
  const [deviceStep,    setDeviceStep]    = useState<'credentials' | 'otp'>('credentials');
  const [deviceEmail,   setDeviceEmail]   = useState('');
  const [deviceRegId,   setDeviceRegId]   = useState('');
  const [deviceOtp,     setDeviceOtp]     = useState('');
  const [trustChecked,  setTrustChecked]  = useState(false);
  const [sendingDevOtp, setSendingDevOtp] = useState(false);
  const [verifyingDev,  setVerifyingDev]  = useState(false);
  const [deviceError,   setDeviceError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) { setErrorMsg('Password is required.'); return; }
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/training/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          ...(needsBoth && secondField ? { secondField: secondField.trim() } : {}),
        }),
      });
      const json = await res.json() as {
        success: boolean;
        error?: string;
        needsBoth?: boolean;
        provide?: 'email' | 'registrationId';
        needsPasswordSetup?: boolean;
        requiresDeviceVerification?: boolean;
        emailNotConfirmed?: boolean;
        email?: string;
        registrationId?: string;
      };

      if (json.success && json.email && json.registrationId) {
        setTrainingSession(json.email, json.registrationId);
        router.push('/training/dashboard');
        return;
      }

      if (json.emailNotConfirmed) {
        setEmailNotConfirmed(true);
        setResendConfirmEmail(json.email ?? identifier.trim().toLowerCase());
        setResendConfirmStatus('idle');
        setErrorMsg(json.error ?? 'Please confirm your email address before signing in.');
        setLoading(false);
        return;
      }

      if (json.requiresDeviceVerification && json.email && json.registrationId) {
        setDeviceEmail(json.email);
        setDeviceRegId(json.registrationId);
        await sendDeviceOtp(json.email);
        setDeviceStep('otp');
        setLoading(false);
        return;
      }

      if (json.needsBoth) {
        setNeedsBoth(true);
        setProvideType(json.provide ?? 'email');
        setErrorMsg(json.error ?? 'Please provide the additional field below.');
        setLoading(false);
        return;
      }

      if (json.needsPasswordSetup) {
        setNeedsSetup(true);
        setSetupEmail(json.email ?? '');
        setSetupRegId(json.registrationId ?? '');
        setLoading(false);
        return;
      }

      setErrorMsg(json.error ?? 'Sign in failed. Please check your details.');
    } catch {
      setErrorMsg('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirm() {
    setResendConfirmStatus('loading');
    try {
      await fetch('/api/training/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendConfirmEmail }),
      });
      setResendConfirmStatus('sent');
    } catch {
      setResendConfirmStatus('error');
    }
  }

  async function sendDeviceOtp(email: string) {
    setSendingDevOtp(true);
    setDeviceError('');
    try {
      await fetch('/api/training/device-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', email }),
      });
    } catch { /* non-fatal */ }
    setSendingDevOtp(false);
  }

  async function handleDeviceVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceOtp.trim()) return;
    setVerifyingDev(true);
    setDeviceError('');
    try {
      const res = await fetch('/api/training/device-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check',
          email: deviceEmail,
          registrationId: deviceRegId,
          code: deviceOtp.trim(),
          trustDevice: trustChecked,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        setDeviceError(json.error ?? 'Invalid code. Please try again.');
        setVerifyingDev(false);
        return;
      }
      // Device verified — set session and redirect
      setTrainingSession(deviceEmail, deviceRegId);

      // Also set the httpOnly session cookie via validate (with device now trusted)
      // Re-call validate so server sets its cookie — device is now trusted
      router.push('/training/dashboard');
    } catch {
      setDeviceError('Verification failed. Please try again.');
    }
    setVerifyingDev(false);
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
    } catch { setResendStatus('error'); }
  }

  // ── Device verification step ──────────────────────────────────────────────
  if (deviceStep === 'otp') {
    return (
      <>
        <Navbar />
        <div style={{ minHeight: 'calc(100vh - 64px)', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
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

                {/* Trust device */}
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
                  disabled={verifyingDev || deviceOtp.length < 6}
                  style={{
                    width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                    background: (verifyingDev || deviceOtp.length < 6) ? '#86EFAC' : GREEN,
                    color: '#fff', border: 'none', borderRadius: 8,
                    cursor: (verifyingDev || deviceOtp.length < 6) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {verifyingDev ? (<><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Verifying…</>) : 'Verify & Sign In →'}
                </button>

                <button
                  type="button"
                  onClick={() => sendDeviceOtp(deviceEmail)}
                  disabled={sendingDevOtp}
                  style={{ background: 'none', border: 'none', fontSize: 13, color: GREEN, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' }}
                >
                  {sendingDevOtp ? 'Sending…' : 'Resend code'}
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
      </>
    );
  }

  const identifierLabel = identifier.includes('@') ? 'EMAIL ADDRESS' : (identifier.match(/^FMP-/i) ? 'REGISTRATION ID' : 'REGISTRATION ID OR EMAIL');

  return (
    <>
      <Navbar />
      <div style={{
        minHeight: 'calc(100vh - 64px)', background: '#F5F7FA',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '40px 20px',
        fontFamily: "'Inter', sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>

          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: '36px 36px 32px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎓</div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, marginBottom: 4 }}>Sign In to Training Hub</h1>
              <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>Continue your certification journey</p>
            </div>

            {/* Status banners */}
            {confirmed && (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#15803D', fontWeight: 600 }}>
                ✅ Email confirmed! You can now sign in.
              </div>
            )}
            {urlError === 'link-expired' && (
              <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#92400E' }}>
                ⚠️ Your confirmation link has expired or already been used. Please sign in and request a new one below.
              </div>
            )}
            {reason === 'inactivity' && (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#92400E' }}>
                ⏰ You were signed out after 1 hour of inactivity.
              </div>
            )}

            {needsSetup ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: NAVY, marginBottom: 8 }}>No password set yet</h2>
                <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, marginBottom: 20 }}>
                  Your account doesn&apos;t have a password yet. Set one up to continue.
                </p>
                <Link
                  href={`/training/set-password?regId=${encodeURIComponent(setupRegId)}&email=${encodeURIComponent(setupEmail)}`}
                  style={{ display: 'inline-block', padding: '11px 24px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}
                >
                  Set Up My Password →
                </Link>
                <div style={{ marginTop: 16 }}>
                  <button onClick={() => { setNeedsSetup(false); setErrorMsg(''); }} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
                    ← Back
                  </button>
                </div>
              </div>
            ) : (
              <>
                {errorMsg && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
                      ❌ {errorMsg}
                    </div>
                    {emailNotConfirmed && (
                      <div style={{ marginTop: 8, textAlign: 'center' }}>
                        {resendConfirmStatus === 'sent' ? (
                          <span style={{ fontSize: 12, color: '#15803D', fontWeight: 600 }}>✅ Confirmation email sent — check your inbox.</span>
                        ) : resendConfirmStatus === 'error' ? (
                          <span style={{ fontSize: 12, color: '#DC2626' }}>Failed to send. Please try again.</span>
                        ) : (
                          <button type="button" onClick={handleResendConfirm} disabled={resendConfirmStatus === 'loading'}
                            style={{ background: 'none', border: 'none', fontSize: 12, color: GREEN, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                            {resendConfirmStatus === 'loading' ? 'Sending…' : 'Resend confirmation email →'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

                  <div>
                    <label style={labelStyle}>REGISTRATION ID OR EMAIL <span style={{ color: '#DC2626' }}>*</span></label>
                    <input
                      type="text" required autoComplete="username"
                      value={identifier}
                      onChange={e => { setIdentifier(e.target.value); setNeedsBoth(false); setErrorMsg(''); setEmailNotConfirmed(false); }}
                      placeholder="FMP-2026-XXXX or you@example.com"
                      style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                    />
                    <div style={{ marginTop: 5, fontSize: 11.5, color: '#9CA3AF' }}>
                      Use either your Registration ID or email address
                    </div>
                  </div>

                  {needsBoth && (
                    <div>
                      <label style={labelStyle}>
                        {provideType === 'email' ? 'EMAIL ADDRESS' : 'REGISTRATION ID'}{' '}
                        <span style={{ color: '#DC2626' }}>*</span>
                      </label>
                      <input
                        type={provideType === 'email' ? 'email' : 'text'}
                        required autoFocus
                        value={secondField}
                        onChange={e => setSecondField(e.target.value)}
                        placeholder={provideType === 'email' ? 'you@example.com' : 'FMP-2026-XXXX'}
                        style={inputStyle}
                        onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                        onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                      />
                      <div style={{ marginTop: 5, fontSize: 11.5, color: '#6B7280' }}>
                        We couldn&apos;t find your account with just {identifierLabel.toLowerCase()}. Please also provide your {provideType === 'email' ? 'email' : 'Registration ID'}.
                      </div>
                    </div>
                  )}

                  <div>
                    <label style={labelStyle}>PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPw ? 'text' : 'password'}
                        required autoComplete="current-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        style={{ ...inputStyle, paddingRight: 42 }}
                        onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                        onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                      />
                      <button type="button" onClick={() => setShowPw(v => !v)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#9CA3AF' }}>
                        {showPw ? '🙈' : '👁'}
                      </button>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                      <Link href="/training/set-password" style={{ fontSize: 12, color: GREEN, fontWeight: 600, textDecoration: 'none' }}>Forgot password?</Link>
                    </div>
                  </div>

                  <button type="submit" disabled={loading}
                    style={{
                      width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                      background: loading ? '#86EFAC' : GREEN,
                      color: '#fff', border: 'none', borderRadius: 8,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
                    }}
                  >
                    {loading ? (<><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Signing in…</>) : 'Sign In →'}
                  </button>
                </form>

                {/* Forgot Registration ID */}
                <div style={{ marginTop: 20 }}>
                  <button
                    onClick={() => { setShowForgot(f => !f); setResendStatus('idle'); setForgotEmail(''); }}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: GREEN, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Forgot my Registration ID?
                  </button>
                  {showForgot && (
                    <div style={{ marginTop: 12, padding: '16px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                      {resendStatus === 'sent' ? (
                        <div style={{ fontSize: 13, color: '#15803D', fontWeight: 600 }}>
                          ✅ Your Registration ID has been sent to <strong>{forgotEmail}</strong>.
                        </div>
                      ) : (
                        <form onSubmit={handleResend} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 5 }}>YOUR EMAIL</label>
                            <input type="email" required value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@example.com"
                              style={{ width: '100%', padding: '9px 10px', fontSize: 13, border: '1.5px solid #D1D5DB', borderRadius: 6, outline: 'none', boxSizing: 'border-box', fontFamily: "'Inter', sans-serif" }}
                              onFocus={e => { e.currentTarget.style.borderColor = GREEN; }} onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                          </div>
                          <button type="submit" disabled={resendStatus === 'loading'}
                            style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700, background: GREEN, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {resendStatus === 'loading' ? '…' : 'Send My ID'}
                          </button>
                        </form>
                      )}
                      {resendStatus === 'error' && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#DC2626' }}>
                          Could not find that email.{' '}
                          <Link href="/register" style={{ color: '#DC2626', fontWeight: 700 }}>Register here →</Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {!needsSetup && (
              <div style={{ marginTop: 22, textAlign: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 18 }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>
                  Not registered yet?{' '}
                  <Link href="/register" style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Register Free →</Link>
                </span>
                <div style={{ marginTop: 10 }}>
                  <Link href="/training/set-password" style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'underline' }}>
                    First time signing in? Set up your password →
                  </Link>
                </div>
              </div>
            )}

            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: '#F3F4F6' }} />
              <span style={{ fontSize: 11, color: '#D1D5DB', whiteSpace: 'nowrap' }}>separate from platform</span>
              <div style={{ flex: 1, height: 1, background: '#F3F4F6' }} />
            </div>
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <a href={`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com'}/modeling/signin`} style={{ fontSize: 12, color: '#9CA3AF', textDecoration: 'underline' }}>Modeling Hub Sign In →</a>
            </div>
          </div>

          <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#9CA3AF' }}>
            <Link href="/training" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Training Hub</Link>
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </>
  );
}

export default function TrainingSignInPage() {
  return (
    <Suspense>
      <TrainingSignInInner />
    </Suspense>
  );
}
