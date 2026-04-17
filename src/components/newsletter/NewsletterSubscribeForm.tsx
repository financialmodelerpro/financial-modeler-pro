'use client';

import { useState, FormEvent } from 'react';

export function NewsletterSubscribeForm() {
  const [email, setEmail] = useState('');
  const [hubs, setHubs] = useState<Set<string>>(new Set(['training']));
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  function toggleHub(hub: string) {
    setHubs(prev => {
      const next = new Set(prev);
      if (next.has(hub)) next.delete(hub); else next.add(hub);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || hubs.size === 0) return;
    setState('loading');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), hubs: Array.from(hubs) }),
      });
      const data = await res.json();
      if (data.ok) {
        setState('success');
        setMessage(data.message ?? "You're subscribed!");
      } else {
        setState('error');
        setMessage(data.message ?? 'Something went wrong.');
      }
    } catch {
      setState('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  if (state === 'success') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#2EAA4A', fontSize: 18 }}>✓</span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{message}</span>
      </div>
    );
  }

  const checkboxStyle = (checked: boolean): React.CSSProperties => ({
    width: 14, height: 14, borderRadius: 3, border: `2px solid ${checked ? '#2EAA4A' : 'rgba(255,255,255,0.3)'}`,
    background: checked ? '#2EAA4A' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
  });

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 280 }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} onClick={() => toggleHub('training')}>
          <div style={checkboxStyle(hubs.has('training'))}>
            {hubs.has('training') && <span style={{ color: '#fff', fontSize: 8, fontWeight: 800, lineHeight: 1 }}>✓</span>}
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Training Hub</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} onClick={() => toggleHub('modeling')}>
          <div style={checkboxStyle(hubs.has('modeling'))}>
            {hubs.has('modeling') && <span style={{ color: '#fff', fontSize: 8, fontWeight: 800, lineHeight: 1 }}>✓</span>}
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Modeling Hub</span>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Your email"
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 12, outline: 'none', minWidth: 0,
          }}
        />
        <button
          type="submit"
          disabled={state === 'loading' || hubs.size === 0}
          style={{
            padding: '6px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
            background: '#2EAA4A', color: '#fff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
            opacity: state === 'loading' || hubs.size === 0 ? 0.5 : 1,
          }}
        >
          {state === 'loading' ? '...' : 'Subscribe'}
        </button>
      </div>
      {state === 'error' && (
        <div style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>{message}</div>
      )}
    </form>
  );
}
