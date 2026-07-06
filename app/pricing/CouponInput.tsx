'use client';

import { useState } from 'react';

/**
 * Controlled coupon field for checkout. The code lives in the parent
 * (PricingExplorer) so it can be passed to /api/payments/checkout, where it is
 * resolved server-side to a Paddle discount id and applied by Paddle (Model 1).
 * "Apply" gives immediate feedback via /api/payments/coupon/resolve (no charge,
 * no state written); Paddle does the final validation at checkout.
 *
 * No em dashes in this file.
 */
export function CouponInput({
  value, onChange, platform,
}: { value: string; onChange: (v: string) => void; platform?: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
  const [message, setMessage] = useState('');

  async function handleApply() {
    if (!value.trim()) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/payments/coupon/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code: value.trim().toUpperCase(), platform }),
      });
      const data = await res.json() as { ok: boolean; label?: string; message?: string };
      if (data.ok) { setStatus('valid'); setMessage(`Code applied: ${data.label ?? ''}. It will be applied at checkout.`); }
      else { setStatus('invalid'); setMessage(data.message ?? 'That coupon code is not valid.'); }
    } catch {
      setStatus('invalid');
      setMessage('Could not check that code. You can still enter it and continue to checkout.');
    }
  }

  return (
    <div data-testid="checkout-coupon" style={{ maxWidth: 480, margin: '40px auto 0', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Have a coupon code?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value.toUpperCase()); setStatus('idle'); setMessage(''); }}
          placeholder="ENTER CODE"
          data-testid="checkout-coupon-input"
          style={{ flex: 1, padding: '10px 14px', fontSize: 14, border: '1.5px solid #D1D5DB', borderRadius: 8, outline: 'none', fontFamily: 'monospace', letterSpacing: '0.05em', textTransform: 'uppercase' }}
        />
        <button
          onClick={handleApply}
          disabled={status === 'loading' || !value.trim()}
          data-testid="checkout-coupon-apply"
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: status === 'loading' ? 'not-allowed' : 'pointer', opacity: status === 'loading' ? 0.6 : 1 }}
        >
          {status === 'loading' ? 'Checking...' : 'Apply'}
        </button>
      </div>
      {status === 'valid' && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#15803D', fontWeight: 600 }} data-testid="checkout-coupon-valid">✓ {message}</div>
      )}
      {status === 'invalid' && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#DC2626', fontWeight: 600 }} data-testid="checkout-coupon-invalid">✗ {message}</div>
      )}
      <div style={{ marginTop: 10, fontSize: 12, color: '#9CA3AF' }}>The discount is applied by our payment provider at checkout.</div>
    </div>
  );
}
