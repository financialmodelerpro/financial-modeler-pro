'use client';

/**
 * /admin/payments - Payment provider configuration
 *
 * Provider-agnostic: pick the active provider (none / Paddle / PayPro) and set
 * each provider's API key, API secret, webhook secret, and sandbox/live mode.
 *
 * Secrets are WRITE-ONLY in the UI: the screen never receives a stored secret
 * (the API returns only "is set" booleans). Leaving a field blank keeps the
 * stored secret; typing replaces it. While the active provider is "none",
 * checkout stays the clearly-labelled placeholder (handled by the checkout
 * route), so this screen never changes enforcement or the resolver.
 *
 * No em dashes in this file.
 */
import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';

type ActiveProvider = 'none' | 'paddle' | 'paypro';
interface MaskedProvider { configured: boolean; has_api_key: boolean; has_api_secret: boolean; has_webhook_secret: boolean; sandbox: boolean }
interface MaskedConfig { active_provider: ActiveProvider; paddle: MaskedProvider; paypro: MaskedProvider }

const NAVY = '#0D2E5A';
const PROVIDERS: { key: 'paddle' | 'paypro'; label: string }[] = [
  { key: 'paddle', label: 'Paddle' },
  { key: 'paypro', label: 'PayPro' },
];

interface Draft { api_key: string; api_secret: string; webhook_secret: string; sandbox: boolean }
const emptyDraft = (): Draft => ({ api_key: '', api_secret: '', webhook_secret: '', sandbox: true });

export default function AdminPaymentsPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<MaskedConfig | null>(null);
  const [active, setActive] = useState<ActiveProvider>('none');
  const [drafts, setDrafts] = useState<Record<'paddle' | 'paypro', Draft>>({ paddle: emptyDraft(), paypro: emptyDraft() });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const applyConfig = useCallback((c: MaskedConfig) => {
    setConfig(c);
    setActive(c.active_provider);
    setDrafts({
      paddle: { ...emptyDraft(), sandbox: c.paddle.sandbox },
      paypro: { ...emptyDraft(), sandbox: c.paypro.sandbox },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payments/config').then((r) => r.json());
      if (res.config) applyConfig(res.config);
    } catch {
      showToast('Failed to load payment config', 'error');
    } finally {
      setLoading(false);
    }
  }, [applyConfig, showToast]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const body = {
        active_provider: active,
        paddle: { api_key: drafts.paddle.api_key, api_secret: drafts.paddle.api_secret, webhook_secret: drafts.paddle.webhook_secret, sandbox: drafts.paddle.sandbox },
        paypro: { api_key: drafts.paypro.api_key, api_secret: drafts.paypro.api_secret, webhook_secret: drafts.paypro.webhook_secret, sandbox: drafts.paypro.sandbox },
      };
      const res = await fetch('/api/admin/payments/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.error) { showToast(res.error, 'error'); return; }
      if (res.config) applyConfig(res.config);
      showToast('Payment config saved', 'success');
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [active, drafts, applyConfig, showToast]);

  if (authLoading) return null;

  const setDraft = (provider: 'paddle' | 'paypro', patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/payments" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }} data-testid="admin-payments-page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0 }}>Payment Providers</h1>
          <button onClick={save} disabled={saving} data-testid="save-payment-config"
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', cursor: saving ? 'default' : 'pointer', fontWeight: 700, fontSize: 13, color: '#fff', background: saving ? '#9CA3AF' : '#2EAA4A' }}>
            {saving ? 'Saving...' : 'Save config'}
          </button>
        </div>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 0, marginBottom: 20, maxWidth: 880 }}>
          Choose the active payment provider and store its credentials. Secrets are kept server-side only and are never shown here, fields display whether a secret is set and accept a new value to replace it. While the active provider is <b>None</b>, checkout shows the placeholder and nothing is charged. This screen does not change the resolver, gate, or enforcement.
        </p>

        {loading ? (
          <div style={{ color: '#64748b', fontSize: 14 }}>Loading...</div>
        ) : (
          <div style={{ maxWidth: 760 }}>
            {/* Active provider */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 10 }}>Active provider</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['none', 'paddle', 'paypro'] as ActiveProvider[]).map((p) => (
                  <button key={p} onClick={() => setActive(p)} data-testid={`active-provider-${p}`}
                    style={{ padding: '8px 18px', borderRadius: 8, border: `1.5px solid ${active === p ? NAVY : '#cbd5e1'}`, background: active === p ? NAVY : '#fff', color: active === p ? '#fff' : '#475569', fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize' }}>
                    {p === 'none' ? 'None (placeholder)' : p}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
                Current: <b style={{ color: NAVY }}>{active === 'none' ? 'None, checkout is a placeholder' : active}</b>. Both adapters are stubbed in this release, selecting one keeps checkout a placeholder until that adapter is implemented.
              </div>
            </div>

            {/* Per-provider credentials */}
            {PROVIDERS.map(({ key, label }) => {
              const mask = config?.[key];
              const d = drafts[key];
              return (
                <div key={key} data-testid={`provider-card-${key}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>{label}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: mask?.configured ? '#E8F7EC' : '#FEF3C7', color: mask?.configured ? '#1A7A30' : '#92400E' }}>
                      {mask?.configured ? 'Credentials set' : 'Not configured'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <SecretField label="API key" testid={`${key}-api-key`} isSet={!!mask?.has_api_key} value={d.api_key} onChange={(v) => setDraft(key, { api_key: v })} />
                    <SecretField label="API secret" testid={`${key}-api-secret`} isSet={!!mask?.has_api_secret} value={d.api_secret} onChange={(v) => setDraft(key, { api_secret: v })} />
                    <SecretField label="Webhook secret" testid={`${key}-webhook-secret`} isSet={!!mask?.has_webhook_secret} value={d.webhook_secret} onChange={(v) => setDraft(key, { webhook_secret: v })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                      <input type="checkbox" data-testid={`${key}-sandbox`} checked={d.sandbox} onChange={(e) => setDraft(key, { sandbox: e.target.checked })} />
                      Sandbox mode {d.sandbox ? '(test)' : '(live)'}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {toast && (
          <div style={{ position: 'fixed', bottom: 20, right: 20, padding: '10px 18px', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, background: toast.type === 'success' ? '#2EAA4A' : '#DC2626', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 2000 }}>
            {toast.msg}
          </div>
        )}
      </main>
    </div>
  );
}

function SecretField({ label, testid, isSet, value, onChange }: { label: string; testid: string; isSet: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        {label}
        <span style={{ fontSize: 10, fontWeight: 700, color: isSet ? '#1A7A30' : '#94a3b8' }}>{isSet ? '• set' : '• not set'}</span>
      </div>
      <input type="password" autoComplete="new-password" data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={isSet ? 'Leave blank to keep current value' : 'Enter value'}
        style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 6, fontFamily: 'monospace' }} />
    </label>
  );
}
