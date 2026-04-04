'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from '@/src/components/layout/Navbar';

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
  const callbackUrl  = searchParams.get('callbackUrl') ?? '/portal';

  const [mode,     setMode]     = useState<Mode>('signin');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  useEffect(() => { setError(''); setSuccess(''); }, [mode]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    if (result?.error) { setError('Invalid email or password. Please try again.'); return; }
    router.push(callbackUrl);
    router.refresh();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true); setError(''); setSuccess('');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setLoading(false);
      setError(json.error ?? 'Registration failed. Please try again.');
      return;
    }
    const result = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    if (result?.error) { setSuccess('Account created! Please sign in.'); setMode('signin'); return; }
    router.push('/portal');
    router.refresh();
  };

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

          {/* Card */}
          <div style={{
            background: '#fff', borderRadius: 14,
            border: '1px solid #E5E7EB',
            boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ background: NAVY, padding: '28px 36px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📐</div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, marginBottom: 4 }}>
                Sign In to Modeling Hub
              </h1>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
                Access your financial models and saved projects
              </p>
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

            <div style={{ padding: '28px 36px 24px' }}>
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
                      <a href="/forgot-password" style={{ fontSize: 12, color: BLUE, textDecoration: 'none' }}>Forgot password?</a>
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
                <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div>
                    <label style={labelStyle}>FULL NAME</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder="Jane Smith" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div>
                    <label style={labelStyle}>EMAIL ADDRESS</label>
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div>
                    <label style={labelStyle}>PASSWORD <span style={{ color: '#9CA3AF', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(min 8 characters)</span></label>
                    <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" style={inputStyle}
                      onFocus={e => { e.currentTarget.style.borderColor = BLUE; }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }} />
                  </div>
                  <div>
                    <label style={labelStyle}>CONFIRM PASSWORD</label>
                    <input type="password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)}
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
