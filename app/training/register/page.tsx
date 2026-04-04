'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { Navbar } from '@/src/components/layout/Navbar';
import HCaptcha from '@hcaptcha/react-hcaptcha';

type Step   = 'form' | 'verify' | 'done';
type Status = 'idle' | 'loading' | 'error' | 'duplicate';

const GREEN = '#2EAA4A';
const NAVY  = '#0D2E5A';

const COUNTRY_CODES = [
  { code: '+1',   flag: '🇺🇸', label: 'US / Canada' },
  { code: '+44',  flag: '🇬🇧', label: 'UK' },
  { code: '+92',  flag: '🇵🇰', label: 'Pakistan' },
  { code: '+971', flag: '🇦🇪', label: 'UAE' },
  { code: '+966', flag: '🇸🇦', label: 'Saudi Arabia' },
  { code: '+91',  flag: '🇮🇳', label: 'India' },
  { code: '+61',  flag: '🇦🇺', label: 'Australia' },
  { code: '+49',  flag: '🇩🇪', label: 'Germany' },
  { code: '+33',  flag: '🇫🇷', label: 'France' },
  { code: '+86',  flag: '🇨🇳', label: 'China' },
  { code: '+93',  flag: '🇦🇫', label: 'Afghanistan' },
  { code: '+213', flag: '🇩🇿', label: 'Algeria' },
  { code: '+54',  flag: '🇦🇷', label: 'Argentina' },
  { code: '+880', flag: '🇧🇩', label: 'Bangladesh' },
  { code: '+55',  flag: '🇧🇷', label: 'Brazil' },
  { code: '+20',  flag: '🇪🇬', label: 'Egypt' },
  { code: '+251', flag: '🇪🇹', label: 'Ethiopia' },
  { code: '+233', flag: '🇬🇭', label: 'Ghana' },
  { code: '+62',  flag: '🇮🇩', label: 'Indonesia' },
  { code: '+98',  flag: '🇮🇷', label: 'Iran' },
  { code: '+964', flag: '🇮🇶', label: 'Iraq' },
  { code: '+972', flag: '🇮🇱', label: 'Israel' },
  { code: '+39',  flag: '🇮🇹', label: 'Italy' },
  { code: '+81',  flag: '🇯🇵', label: 'Japan' },
  { code: '+962', flag: '🇯🇴', label: 'Jordan' },
  { code: '+254', flag: '🇰🇪', label: 'Kenya' },
  { code: '+965', flag: '🇰🇼', label: 'Kuwait' },
  { code: '+961', flag: '🇱🇧', label: 'Lebanon' },
  { code: '+218', flag: '🇱🇾', label: 'Libya' },
  { code: '+60',  flag: '🇲🇾', label: 'Malaysia' },
  { code: '+52',  flag: '🇲🇽', label: 'Mexico' },
  { code: '+212', flag: '🇲🇦', label: 'Morocco' },
  { code: '+31',  flag: '🇳🇱', label: 'Netherlands' },
  { code: '+64',  flag: '🇳🇿', label: 'New Zealand' },
  { code: '+234', flag: '🇳🇬', label: 'Nigeria' },
  { code: '+47',  flag: '🇳🇴', label: 'Norway' },
  { code: '+968', flag: '🇴🇲', label: 'Oman' },
  { code: '+63',  flag: '🇵🇭', label: 'Philippines' },
  { code: '+48',  flag: '🇵🇱', label: 'Poland' },
  { code: '+351', flag: '🇵🇹', label: 'Portugal' },
  { code: '+974', flag: '🇶🇦', label: 'Qatar' },
  { code: '+7',   flag: '🇷🇺', label: 'Russia' },
  { code: '+65',  flag: '🇸🇬', label: 'Singapore' },
  { code: '+27',  flag: '🇿🇦', label: 'South Africa' },
  { code: '+82',  flag: '🇰🇷', label: 'South Korea' },
  { code: '+34',  flag: '🇪🇸', label: 'Spain' },
  { code: '+249', flag: '🇸🇩', label: 'Sudan' },
  { code: '+46',  flag: '🇸🇪', label: 'Sweden' },
  { code: '+41',  flag: '🇨🇭', label: 'Switzerland' },
  { code: '+963', flag: '🇸🇾', label: 'Syria' },
  { code: '+255', flag: '🇹🇿', label: 'Tanzania' },
  { code: '+66',  flag: '🇹🇭', label: 'Thailand' },
  { code: '+216', flag: '🇹🇳', label: 'Tunisia' },
  { code: '+90',  flag: '🇹🇷', label: 'Turkey' },
  { code: '+256', flag: '🇺🇬', label: 'Uganda' },
  { code: '+380', flag: '🇺🇦', label: 'Ukraine' },
  { code: '+84',  flag: '🇻🇳', label: 'Vietnam' },
  { code: '+967', flag: '🇾🇪', label: 'Yemen' },
  { code: '+263', flag: '🇿🇼', label: 'Zimbabwe' },
];

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

