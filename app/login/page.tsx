'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWhiteLabel } from '@/src/hooks/useWhiteLabel';

type Mode = 'signin' | 'signup';

function LoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl  = searchParams.get('callbackUrl') ?? '/portal';
  const { displayName, displayLogo, displayLogoEmoji } = useWhiteLabel();

  const [mode,     setMode]     = useState<Mode>('signin');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  // Clear messages when switching tabs
  useEffect(() => { setError(''); setSuccess(''); }, [mode]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid email or password. Please try again.');
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');

    // 1 — Register
    const res = await fetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setLoading(false);
      setError(json.error ?? 'Registration failed. Please try again.');
      return;
    }

    // 2 — Auto sign-in after registration
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setSuccess('Account created! Please sign in.');
      setMode('signin');
      return;
    }

    router.push('/portal');
    router.refresh();
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--sp-3)',
    }}>

      {/* Logo / Brand */}
      <div style={{ textAlign: 'center', marginBottom: 'var(--sp-4)' }}>
        <div style={{
          width: 52, height: 52,
          background: 'var(--color-primary)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto var(--sp-2)',
          boxShadow: '0 8px 24px rgba(30,58,138,0.3)',
          overflow: 'hidden',
        }}>
          {displayLogo
            ? <img src={displayLogo} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="logo" />
            : displayLogoEmoji || '💼'}
        </div>
        <div style={{
          fontSize: 'var(--font-h2)',
          fontWeight: 'var(--fw-bold)',
          color: 'var(--color-heading)',
          letterSpacing: '-0.02em',
        }}>{displayName}</div>
        <div style={{
          fontSize: 'var(--font-meta)',
          color: 'var(--color-meta)',
          marginTop: 4,
        }}>Professional real estate financial modeling</div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-2)',
        width: '100%',
        maxWidth: 420,
        overflow: 'hidden',
      }}>

        {/* Tab switcher */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid var(--color-border)',
        }}>
          {(['signin', 'signup'] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: 'var(--sp-2)',
              border: 'none',
              background: mode === m ? 'var(--color-surface)' : 'var(--color-row-alt)',
              color: mode === m ? 'var(--color-primary)' : 'var(--color-meta)',
              fontWeight: mode === m ? 'var(--fw-semibold)' : 'var(--fw-normal)',
              fontSize: 'var(--font-body)',
              cursor: 'pointer',
              borderBottom: mode === m ? '2px solid var(--color-primary)' : '2px solid transparent',
              transition: 'var(--transition)',
              fontFamily: 'Inter, sans-serif',
            }}>
              {m === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {/* Form body */}
        <div style={{ padding: 'var(--sp-4)' }}>

          {/* Error / success banners */}
          {error   && <div className="alert-error"   style={{ marginBottom: 'var(--sp-2)' }}>{error}</div>}
          {success && <div className="alert-success" style={{ marginBottom: 'var(--sp-2)' }}>{success}</div>}

          {mode === 'signin' ? (
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <div>
                <label style={labelStyle}>Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Password</label>
                  <a href="/forgot-password" style={{ fontSize: 'var(--font-micro)', color: 'var(--color-primary)', textDecoration: 'none' }}>
                    Forgot password?
                  </a>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  style={inputStyle}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
                style={{ width: '100%', marginTop: 'var(--sp-1)', height: 42, fontSize: 15 }}
              >
                {loading ? 'Signing in…' : 'Sign In →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <div>
                <label style={labelStyle}>Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Jane Smith"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Password <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(min 8 characters)</span></label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  style={inputStyle}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
                style={{ width: '100%', marginTop: 'var(--sp-1)', height: 42, fontSize: 15 }}
              >
                {loading ? 'Creating account…' : 'Create Account →'}
              </button>
              <p style={{ fontSize: 'var(--font-meta)', color: 'var(--color-muted)', textAlign: 'center', margin: 0 }}>
                Free plan · 3 projects included · No credit card required
              </p>
            </form>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-row-alt)',
          padding: 'var(--sp-2) var(--sp-4)',
          textAlign: 'center',
          fontSize: 'var(--font-micro)',
          color: 'var(--color-muted)',
        }}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </div>
      </div>

      {/* Back to portal */}
      <a href="/" style={{
        marginTop: 'var(--sp-3)',
        fontSize: 'var(--font-meta)',
        color: 'var(--color-primary)',
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        ← Back to Portal
      </a>
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

// ── Shared inline styles (avoid Tailwind per CLAUDE.md) ─────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px var(--sp-2)',
  fontSize: 'var(--font-body)',
  background: 'var(--color-warning-bg)',
  color: 'var(--color-warning-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'Inter, sans-serif',
  boxSizing: 'border-box',
  outline: 'none',
};
