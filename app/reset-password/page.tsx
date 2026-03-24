'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function ResetPasswordInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [done,     setDone]     = useState(false);

  if (!token) {
    return (
      <div style={centeredPage}>
        <div className="alert-error" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          Invalid reset link. Please request a new one.
        </div>
        <Link href="/forgot-password" style={backLink}>← Request new link</Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, newPassword: password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Reset failed. Please try again.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={centeredPage}>
      <div style={{ textAlign: 'center', marginBottom: 'var(--sp-4)' }}>
        <div style={{
          width: 52, height: 52, background: 'var(--color-primary)',
          borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto var(--sp-2)', boxShadow: '0 8px 24px rgba(30,58,138,0.3)',
        }}>
          🔑
        </div>
        <div style={{ fontSize: 'var(--font-h2)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)' }}>
          Set new password
        </div>
      </div>

      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-2)',
        width: '100%', maxWidth: 420, padding: 'var(--sp-4)',
      }}>
        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 8 }}>
              Password updated!
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-meta)' }}>
              Redirecting you to sign in…
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {error && <div className="alert-error">{error}</div>}
            <div>
              <label style={labelStyle}>New password <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(min 8 characters)</span></label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required minLength={8}
                autoComplete="new-password"
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ width: '100%', height: 42, fontSize: 15 }}
            >
              {loading ? 'Updating…' : 'Update Password →'}
            </button>
          </form>
        )}
      </div>

      <Link href="/login" style={backLink}>← Back to Sign In</Link>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordInner />
    </Suspense>
  );
}

const centeredPage: React.CSSProperties = {
  minHeight: '100vh', background: 'var(--color-bg)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', padding: 'var(--sp-3)',
};
const backLink: React.CSSProperties = {
  marginTop: 'var(--sp-3)', fontSize: 'var(--font-meta)',
  color: 'var(--color-primary)', textDecoration: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 'var(--font-meta)', fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-body)', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px var(--sp-2)', fontSize: 'var(--font-body)',
  background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  fontFamily: 'Inter, sans-serif', boxSizing: 'border-box', outline: 'none',
};
