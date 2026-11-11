'use client';

import { useEffect, useState } from 'react';

/** Admin On/Off for the logo intro, per site (main website, or the Modeling Hub with site="app"). Reads / writes /api/admin/intro-animation. */
export function IntroAnimationCard({ onMessage, site = 'main' }: { onMessage?: (msg: string, type: 'success' | 'error') => void; site?: 'main' | 'app' }) {
  const api = site === 'app' ? '/api/admin/intro-animation?site=app' : '/api/admin/intro-animation';
  const isApp = site === 'app';
  const [enabled, setEnabled] = useState(!isApp);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(api)
      .then((r) => r.json())
      .then((j: { enabled?: boolean }) => setEnabled(j.enabled ?? !isApp))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [api, isApp]);

  async function toggle() {
    setSaving(true);
    try {
      const res = await fetch(api, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) });
      if (!res.ok) { onMessage?.('Update failed', 'error'); return; }
      const j = (await res.json()) as { enabled?: boolean };
      const next = j.enabled ?? !enabled;
      setEnabled(next);
      onMessage?.(`${isApp ? 'Modeling Hub' : 'Main website'} logo intro is ${next ? 'ON' : 'OFF'}`, 'success');
    } catch {
      onMessage?.('Update failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;
  return (
    <div data-testid={isApp ? 'intro-animation-card-app' : 'intro-animation-card'} style={{ background: enabled ? '#F0FFF4' : '#F8FAFC', border: `1px solid ${enabled ? '#BBF7D0' : '#E2E8F0'}`, borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>{isApp ? '🎬 Logo intro on the Modeling Hub' : '🎬 Logo intro on the main website'}</div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>
            {isApp
              ? (enabled
                ? 'ON. The logo animation plays once per browser session when someone opens app.financialmodelerpro.com (the hub home or a public platform page), then fades into the page. Never on sign-in, register, dashboard, pricing, the platforms themselves or admin, and skipped for visitors who prefer reduced motion.'
                : 'OFF. No intro plays; the Modeling Hub opens directly.')
              : (enabled
                ? 'ON. The logo animation plays once per browser session when a visitor opens a public page of financialmodelerpro.com, then fades into the page. Never on the Training or Modeling hubs, admin, sign-in or pricing pages, and skipped for visitors who prefer reduced motion.'
                : 'OFF. No intro plays; the website opens directly.')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: enabled ? '#E8F7EC' : '#F1F5F9', color: enabled ? '#1A7A30' : '#475569' }}>{enabled ? 'ON' : 'OFF'}</span>
          <button onClick={toggle} disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', background: enabled ? '#B45309' : '#1A7A30', color: '#fff', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Updating…' : enabled ? 'Turn OFF' : 'Turn ON'}
          </button>
        </div>
      </div>
    </div>
  );
}
