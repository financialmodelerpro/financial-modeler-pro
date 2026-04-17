'use client';

import { Suspense, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
// Navbar rendered by server page.tsx via NavbarServer

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

type Step = 'identity' | 'verify';

function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [step,     setStep]    = useState<Step>('identity');
  const [regId,    setRegId]   = useState(params.get('regId') ?? '');
  const [email,    setEmail]   = useState(params.get('email') ?? '');

  // Step 1
  const [sending,  setSending]  = useState(false);
  const [sendErr,  setSendErr]  = useState('');
  const [resendCD, setResendCD] = useState(0); // countdown seconds

  // Step 2
  const [code,     setCode]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [done,     setDone]     = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startResendCountdown() {
    setResendCD(60);
    timerRef.current = setInterval(() => {
      setResendCD(n => {
        if (n <= 1) { clearInterval(timerRef.current!); return 0; }
        return n - 1;
      });
    }, 1000);
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setSendErr('');
    if (!regId.trim() || !email.trim()) { setSendErr('Both fields are required.'); return; }
    setSending(true);
    try {
      const res  = await fetch('/api/training/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), registrationId: regId.trim() }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        setStep('verify');
        startResendCountdown();
      } else {
        setSendErr(json.error ?? 'Could not send verification code. Please try again.');
      }
    } catch { setSendErr('An unexpected error occurred.'); }
    finally { setSending(false); }
  }

  async function handleResend() {
    if (resendCD > 0) return;
    setSending(true);
    setSendErr('');
    try {
      const res  = await fetch('/api/training/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), registrationId: regId.trim() }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) { startResendCountdown(); }
      else { setSendErr(json.error ?? 'Could not resend code.'); }
    } catch { setSendErr('An unexpected error occurred.'); }
    finally { setSending(false); }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (!code.trim())             { setErrorMsg('Verification code is required.'); return; }
    if (password.length < 8)      { setErrorMsg('Password must be at least 8 characters.'); return; }
    if (password !== confirm)     { setErrorMsg('Passwords do not match.'); return; }

    setLoading(true);
    try {
      const res  = await fetch('/api/training/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: regId.trim(),
          email:          email.trim().toLowerCase(),
          code:           code.trim(),
          password,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) { setDone(true); }
      else { setErrorMsg(json.error ?? 'Something went wrong. Please try again.'); }
    } catch { setErrorMsg('An unexpected error occurred.'); }
    finally { setLoading(false); }
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Password Set!</h2>
        <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, marginBottom: 24 }}>
          Your password has been saved. You can now sign in.
        </p>
        <button
          onClick={() => router.push('/signin')}
          style={{ padding: '12px 28px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
        >
          Sign In Now →
        </button>
      </div>
    );
  }

  // ── Step 1 - Identity ─────────────────────────────────────────────────────
  if (step === 'identity') {
    return (
      <>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, marginBottom: 4 }}>
            Reset Your Password
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            Enter your details and we&apos;ll send a verification code to your email
          </p>
        </div>

        {sendErr && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
            ❌ {sendErr}
          </div>
        )}

        <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle}>REGISTRATION ID <span style={{ color: '#DC2626' }}>*</span></label>
            <input type="text" required value={regId} onChange={e => setRegId(e.target.value)}
              placeholder="FMP-2026-XXXX" style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
          </div>

          <div>
            <label style={labelStyle}>EMAIL ADDRESS <span style={{ color: '#DC2626' }}>*</span></label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
            <div style={{ marginTop: 5, fontSize: 11.5, color: '#9CA3AF' }}>
              We&apos;ll send a 6-digit code to this address
            </div>
          </div>

          <button type="submit" disabled={sending}
            style={{
              width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
              background: sending ? '#86EFAC' : GREEN,
              color: '#fff', border: 'none', borderRadius: 8,
              cursor: sending ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
            }}>
            {sending
              ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> Sending code…</>
              : 'Send Verification Code →'}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <Link href="/signin" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'underline' }}>
            ← Back to Sign In
          </Link>
        </div>
      </>
    );
  }

  // ── Step 2 - Code + New Password ──────────────────────────────────────────
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📧</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, marginBottom: 4 }}>
          Check Your Email
        </h1>
        <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
          We sent a 6-digit code to <strong>{email}</strong>
        </p>
      </div>

      {errorMsg && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626', lineHeight: 1.5 }}>
          ❌ {errorMsg}
        </div>
      )}
      {sendErr && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13, color: '#DC2626' }}>
          ❌ {sendErr}
        </div>
      )}

      <form onSubmit={handleSetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* OTP Code */}
        <div>
          <label style={labelStyle}>VERIFICATION CODE <span style={{ color: '#DC2626' }}>*</span></label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            style={{ ...inputStyle, fontSize: 22, letterSpacing: '0.25em', textAlign: 'center' }}
            onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
          />
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: '#9CA3AF' }}>Code expires in 10 minutes</span>
            <button type="button" onClick={handleResend} disabled={resendCD > 0 || sending}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: resendCD > 0 ? '#9CA3AF' : GREEN, fontWeight: 600, cursor: resendCD > 0 ? 'default' : 'pointer' }}>
              {resendCD > 0 ? `Resend in ${resendCD}s` : 'Resend code'}
            </button>
          </div>
        </div>

        <div style={{ height: 1, background: '#E5E7EB' }} />

        {/* New Password */}
        <div>
          <label style={labelStyle}>NEW PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
          <div style={{ position: 'relative' }}>
            <input type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Minimum 8 characters" style={{ ...inputStyle, paddingRight: 42 }} autoComplete="new-password"
              onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
            <button type="button" onClick={() => setShowPw(v => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: '#9CA3AF' }}>
              {showPw ? '🙈' : '👁'}
            </button>
          </div>
          {password.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 3, borderRadius: 2, background: '#E5E7EB', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (password.length / 12) * 100)}%`, background: password.length < 8 ? '#FCA5A5' : password.length < 12 ? '#FCD34D' : GREEN, transition: 'width 0.2s' }} />
              </div>
              <div style={{ fontSize: 11, color: password.length < 8 ? '#DC2626' : password.length < 12 ? '#D97706' : GREEN, marginTop: 3 }}>
                {password.length < 8 ? 'Too short' : password.length < 12 ? 'Good' : 'Strong'}
              </div>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label style={labelStyle}>CONFIRM PASSWORD <span style={{ color: '#DC2626' }}>*</span></label>
          <input type={showPw ? 'text' : 'password'} required value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Re-enter password"
            style={{ ...inputStyle, borderColor: confirm && confirm !== password ? '#FCA5A5' : '#D1D5DB' }}
            autoComplete="new-password"
            onFocus={e => { e.currentTarget.style.borderColor = confirm !== password ? '#FCA5A5' : GREEN; }}
            onBlur={e => { e.currentTarget.style.borderColor = confirm && confirm !== password ? '#FCA5A5' : '#D1D5DB'; }} />
          {confirm && confirm !== password && (
            <div style={{ marginTop: 4, fontSize: 11.5, color: '#DC2626' }}>Passwords do not match</div>
          )}
        </div>

        <button type="submit" disabled={loading || (!!confirm && confirm !== password)}
          style={{
            width: '100%', padding: '12px', fontSize: 14, fontWeight: 700,
            background: loading ? '#86EFAC' : GREEN,
            color: '#fff', border: 'none', borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4,
          }}>
          {loading
            ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> Saving…</>
            : 'Set New Password →'}
        </button>
      </form>

      <div style={{ marginTop: 20, textAlign: 'center' }}>
        <button onClick={() => { setStep('identity'); setCode(''); setErrorMsg(''); setSendErr(''); }}
          style={{ background: 'none', border: 'none', fontSize: 13, color: '#6B7280', cursor: 'pointer', textDecoration: 'underline' }}>
          ← Use a different email
        </button>
      </div>
    </>
  );
}

export function SetPasswordFormPage() {
  return (
    <>
      <div style={{
        minHeight: 'calc(100vh - 64px)', background: '#F5F7FA',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '40px 20px',
        fontFamily: "'Inter', sans-serif",
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: '36px 36px 32px' }}>
            <Suspense fallback={<div style={{ textAlign: 'center', color: '#6B7280' }}>Loading…</div>}>
              <SetPasswordForm />
            </Suspense>
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
