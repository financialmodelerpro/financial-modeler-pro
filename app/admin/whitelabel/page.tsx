'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useBrandingStore } from '@/src/core/core-state';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface UserRow { id: string; email: string; name: string | null; subscription_plan: string; }

const wlLabel: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: '#6B7280', marginBottom: 4,
};
const wlInput: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid #D1D5DB', borderRadius: 6,
  background: '#FFFBEB', fontFamily: 'Inter,sans-serif',
  boxSizing: 'border-box', outline: 'none',
};

export default function WhiteLabelPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { branding, setBranding } = useBrandingStore();

  const [users,     setUsers]     = useState<UserRow[]>([]);
  const [wlScope,   setWlScope]   = useState('global');
  const [wlDraft,   setWlDraft]   = useState(() => ({ ...branding.whiteLabel }));
  const [wlSaving,  setWlSaving]  = useState(false);
  const [wlSaved,   setWlSaved]   = useState(false);
  const [wlLoading, setWlLoading] = useState(false);
  const [toast,     setToast]     = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && session.user.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    fetch('/api/admin/users').then((r) => r.json()).then((j) => setUsers(j.users ?? [])).catch(() => {});
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadWlBranding = useCallback(async (scope: string) => {
    setWlLoading(true);
    const res = await fetch(`/api/branding?scope=${encodeURIComponent(scope)}`);
    if (res.ok) {
      const json = await res.json();
      setWlDraft(json.config?.whiteLabel ?? { enabled: false, clientName: '', clientLogo: null, clientPrimaryColor: null });
    }
    setWlLoading(false);
  }, []);

  const handleScopeChange = async (scope: string) => {
    setWlScope(scope);
    if (scope === 'global') setWlDraft({ ...branding.whiteLabel });
    else await loadWlBranding(scope);
  };

  const saveWlBranding = async () => {
    setWlSaving(true);
    const configToSave = wlScope === 'global'
      ? { ...branding, whiteLabel: wlDraft }
      : { whiteLabel: wlDraft };
    const res = await fetch('/api/branding', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configToSave, scope: wlScope }),
    });
    if (res.ok) {
      if (wlScope === 'global') setBranding({ ...branding, whiteLabel: wlDraft });
      setWlSaved(true); setTimeout(() => setWlSaved(false), 2500);
    } else { showToast('Failed to save branding'); }
    setWlSaving(false);
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🏷️ White-Label Settings</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>
          Configure branding globally or per-user. Per-user settings override the global defaults for that user.
        </p>

        <div style={{ maxWidth: 720 }}>
          {/* Scope selector */}
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <label style={{ ...wlLabel, marginBottom: 12 }}>Apply branding to</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleScopeChange('global')}
                style={{
                  padding: '7px 18px', fontSize: 13, fontWeight: 700, borderRadius: 20, cursor: 'pointer', fontFamily: 'Inter,sans-serif',
                  border: wlScope === 'global' ? '2px solid #1B4F8A' : '1px solid #D1D5DB',
                  background: wlScope === 'global' ? '#E8F0FB' : '#fff',
                  color: wlScope === 'global' ? '#1B4F8A' : '#6B7280',
                }}
              >
                🌐 Global (all users)
              </button>
              <span style={{ fontSize: 12, color: '#9CA3AF' }}>or select a user:</span>
              <select
                value={wlScope === 'global' ? '' : wlScope}
                onChange={(e) => e.target.value && handleScopeChange(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff', fontFamily: 'Inter,sans-serif', minWidth: 240 }}
              >
                <option value="">- Pick a user -</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email} {u.subscription_plan !== 'free' ? `(${u.subscription_plan})` : ''}
                  </option>
                ))}
              </select>
            </div>
            {wlScope !== 'global' && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#92400E', background: '#FEF3C7', padding: '5px 12px', borderRadius: 6, display: 'inline-block' }}>
                ⚠️ Editing branding for: <strong>{users.find((u) => u.id === wlScope)?.email ?? wlScope}</strong> - overrides global for this user only
              </div>
            )}
          </div>

          {/* Fields */}
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 24 }}>
            {wlLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#6B7280' }}>Loading branding config…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="wl-enabled" checked={!!wlDraft?.enabled}
                    onChange={(e) => setWlDraft((d) => ({ ...d, enabled: e.target.checked }))} />
                  <label htmlFor="wl-enabled" style={{ fontSize: 14, fontWeight: 600, color: '#1B3A6B', cursor: 'pointer' }}>
                    Enable white-label mode {wlScope !== 'global' ? 'for this user' : 'globally'}
                  </label>
                </div>

                <div>
                  <label style={wlLabel}>Client Name</label>
                  <input style={wlInput} value={wlDraft?.clientName ?? ''} placeholder="e.g. Acme Capital"
                    onChange={(e) => setWlDraft((d) => ({ ...d, clientName: e.target.value }))} />
                </div>

                <div>
                  <label style={wlLabel}>Primary Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={wlDraft?.clientPrimaryColor ?? '#1E3A8A'}
                      onChange={(e) => setWlDraft((d) => ({ ...d, clientPrimaryColor: e.target.value }))}
                      style={{ width: 40, height: 36, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4 }} />
                    <input style={{ ...wlInput, flex: 1 }} value={wlDraft?.clientPrimaryColor ?? ''} placeholder="#1E3A8A"
                      onChange={(e) => setWlDraft((d) => ({ ...d, clientPrimaryColor: e.target.value }))} />
                  </div>
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={wlLabel}>Client Logo URL <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(image URL or data-URL)</span></label>
                  <input style={wlInput} value={wlDraft?.clientLogo ?? ''} placeholder="https://example.com/logo.png"
                    onChange={(e) => setWlDraft((d) => ({ ...d, clientLogo: e.target.value || null }))} />
                </div>

                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', paddingTop: 8, borderTop: '1px solid #F3F4F6' }}>
                  {wlScope !== 'global' && (
                    <button onClick={() => loadWlBranding(wlScope)}
                      style={{ padding: '8px 16px', background: '#fff', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'Inter,sans-serif' }}>
                      ↺ Reset
                    </button>
                  )}
                  <button onClick={saveWlBranding} disabled={wlSaving}
                    style={{ padding: '8px 24px', background: wlSaved ? '#1A7A30' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', opacity: wlSaving ? 0.7 : 1 }}>
                    {wlSaving ? '…' : wlSaved ? '✓ Saved!' : '💾 Save White-Label'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
