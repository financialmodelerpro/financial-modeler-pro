'use client';

import { useState } from 'react';

export function CouponInput() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
  const [message, setMessage] = useState('');

  async function handleApply() {
    if (!code.trim()) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/pricing/validate-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const data = await res.json() as { valid: boolean; message: string };
      setStatus(data.valid ? 'valid' : 'invalid');
      setMessage(data.message);
    } catch {
      setStatus('invalid');
      setMessage('Failed to validate coupon.');
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '40px auto 0', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Have a coupon code?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={code}
          onChange={e => { setCode(e.target.value.toUpperCase()); setStatus('idle'); }}
          placeholder="ENTER CODE"
          style={{ flex: 1, padding: '10px 14px', fontSize: 14, border: '1.5px solid #D1D5DB', borderRadius: 8, outline: 'none', fontFamily: 'monospace', letterSpacing: '0.05em', textTransform: 'uppercase' }}
        />
        <button
          onClick={handleApply}
          disabled={status === 'loading' || !code.trim()}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: status === 'loading' ? 'not-allowed' : 'pointer', opacity: status === 'loading' ? 0.6 : 1 }}
        >
          {status === 'loading' ? 'Checking...' : 'Apply'}
        </button>
      </div>
      {status === 'valid' && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#15803D', fontWeight: 600 }}>✓ {message}</div>
      )}
      {status === 'invalid' && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#DC2626', fontWeight: 600 }}>✗ {message}</div>
      )}
    </div>
  );
}
