'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ConfirmEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const error = searchParams.get('error') ?? '';

  const [status, setStatus] = useState<'loading' | 'error'>('loading');

  useEffect(() => {
    if (error) { setStatus('error'); return; }
    if (!token) { setStatus('error'); return; }
    // Redirect to API route — it handles everything server-side and redirects back
    window.location.href = `/api/auth/confirm-email?token=${encodeURIComponent(token)}`;
  }, [token, error]);

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ maxWidth: 440, width: '100%', background: '#fff', borderRadius: 14, border: '1px solid #FECACA', padding: '40px 36px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#DC2626', marginBottom: 10 }}>Link Invalid or Expired</h1>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, marginBottom: 24 }}>
            This confirmation link is invalid or has expired. Please sign up again to receive a new confirmation email.
          </p>
          <a href={`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com'}/register`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1E40AF', color: '#fff', fontSize: 14, fontWeight: 700, padding: '11px 24px', borderRadius: 8, textDecoration: 'none' }}>
            Register Again →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F7FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 440, width: '100%', background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', padding: '40px 36px', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>Confirming your email…</h1>
        <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>Please wait while we activate your account.</p>
      </div>
    </div>
  );
}

export default function ModelingConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailInner />
    </Suspense>
  );
}
