'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';

function ForgotPasswordInner() {
  const [email,     setEmail]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error,     setError]     = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      // Always show "check your email" regardless of whether the account exists
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

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
      <div style={{ textAlign: 'center', marginBottom: 'var(--sp-4)' }}>
        <div style={{
          width: 52, height: 52,
          background: 'var(--color-primary)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto var(--sp-2)',
          boxShadow: '0 8px 24px rgba(30,58,138,0.3)',
        }}>
          🔐
        </div>
        <div style={{ fontSize: 'var(--font-h2)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)' }}>
          Reset your password
        </div>
        <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginTop: 4 }}>
          Enter your email and we&apos;ll send you a reset link
        </div>
      </div>

      <div style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-2)',
        width: '100%',
        maxWidth: 420,
        padding: 'var(--sp-4)',
      }}>
        {submitted ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📬</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-heading)', marginBottom: 8 }}>
              Check your email
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-meta)', lineHeight: 1.6 }}>
              If an account exists for <strong>{email}</strong>, you&apos;ll receive a password reset link shortly.
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 12 }}>
              Didn&apos;t get it? Check your spam folder or{' '}
              <button
                onClick={() => setSubmitted(false)}
                style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}
              >
                try again
              </button>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {error && <div className="alert-error">{error}</div>}
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
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ width: '100%', height: 42, fontSize: 15 }}
            >
              {loading ? 'Sending…' : 'Send Reset Link →'}
            </button>
          </form>
        )}
      </div>

      <Link href="/login" style={{
        marginTop: 'var(--sp-3)',
        fontSize: 'var(--font-meta)',
        color: 'var(--color-primary)',
        textDecoration: 'none',
      }}>
        ← Back to Sign In
      </Link>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordInner />
    </Suspense>
  );
}

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