export default function TrainingRegisterPage() {
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
  const [course,   setCourse]   = useState('3sfm');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');

  // hCaptcha
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaRef = useRef<HCaptcha>(null);

  // Email verification
  const [otpCode,       setOtpCode]       = useState('');
  const [sendingOtp,    setSendingOtp]    = useState(false);
  const [otpSent,       setOtpSent]       = useState(false);
  const [verifyingOtp,  setVerifyingOtp]  = useState(false);
  const [otpError,      setOtpError]      = useState('');

  async function sendVerificationCode() {
    if (!email.trim()) return;
    setSendingOtp(true);
    setOtpError('');
    try {
      const res = await fetch('/api/training/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        setOtpSent(true);
        setStep('verify');
      } else {
        setOtpError('Failed to send code. Please try again.');
      }
    } catch {
      setOtpError('Failed to send code. Please try again.');
    }
    setSendingOtp(false);
  }

  async function verifyCode() {
    if (!otpCode.trim()) return;
    setVerifyingOtp(true);
    setOtpError('');
    try {
      const res = await fetch('/api/training/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: otpCode.trim() }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        setOtpError('');
        await submitRegistration();
      } else {
        setOtpError(json.error ?? 'Incorrect code. Please try again.');
      }
    } catch {
      setOtpError('Verification failed. Please try again.');
    }
    setVerifyingOtp(false);
  }

  async function submitRegistration() {
    setStatus('loading');
    try {
      const res = await fetch('/api/training/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         name.trim(),
          email:        email.trim().toLowerCase(),
          course,
          phone:        phoneLocal.trim() ? phoneCode + phoneLocal.trim() : undefined,
          city:         city.trim() || undefined,
          country:      country.trim() || undefined,
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
        setStep('form');
      } else {
        setStatus('error');
        setErrorMsg(json.error ?? 'Registration failed. Please try again.');
        setStep('form');
        captchaRef.current?.resetCaptcha();
        setCaptchaToken('');
      }
    } catch {
      setStatus('error');
      setErrorMsg('An unexpected error occurred. Please try again.');
      setStep('form');
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
    await sendVerificationCode();
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
              <Link href="/training/signin" style={{
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

  // ── Email verification step ────────────────────────────────────────────────
  if (step === 'verify') {
    return (
      <>
        <Navbar />
        <div style={{ minHeight: 'calc(100vh - 64px)', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
          <div style={{ width: '100%', maxWidth: 440 }}>
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: '36px 36px 32px' }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📧</div>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: 0, marginBottom: 6 }}>Verify Your Email</h1>
                <p style={{ fontSize: 13, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
                  We sent a 6-digit code to <strong>{email}</strong>.<br />
                  Enter it below to continue.
                </p>
              </div>

              {otpError && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626' }}>
                  ❌ {otpError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <label style={labelStyle}>VERIFICATION CODE</label>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    maxLength={6}
                    style={{ ...inputStyle, fontSize: 22, fontWeight: 700, textAlign: 'center', letterSpacing: '0.3em' }}
                    onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
                  />
                  <div style={{ marginTop: 6, fontSize: 11.5, color: '#9CA3AF' }}>Code expires in 10 minutes</div>
                </div>

                <button
                  onClick={verifyCode}
                  disabled={verifyingOtp || status === 'loading' || otpCode.length < 6}
                  style={{
                    width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                    background: (verifyingOtp || status === 'loading' || otpCode.length < 6) ? '#86EFAC' : GREEN,
                    color: '#fff', border: 'none', borderRadius: 8,
                    cursor: (verifyingOtp || status === 'loading' || otpCode.length < 6) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {(verifyingOtp || status === 'loading') ? (<><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Verifying…</>) : 'Verify & Register →'}
                </button>

                <button
                  onClick={() => { setOtpCode(''); sendVerificationCode(); }}
                  disabled={sendingOtp}
                  style={{ background: 'none', border: 'none', fontSize: 13, color: GREEN, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' }}
                >
                  {sendingOtp ? 'Sending…' : 'Resend code'}
                </button>

                <button
                  onClick={() => { setStep('form'); setOtpCode(''); setOtpSent(false); setOtpError(''); }}
                  style={{ background: 'none', border: 'none', fontSize: 13, color: '#9CA3AF', cursor: 'pointer', padding: 0, textAlign: 'center' }}
                >
                  ← Go back and edit details
                </button>
              </div>
            </div>
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

            {status === 'duplicate' && (
              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '14px 16px', marginBottom: 20, fontSize: 13, color: '#1D4ED8', lineHeight: 1.5 }}>
                ℹ️ You are already registered. Your Registration ID has been resent to <strong>{email}</strong>.
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
                <input type="email" required value={email} onChange={e => { setEmail(e.target.value); setOtpSent(false); }}
                  placeholder="you@example.com" style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                <div style={{ marginTop: 5, fontSize: 11.5, color: '#6B7280' }}>
                  📧 A verification code will be sent to this email
                </div>
              </div>

              {/* Phone */}
              <div>
                <label style={labelStyle}>PHONE NUMBER <span style={{ color: '#9CA3AF', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <div style={{ display: 'flex' }}>
                  <select value={phoneCode} onChange={e => setPhoneCode(e.target.value)}
                    style={{ padding: '10px 6px', fontSize: 13, border: '1.5px solid #D1D5DB', borderRadius: '7px 0 0 7px', borderRight: 'none', background: '#fff', cursor: 'pointer', fontFamily: "'Inter', sans-serif", outline: 'none', flexShrink: 0 }}
                    onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}>
                    {COUNTRY_CODES.map(c => (
                      <option key={c.code + c.label} value={c.code}>{c.flag} {c.code} — {c.label}</option>
                    ))}
                  </select>
                  <input type="tel" value={phoneLocal} onChange={e => setPhoneLocal(e.target.value)}
                    placeholder="Local number" style={{ ...inputStyle, borderRadius: '0 7px 7px 0', flex: 1, minWidth: 0 }}
                    onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
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

              {/* Course */}
              <div>
                <label style={labelStyle}>COURSE <span style={{ color: '#DC2626' }}>*</span></label>
                <select required value={course} onChange={e => setCourse(e.target.value)}
                  style={{ ...inputStyle, background: '#fff', cursor: 'pointer' }}
                  onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}>
                  <option value="3sfm">3-Statement Financial Modeling</option>
                  <option value="bvm">Business Valuation Methods</option>
                  <option value="both">Both Courses</option>
                </select>
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

              {/* hCaptcha */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <HCaptcha
                  sitekey={process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? '10000000-ffff-ffff-ffff-000000000001'}
                  onVerify={(token) => setCaptchaToken(token)}
                  onExpire={() => setCaptchaToken('')}
                  ref={captchaRef}
                />
              </div>

              <button
                type="submit"
                disabled={status === 'loading' || sendingOtp || !captchaToken}
                style={{
                  width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
                  background: (status === 'loading' || sendingOtp || !captchaToken) ? '#86EFAC' : GREEN,
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (status === 'loading' || sendingOtp || !captchaToken) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
                }}
              >
                {(status === 'loading' || sendingOtp) ? (
                  <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />{sendingOtp ? 'Sending code…' : 'Registering…'}</>
                ) : 'Continue →'}
              </button>
            </form>

            <div style={{ marginTop: 24, textAlign: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 20 }}>
              <span style={{ fontSize: 13, color: '#6B7280' }}>
                Already have a Registration ID?{' '}
                <Link href="/training/signin" style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Sign In →</Link>
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
