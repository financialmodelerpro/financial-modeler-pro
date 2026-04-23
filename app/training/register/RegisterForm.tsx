'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { Navbar } from '@/src/components/layout/Navbar';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { PhoneInput } from '@/src/components/shared/PhoneInput';
import { PreLaunchBanner } from '@/src/components/shared/PreLaunchBanner';

interface TrainingRegisterFormProps {
  /** True while the Training Hub is in Coming Soon mode - shows a
   *  "launching soon, sign-in opens at launch" banner above the form. */
  preLaunch?:  boolean;
  launchDate?: string | null;
}

type Step   = 'form' | 'done';
type Status = 'idle' | 'loading' | 'error' | 'duplicate';

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

// E.164: starts with `+`, then a non-zero leading digit, then 6 to 14 more
// digits (total 7 to 15 digits after the `+`). Covers everything from short
// 7-digit numbers (Macau) up to the ITU max of 15 digits.
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function TrainingRegisterForm({ preLaunch = false, launchDate = null }: TrainingRegisterFormProps = {}) {
  const [step,   setStep]   = useState<Step>('form');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Form fields
  const [name,       setName]       = useState('');
  const [email,      setEmail]      = useState('');
  const [phoneCode,  setPhoneCode]  = useState('+1');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [city,     setCity]     = useState('');
  const [country,  setCountry]  = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');

  // hCaptcha
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef<HCaptcha>(null);

  async function submitRegistration(fullPhone: string) {
    setStatus('loading');
    try {
      const res = await fetch('/api/training/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         name.trim(),
          email:        email.trim().toLowerCase(),
          phone:        fullPhone,
          city:         city.trim(),
          country:      country.trim(),
          password,
          captchaToken,
        }),
      });
      const json = await res.json() as { success: boolean; duplicate?: boolean; error?: string };
      if (json.success) {
        setStep('done');
        setStatus('idle');
      } else if (json.duplicate) {
        setStatus('duplicate');
      } else {
        setStatus('error');
        setErrorMsg(json.error ?? 'Registration failed. Please try again.');
        captchaRef.current?.resetCaptcha();
        setCaptchaToken('');
      }
    } catch {
      setStatus('error');
      setErrorMsg('An unexpected error occurred. Please try again.');
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (!captchaToken) { setStatus('error'); setErrorMsg('Please complete the captcha.'); return; }
    if (!password || password.length < 8) { setStatus('error'); setErrorMsg('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setStatus('error'); setErrorMsg('Passwords do not match.'); return; }
    if (!city.trim()) { setStatus('error'); setErrorMsg('City is required.'); return; }
    if (!country.trim()) { setStatus('error'); setErrorMsg('Country is required.'); return; }

    // Phone: required + E.164 format check on the concatenated string.
    const cleanedLocal = phoneLocal.replace(/\D/g, '');
    if (!cleanedLocal) { setStatus('error'); setErrorMsg('Phone number is required.'); return; }
    const fullPhone = `${phoneCode}${cleanedLocal}`;
    if (!E164_RE.test(fullPhone)) {
      setStatus('error');
      setErrorMsg('Phone number looks invalid. Pick a country code and enter your local number (digits only).');
      return;
    }

    await submitRegistration(fullPhone);
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <>
        <Navbar />
        <div style={{ minHeight: 'calc(100vh - 64px)', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
          <div style={{ width: '100%', maxWidth: 480 }}>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: '40px 36px', textAlign: 'center' }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>📧</div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Check Your Email!</h1>
              <p style={{ fontSize: 14, color: '#374151', marginBottom: 6, lineHeight: 1.6 }}>
                We sent a confirmation link to <strong>{email}</strong>.
              </p>
              <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24, lineHeight: 1.6 }}>
                Click the link in your email to activate your account. Your Registration ID will be sent after confirmation.
              </p>
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '12px 16px', fontSize: 12.5, color: '#15803D', marginBottom: 24 }}>
                ✅ The confirmation link expires in 24 hours.
              </div>
              <Link href="/signin" style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: GREEN, color: '#fff', fontSize: 14, fontWeight: 700,
                padding: '11px 24px', borderRadius: 8, textDecoration: 'none',
              }}>
                Go to Sign In →
              </Link>
            </div>
            <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: '#9CA3AF' }}>
              <Link href="/training" style={{ color: '#9CA3AF', textDecoration: 'none' }}>← Back to Training Hub</Link>
            </p>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  // ── Registration form ──────────────────────────────────────────────────────
  return (
    <>
      <Navbar />
      <div style={{
        minHeight: 'calc(100vh - 64px)', background: '#F5F7FA',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '40px 20px',
        fontFamily: "'Inter', sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 480 }}>

          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: '36px 36px 32px' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginBottom: 4, textAlign: 'center' }}>
              Register for Free Certification
            </h1>
            <p style={{ fontSize: 12.5, color: '#6B7280', textAlign: 'center', marginBottom: 28, lineHeight: 1.5 }}>
              Your name will appear exactly as entered on your certificate.
            </p>

            <PreLaunchBanner
              enabled={preLaunch}
              launchDate={launchDate}
              hubLabel="The Training Hub"
            />

            {status === 'duplicate' && (
              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '14px 16px', marginBottom: 20, fontSize: 13, color: '#1D4ED8', lineHeight: 1.5 }}>
                ℹ️ You are already registered. Sign in below or use Forgot Password if you need to reset it.
              </div>
            )}

            {status === 'error' && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '14px 16px', marginBottom: 20, fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
                ❌ {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Full Name */}
              <div>
                <label style={labelStyle}>FULL NAME <span style={{ color: '#DC2626' }}>*</span></label>
                <input type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your full name" style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
              </div>

              {/* Email */}
              <div>
                <label style={labelStyle}>EMAIL ADDRESS <span style={{ color: '#DC2626' }}>*</span></label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                <div style={{ marginTop: 5, fontSize: 11.5, color: '#6B7280' }}>
                  📧 We will send a confirmation link to this address
                </div>
              </div>

              {/* Phone */}
              <div>
                <label style={labelStyle}>PHONE NUMBER <span style={{ color: '#DC2626' }}>*</span></label>
                <PhoneInput
                  phoneCode={phoneCode}
                  phoneLocal={phoneLocal}
                  onCodeChange={setPhoneCode}
                  onLocalChange={(local) => setPhoneLocal(local.replace(/[^\d\s\-()]/g, ''))}
                  required
                  accentColor={GREEN}
                  inputBackground="#FFFBEB"
                />
                <div style={{ marginTop: 5, fontSize: 11.5, color: '#6B7280' }}>
                  Pick your country code and enter the local number (digits only).
                </div>
              </div>

              {/* City + Country */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>CITY <span style={{ color: '#DC2626' }}>*</span></label>
                  <input type="text" required value={city} onChange={e => setCity(e.target.value)}
                    placeholder="Karachi" style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                </div>
                <div>
                  <label style={labelStyle}>COUNTRY <span style={{ color: '#DC2626' }}>*</span></label>
                  <input type="text" required value={country} onChange={e => setCountry(e.target.value)}
                    placeholder="Pakistan" style={inputStyle}
                    onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                </div>
              </div>

              {/* Password */}
              <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 18 }}>
                <label style={labelStyle}>PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="min 8 characters" minLength={8} style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
              </div>

              <div>
                <label style={labelStyle}>CONFIRM PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
                <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="re-enter password" minLength={8} style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
              </div>

              {/* hCaptcha - C7: overflow-x:auto fallback so the ~300px
                  widget stays reachable on 320px phones. */}
              <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto', maxWidth: '100%' }}>
                <HCaptcha
                  sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? '10000000-ffff-ffff-ffff-000000000001'}
                  onVerify={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken('')}
                  ref={captchaRef}
                />
              </div>

              <button
                type="submit"
                disabled={status === 'loading' || !captchaToken}
                style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                  background: (status === 'loading' || !captchaToken) ? '#86EFAC' : GREEN,
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (status === 'loading' || !captchaToken) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
                }}
              >
                {status === 'loading' ? (
                  <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Sending confirmation link…</>
                ) : 'Create my account →'}
              </button>
            </form>

            <div style={{ marginTop: 24, textAlign: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 20 }}>
              <span style={{ fontSize: 13, color: '#6B7280' }}>
                Already have a Registration ID?{' '}
                <Link href="/signin" style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Sign In →</Link>
              </span>
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
