'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const SUPPORT_EMAIL = 'support@financialmodelerpro.com';

type ErrorKind = 'link-expired' | 'token-expired' | 'registration-failed' | 'password-failed' | 'unknown';

interface ErrorCopy {
  emoji:       string;
  title:       string;
  titleColor:  string;
  body:        React.ReactNode;
  primaryCta:  { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

function copyFor(error: ErrorKind, retryToken: string): ErrorCopy {
  if (error === 'registration-failed') {
    return {
      emoji:      '\u26A0\uFE0F',
      title:      'We couldn\u2019t finish setting up your account',
      titleColor: '#B45309',
      body: (
        <>
          Something went wrong while saving your registration. Your place in the sheet is safe and your
          link is still active for the next 24 hours. Please try again, or email us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#2E75B6' }}>{SUPPORT_EMAIL}</a>{' '}
          if it keeps failing.
        </>
      ),
      primaryCta:   retryToken
        ? { label: 'Try again \u2192', href: `/api/training/confirm-email?token=${encodeURIComponent(retryToken)}` }
        : { label: 'Contact support \u2192', href: `mailto:${SUPPORT_EMAIL}` },
      secondaryCta: { label: 'Register again',  href: '/register' },
    };
  }
  if (error === 'password-failed') {
    return {
      emoji:      '\u26A0\uFE0F',
      title:      'We couldn\u2019t save your password',
      titleColor: '#B45309',
      body: (
        <>
          Your registration was accepted but we hit a problem storing your password. Please try again,
          or email us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#2E75B6' }}>{SUPPORT_EMAIL}</a>{' '}
          and we{'\u2019'}ll help you set one manually.
        </>
      ),
      primaryCta:   retryToken
        ? { label: 'Try again \u2192', href: `/api/training/confirm-email?token=${encodeURIComponent(retryToken)}` }
        : { label: 'Contact support \u2192', href: `mailto:${SUPPORT_EMAIL}` },
      secondaryCta: { label: 'Back to sign in', href: '/signin' },
    };
  }
  if (error === 'token-expired') {
    return {
      emoji:      '\u23F0',
      title:      'This confirmation link has expired',
      titleColor: '#DC2626',
      body: (
        <>
          Confirmation links are valid for 24 hours. Please register again to receive a fresh link, or
          contact us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#2E75B6' }}>{SUPPORT_EMAIL}</a>{' '}
          if you{'\u2019'}ve already registered.
        </>
      ),
      primaryCta: { label: 'Register again \u2192', href: '/register' },
    };
  }
  // link-expired and unknown: treat as the canonical invalid/expired case.
  return {
    emoji:      '\u274C',
    title:      'Link Invalid or Expired',
    titleColor: '#DC2626',
    body:       'This confirmation link is invalid or has expired. Please register again to receive a new link.',
    primaryCta: { label: 'Register Again \u2192', href: '/register' },
  };
}

function normalizeError(raw: string): ErrorKind {
  if (raw === 'registration-failed') return 'registration-failed';
  if (raw === 'password-failed')     return 'password-failed';
  if (raw === 'token-expired')       return 'token-expired';
  if (raw === 'link-expired')        return 'link-expired';
  return 'unknown';
}

function ConfirmEmailInner() {
  const searchParams = useSearchParams();
  const token    = searchParams.get('token') ?? '';
  const error    = searchParams.get('error') ?? '';
  // Preserve a same-origin `redirect` so it survives the API hop and
  // ends up on the post-confirm signin URL (FIX 3, 2026-04-23).
  const redirect = searchParams.get('redirect') ?? '';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    if (error) { setStatus('error'); return; }
    if (!token) { setStatus('error'); return; }
    const qs = new URLSearchParams({ token });
    if (redirect) qs.set('redirect', redirect);
    // Redirect to API route - it handles everything and redirects back
    window.location.href = `/api/training/confirm-email?${qs.toString()}`;
  }, [token, error, redirect]);

  if (status === 'error') {
    const kind = normalizeError(error);
    // Only offer a token-based retry on backend-failure codes; token-based
    // retry for an expired token would just fail again.
    const retryToken = (kind === 'registration-failed' || kind === 'password-failed') ? token : '';
    const c = copyFor(kind, retryToken);

    const btnStyle: React.CSSProperties = {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: '#2EAA4A', color: '#fff', fontSize: 14, fontWeight: 700,
      padding: '11px 24px', borderRadius: 8, textDecoration: 'none',
    };
    const secondaryBtnStyle: React.CSSProperties = {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: '#fff', color: '#374151', fontSize: 13, fontWeight: 600,
      padding: '10px 20px', borderRadius: 8, textDecoration: 'none',
      border: '1px solid #E5E7EB',
    };

    return (
      <div style={{ minHeight: '100vh', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ maxWidth: 480, width: '100%', background: '#fff', borderRadius: 14, border: '1px solid #FECACA', padding: '40px 36px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{c.emoji}</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: c.titleColor, marginBottom: 10 }}>{c.title}</h1>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, marginBottom: 24 }}>
            {c.body}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href={c.primaryCta.href} style={btnStyle}>
              {c.primaryCta.label}
            </Link>
            {c.secondaryCta && (
              <Link href={c.secondaryCta.href} style={secondaryBtnStyle}>
                {c.secondaryCta.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 440, width: '100%', background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '40px 36px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u23F3'}</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>Confirming your email{'\u2026'}</h1>
        <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>Please wait while we activate your account.</p>
      </div>
    </div>
  );
}

export default function TrainingConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailInner />
    </Suspense>
  );
}
