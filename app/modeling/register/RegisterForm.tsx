'use client';

// Dedicated register page served at app.financialmodelerpro.com/register.
// We cannot export ModelingSignInInner from the signin page file (Next.js
// App Router rejects named function exports from page modules). This standalone
// page shows only the signup form - no tab switcher needed.

import React, { useState, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
// Navbar now rendered by server page.tsx via NavbarServer
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { PhoneInput } from '@/src/components/shared/PhoneInput';
import { PreLaunchBanner } from '@/src/components/shared/PreLaunchBanner';

interface RegisterFormProps {
  /** True while the Modeling Hub is in Coming Soon mode. */
  preLaunch?:  boolean;
  launchDate?: string | null;
}

const NAVY = '#0D2E5A';
const BLUE = '#1B4F8A';

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

function RegisterInner({ preLaunch, launchDate }: RegisterFormProps) {
  const router = useRouter();

  const [name,       setName]       = useState('');
  const [email,      setEmail]      = useState('');
  const [phoneCode,  setPhoneCode]  = useState('+1');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [city,       setCity]       = useState('');
  const [country,    setCountry]    = useState('');
  const [password,   setPassword]   = useState('');
  const [confirm,    setConfirm]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [showCfm,    setShowCfm]    = useState(false);

  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef<HCaptcha>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim())         { setError('Full name is required.');       return; }
    if (password !== confirm) { setError('Passwords do not match.');       return; }
    if (!captchaToken)        { setError('Please complete the captcha.'); return; }

    setLoading(true);
    setError('');
    setSuccess('');

    const res = await fetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name, email, password,
        phone: phoneCode + phoneLocal,
        city, country, captchaToken,
      }),
    });
    const json = await res.json().catch(() => ({})) as { error?: string; message?: string };
    setLoading(false);

    if (!res.ok) {
      setError(json.error ?? 'Registration failed. Please try again.');
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
      return;
    }

    setSuccess(
      json.message ??
      'Account created! Please check your email and click the confirmation link to activate your account.',
    );
    captchaRef.current?.resetCaptcha();
    setCaptchaToken('');
  }

  return (
    <>
      {/* NavbarServer rendered by page.tsx */}
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
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, marginBottom: 4 }}>
                Create Your Account
              </h1>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
                Join Financial Modeler Pro · Free plan included
              </p>
            </div>

            <div style={{ padding: '24px 36px 24px' }}>

              <PreLaunchBanner
                enabled={preLaunch ?? false}
                launchDate={launchDate}
                hubLabel="The Modeling Hub"
              />

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626' }}>
                  {error}
                </div>
              )}
              {success && (
                <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#15803D' }}>
                  {success}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>FULL NAME <span style={{ color: '#DC2626' }}>*</span></label>
                  <input type="text" required value={name} onChange={e => setName(e.target.value)}
                    placeholder="Your full name" style={inputStyle}
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
                  <PhoneInput
                    phoneCode={phoneCode} phoneLocal={phoneLocal}
                    onCodeChange={setPhoneCode} onLocalChange={setPhoneLocal}
                    required accentColor={BLUE} inputBackground="#FFFBEB"
                  />
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
                  <label style={labelStyle}>
                    PASSWORD <span style={{ color: '#9CA3AF', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(min 8 characters)</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPw ? 'text' : 'password'} required minLength={8}
                      value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" style={{ ...inputStyle, paddingRight: 40 }}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                    <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9CA3AF', lineHeight: 1 }}>
                      {showPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>CONFIRM PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <input type={showCfm ? 'text' : 'password'} required minLength={8}
                      value={confirm} onChange={e => setConfirm(e.target.value)}
                      placeholder="••••••••" style={{ ...inputStyle, paddingRight: 40 }}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                    <button type="button" onClick={() => setShowCfm(v => !v)} tabIndex={-1}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9CA3AF', lineHeight: 1 }}>
                      {showCfm ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>

                {/* hCaptcha */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <HCaptcha
                    sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? '10000000-ffff-ffff-ffff-000000000001'}
                    onVerify={token => setCaptchaToken(token)}
                    onExpire={() => setCaptchaToken('')}
                    ref={captchaRef}
                  />
                </div>

                <button type="submit" disabled={loading || !captchaToken} style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                  background: (loading || !captchaToken) ? '#93C5FD' : BLUE,
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (loading || !captchaToken) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
                }}>
                  {loading
                    ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Creating…</>
                    : 'Create Account →'}
                </button>

                <p style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', margin: 0 }}>
                  Free plan · 3 projects included · No credit card required
                </p>
              </form>
            </div>

            <div style={{ borderTop: '1px solid #F3F4F6', background: '#F9FAFB', padding: '12px 36px', textAlign: 'center', fontSize: 11.5, color: '#9CA3AF' }}>
              By continuing you agree to our Terms of Service and Privacy Policy.
            </div>
          </div>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              Already have an account?{' '}
              <a href={`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com'}/signin`}
                style={{ color: BLUE, fontWeight: 600, textDecoration: 'none' }}>
                Sign In →
              </a>
            </span>
          </div>

          <p style={{ textAlign: 'center', marginTop: 10, fontSize: 12, color: '#9CA3AF' }}>
            <a href="/" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Home</a>
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </>
  );
}

export function RegisterForm({ preLaunch = false, launchDate = null }: RegisterFormProps = {}) {
  return (
    <Suspense>
      <RegisterInner preLaunch={preLaunch} launchDate={launchDate} />
    </Suspense>
  );
}
