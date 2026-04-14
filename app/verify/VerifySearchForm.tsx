'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function VerifySearchForm() {
  const [certId, setCertId] = useState('');
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = certId.trim();
    if (!id) return;
    router.push(`/verify/${encodeURIComponent(id)}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <input
        type="text"
        value={certId}
        onChange={e => setCertId(e.target.value)}
        placeholder="e.g. FMP-3SFM-2026-0001"
        required
        style={{
          flex: 1, minWidth: 200, padding: '14px 18px', fontSize: 15,
          border: '2px solid #D1D5DB', borderRadius: 10, outline: 'none',
          fontFamily: "'Inter', monospace", background: '#FFFBEB',
          boxSizing: 'border-box',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = '#1B4F8A'; }}
        onBlur={e => { e.currentTarget.style.borderColor = '#D1D5DB'; }}
      />
      <button
        type="submit"
        style={{
          padding: '14px 28px', fontSize: 15, fontWeight: 700,
          background: '#2EAA4A', color: '#fff', border: 'none',
          borderRadius: 10, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(46,170,74,0.3)',
          whiteSpace: 'nowrap',
        }}
      >
        Verify Certificate →
      </button>
    </form>
  );
}
