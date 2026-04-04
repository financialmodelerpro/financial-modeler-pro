'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from '@/src/components/layout/Navbar';
import HCaptcha from '@hcaptcha/react-hcaptcha';

type Mode = 'signin' | 'signup';

const NAVY  = '#0D2E5A';
const BLUE  = '#1B4F8A';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 14,
  border: '1.5px solid #D1D5DB', borderRadius: 7,
  outline: 'none', boxSizing: 'border-box',
  fontFamily: "'Inter', sans-serif",
  background: '#FFFBEB',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 700,
  color: '#374151', marginBottom: 6, letterSpacing: '0.03em',
};

function ModelingSignInInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl  = searchParams.get('callbackUrl') ?? '/modeling/dashboard';

  const [mode,     setMode]     = useState<Mode>(searchParams.get('tab') === 'signup' ? 'signup' : 'signin');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [phone,    setPhone]    = useState('');
  const [city,     setCity]     = useState('');
  const [country,  setCountry]  = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  // hCaptcha
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef<HCaptcha>(null);

  // Device verification (sign in)
  const [deviceStep,   setDeviceStep]   = useState<'credentials' | 'otp'>('credentials');
  const [deviceEmail,  setDeviceEmail]  = useState('');
  const [deviceOtp,    setDeviceOtp]    = useState('');
  const [trustChecked, setTrustChecked] = useState(false);
  const [deviceError,  setDeviceError]  = useState('');
  const [sendingOtp,   setSendingOtp]   = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  // Status banners from URL
  const confirmed  = searchParams.get('confirmed') === 'true';
  const errorParam = searchParams.get('error');
  const reason     = searchParams.get('reason');

  useEffect(() => { setError(''); setSuccess(''); setCaptchaToken(''); captchaRef.current?.resetCaptcha(); }, [mode]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);

    if (!result) { setError('Sign in failed. Please try again.'); return; }

    if (result.error === 'EmailNotConfirmed') {
      setError('Please confirm your email address before signing in. Check your inbox for the confirmation link.');
      return;
    }
    if (result.error === 'DEVICE_VERIFICATION_REQUIRED') {
      setDeviceEmail(email);
      await sendDeviceOtp(email);
      setDeviceStep('otp');
      return;
    }
    if (result.error) {
      setError('Invalid email or password. Please try again.');
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Full name is required.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (!captchaToken) { setError('Please complete the captcha.'); return; }
    setLoading(true); setError(''); setSuccess('');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, phone, city, country, captchaToken }),
    });
    const json = await res.json().catch(() => ({})) as { error?: string; message?: string };
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? 'Registration failed. Please try again.');
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
      return;
    }
    setSuccess(json.message ?? 'Account created! Please check your email and click the confirmation link to activate your account.');
    captchaRef.current?.resetCaptcha();
    setCaptchaToken('');
  };

  async function sendDeviceOtp(emailAddr: string) {
    setSendingOtp(true);
    await fetch('/api/auth/device-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', email: emailAddr }),
    }).catch(() => null);
    setSendingOtp(false);
  }

  async function handleDeviceVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceOtp.trim()) return;
    setVerifyingOtp(true);
    setDeviceError('');
    const res = await fetch('/api/auth/device-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', email: deviceEmail, code: deviceOtp.trim(), trustDevice: trustChecked }),
    });
    const json = await res.json() as { success: boolean; error?: string };
    if (!json.success) {
      setDeviceError(json.error ?? 'Invalid code. Please try again.');
      setVerifyingOtp(false);
      return;
    }
    // Device verified — now complete sign in (device is now trusted so it will pass)
    const result = await signIn('credentials', { email: deviceEmail, password, redirect: false });
    setVerifyingOtp(false);
    if (result?.error) { setDeviceError('Sign in failed. Please go back and try again.'); return; }
    router.push(callbackUrl);
    router.refresh();
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
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626' }}>❌ {deviceError}</div>
              )}

              <form onSubmit={handleDeviceVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>VERIFICATION CODE</label>
                  <input type="text" value={deviceOtp}
                    onChange={e => setDeviceOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456" maxLength={6} autoFocus
                    style={{ ...inputStyle, fontSize: 22, fontWeight: 700, textAlign: 'center', letterSpacing: '0.3em' }}
                    onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  <div style={{ marginTop: 6, fontSize: 11.5, color: '#9CA3AF' }}>Code expires in 10 minutes</div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 500 }}>
                  <input type="checkbox" checked={trustChecked} onChange={e => setTrustChecked(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  Trust this device for 30 days
                </label>

                <button type="submit" disabled={verifyingOtp || deviceOtp.length < 6}
                  style={{
                    width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                    background: (verifyingOtp || deviceOtp.length < 6) ? '#93C5FD' : BLUE,
                    color: '#fff', border: 'none', borderRadius: 8,
                    cursor: (verifyingOtp || deviceOtp.length < 6) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}>
                  {verifyingOtp ? (<><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Verifying…</>) : 'Verify & Sign In →'}
                </button>

                <button type="button" onClick={() => sendDeviceOtp(deviceEmail)} disabled={sendingOtp}
                  style={{ background: 'none', border: 'none', fontSize: 13, color: BLUE, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' }}>
                  {sendingOtp ? 'Sending…' : 'Resend code'}
                </button>

                <button type="button" onClick={() => { setDeviceStep('credentials'); setDeviceOtp(''); setDeviceError(''); }}
                  style={{ background: 'none', border: 'none', fontSize: 13, color: '#9CA3AF', cursor: 'pointer', padding: 0, textAlign: 'center' }}>
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

  return (
    <>
      <Navbar />
      <div style={{
        minHeight: 'calc(100vh - 64px)', background: '#F5F7FA',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '40px 20px',
        fontFamily: "'Inter', sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 460 }}>

          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: NAVY, padding: '28px 36px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📐</div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, marginBottom: 4 }}>Sign In to Modeling Hub</h1>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>Access your financial models and saved projects</p>
            </div>

            {/* Tab switcher */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #E5E7EB' }}>
              {(['signin', 'signup'] as Mode[]).map(m => (
                <button key={m} onClick={() => setMode(m)} style={{
                  padding: '12px', border: 'none',
                  background: mode === m ? '#fff' : '#F9FAFB',
                  color: mode === m ? BLUE : '#6B7280',
                  fontWeight: mode === m ? 700 : 500,
                  fontSize: 13, cursor: 'pointer',
                  borderBottom: mode === m ? `2px solid ${BLUE}` : '2px solid transparent',
                  fontFamily: "'Inter', sans-serif",
                }}>
                  {m === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>

            <div style={{ padding: '24px 36px 24px' }}>
              {/* Status banners */}
              {confirmed && (
                <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#15803D', fontWeight: 600 }}>
                  ✅ Email confirmed! You can now sign in.
                </div>
              )}
              {errorParam === 'invalid-token' && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626' }}>
                  ❌ This confirmation link is invalid or has expired. Please register again.
                </div>
              )}
              {reason === 'inactivity' && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#92400E' }}>
                  ⏰ You were signed out after 1 hour of inactivity.
                </div>
              )}

              {error   && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626' }}>{error}</div>}
              {success && <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#15803D' }}>{success}</div>}

              {mode === 'signin' ? (
                <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div>
                    <label style={labelStyle}>EMAIL ADDRESS</label>
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>PASSWORD</label>
                      <a href={`${process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com'}/forgot-password`} style={{ fontSize: 12, color: BLUE, textDecoration: 'none' }}>Forgot password?</a>
                    </div>
                    <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <button type="submit" disabled={loading} style={{
                    width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                    background: loading ? '#93C5FD' : BLUE, color: '#fff',
                    border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
                  }}>
                    {loading ? (<><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Signing in…</>) : 'Sign In →'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>FULL NAME <span style={{ color: '#DC2626' }}>*</span></label>
                    <input type="text" required value={name} onChange={e => setName(e.target.value)}
                      placeholder="Jane Smith" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div>
                    <label style={labelStyle}>EMAIL ADDRESS <span style={{ color: '#DC2626' }}>*</span></label>
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div>
                    <label style={labelStyle}>PHONE NUMBER <span style={{ color: '#DC2626' }}>*</span></label>
                    <input type="tel" required value={phone} onChange={e => setPhone(e.target.value)}
                      placeholder="+1 555 000 1234" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>CITY <span style={{ color: '#DC2626' }}>*</span></label>
                      <input type="text" required value={city} onChange={e => setCity(e.target.value)}
                        placeholder="New York" style={inputStyle}
                        onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                        onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                    </div>
                    <div>
                      <label style={labelStyle}>COUNTRY <span style={{ color: '#DC2626' }}>*</span></label>
                      <input type="text" required value={country} onChange={e => setCountry(e.target.value)}
                        placeholder="United States" style={inputStyle}
                        onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                        onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>PASSWORD <span style={{ color: '#9CA3AF', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(min 8 characters)</span></label>
                    <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div>
                    <label style={labelStyle}>CONFIRM PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
                    <input type="password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)}
                      placeholder="••••••••" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>

                  {/* hCaptcha */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <HCaptcha
                      sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? '10000000-ffff-ffff-ffff-000000000001'}
                      onVerify={(token) => setCaptchaToken(token)}
                      onExpire={() => setCaptchaToken('')}
                      ref={captchaRef}
                    />
                  </div>

                  <button type="submit" disabled={loading || !captchaToken} style={{
                    width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                    background: (loading || !captchaToken) ? '#93C5FD' : BLUE, color: '#fff',
                    border: 'none', borderRadius: 8, cursor: (loading || !captchaToken) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
                  }}>
                    {loading ? (<><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Creating…</>) : 'Create Account →'}
                  </button>
                  <p style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', margin: 0 }}>
                    Free plan · 3 projects included · No credit card required
                  </p>
                </form>
              )}
            </div>

            <div style={{ borderTop: '1px solid #F3F4F6', background: '#F9FAFB', padding: '12px 36px', textAlign: 'center', fontSize: 11.5, color: '#9CA3AF' }}>
              By continuing you agree to our Terms of Service and Privacy Policy.
            </div>
          </div>

          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
            <span style={{ fontSize: 11, color: '#D1D5DB', whiteSpace: 'nowrap' }}>separate from training hub</span>
            <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
          </div>
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              Training Hub?{' '}
              <a href={`${process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'}/training/signin`} style={{ color: '#9CA3AF', textDecoration: 'underline' }}>Sign In here →</a>
            </span>
          </div>

          <p style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: '#9CA3AF' }}>
            <a href="/" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Home</a>
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </>
  );
}

export default function ModelingSignInPage() {
  return (
    <Suspense>
      <ModelingSignInInner />
    </Suspense>
  );
}
