'use client';

import { useEffect, useState } from 'react';

interface Props {
  onMessage?: (msg: string, type: 'success' | 'error') => void;
}

/**
 * Admin switch for new-device verification (the emailed one-time code) across
 * both hubs. `enabled` = verification is REQUIRED. Reads / writes
 * /api/admin/device-verification.
 */
export function DeviceVerificationCard({ onMessage }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/device-verification')
      .then(r => r.json())
      .then((j: { enabled?: boolean }) => setEnabled(j.enabled ?? true))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function toggle() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/device-verification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) { onMessage?.('Update failed', 'error'); return; }
      const j = (await res.json()) as { enabled?: boolean };
      const next = j.enabled ?? !enabled;
      setEnabled(next);
      onMessage?.(next ? 'New-device verification is now REQUIRED' : 'New-device verification is now OFF', 'success');
    } catch {
      onMessage?.('Update failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div style={{ background: enabled ? '#F0FFF4' : '#FFF7ED', border: `1px solid ${enabled ? '#BBF7D0' : '#FED7AA'}`, borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
            🔐 New-Device Verification
          </div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>
            {enabled
              ? 'ON. Signing in from a new device requires a one-time code emailed to the user before they can continue (Training + Modeling hubs). Known devices stay trusted for 30 days.'
              : 'OFF. Sign-in works without the emailed one-time code on new devices. Use this to unblock users who report not receiving the code, then turn it back on.'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: enabled ? '#E8F7EC' : '#FFEDD5', color: enabled ? '#1A7A30' : '#9A3412' }}>
            {enabled ? 'REQUIRED' : 'OFF'}
          </span>
          <button onClick={toggle} disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', background: enabled ? '#B45309' : '#1A7A30', color: '#fff', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Updating…' : enabled ? 'Turn OFF' : 'Turn ON'}
          </button>
        </div>
      </div>
    </div>
  );
}
