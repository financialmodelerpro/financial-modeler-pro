'use client';

import { useEffect, useRef, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';
import type { BrandingConfig } from '@/src/types/branding.types';

// ── Default config ─────────────────────────────────────────────────────────────
const DEFAULT: BrandingConfig = {
  platformName: 'Financial Modeler Pro',
  platformLogoType: 'emoji',
  platformLogoEmoji: '📐',
  platformLogoImage: null,
  primaryColor: '#1B4F8A',
  secondaryColor: '#2EAA4A',
  platforms: null,
  platformOverrides: {},
};

// ── Shared style constants ─────────────────────────────────────────────────────
const S = {
  card: {
    background: '#fff',
    border: '1px solid #E8F0FB',
    borderRadius: 12,
    padding: 28,
    marginBottom: 24,
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#1B3A6B',
    marginBottom: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as React.CSSProperties,

  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    color: '#374151',
    marginBottom: 6,
    letterSpacing: '0.04em',
  } as React.CSSProperties,

  fieldGroup: {
    marginBottom: 20,
  } as React.CSSProperties,

  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
    marginBottom: 20,
  } as React.CSSProperties,

  colorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,

  colorSwatch: {
    width: 40,
    height: 40,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  } as React.CSSProperties,

  hexInput: {
    padding: '8px 12px',
    fontSize: 13,
    border: '1px solid #D1D5DB',
    borderRadius: 7,
    background: '#FFFBEB',
    width: 120,
    outline: 'none',
    fontFamily: 'inherit',
    letterSpacing: '0.04em',
  } as React.CSSProperties,
};

// ── Toast component ────────────────────────────────────────────────────────────
function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 32,
      right: 32,
      padding: '12px 20px',
      borderRadius: 10,
      fontSize: 13,
      fontWeight: 600,
      color: '#fff',
      background: type === 'success' ? '#1A7A30' : '#DC2626',
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      {message}
    </div>
  );
}

// ── Color picker field ─────────────────────────────────────────────────────────
interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

function ColorField({ label, value, onChange }: ColorFieldProps) {
  function handleHexInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const clean = raw.startsWith('#') ? raw : '#' + raw;
    if (/^#[0-9A-Fa-f]{0,6}$/.test(clean)) {
      onChange(clean);
    }
  }

  return (
    <div style={S.fieldGroup}>
      <span style={S.label}>{label}</span>
      <div style={S.colorRow}>
        <input
          type="color"
          value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={S.colorSwatch}
        />
        <input
          type="text"
          value={value}
          onChange={handleHexInput}
          maxLength={7}
          placeholder="#000000"
          style={S.hexInput}
        />
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 6,
          background: /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#ccc',
          border: '1px solid #E5E7EB',
          flexShrink: 0,
        }} />
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function BrandingAdminPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [config, setConfig] = useState<BrandingConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, type: 'success' | 'error') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  function patch(partial: Partial<BrandingConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/branding?scope=global');
        if (!res.ok) throw new Error('Failed to load');
        const data = (await res.json()) as { config: BrandingConfig | null };
        if (!cancelled) {
          setConfig({ ...DEFAULT, ...(data.config ?? {}) });
        }
      } catch {
        // Non-fatal - use default config
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, scope: 'global' }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Save failed');
      }
      showToast('Branding saved', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/branding" />

      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
              Branding Settings
            </h1>
            <p style={{ fontSize: 13, color: '#6B7280', maxWidth: 640 }}>
              Brand colors that drive the CSS theme tokens (<code style={{ fontFamily: 'monospace', fontSize: 12 }}>--color-primary</code>, <code style={{ fontFamily: 'monospace', fontSize: 12 }}>--color-secondary</code>) across the platform. Page logos, headers and copy are managed in <strong>Header Settings</strong> and <strong>Page Builder</strong>.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            style={{
              background: saving ? '#4B7BBF' : '#1B4F8A',
              color: '#fff',
              padding: '10px 24px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              border: 'none',
              cursor: saving || loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'inherit',
              flexShrink: 0,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {saving ? (
              <>
                <span style={{
                  width: 14,
                  height: 14,
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 0.7s linear infinite',
                }} />
                Saving…
              </>
            ) : (
              'Save Branding'
            )}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6B7280', fontSize: 14 }}>
            Loading branding config…
          </div>
        ) : (
          <section style={S.card}>
            <div style={S.sectionTitle}>
              <span>🎨</span> Brand Colors
            </div>

            <div style={S.grid2}>
              <ColorField
                label="Primary Color"
                value={config.primaryColor}
                onChange={(hex) => patch({ primaryColor: hex })}
              />
              <ColorField
                label="Secondary Color"
                value={config.secondaryColor}
                onChange={(hex) => patch({ secondaryColor: hex })}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
              <div style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                background: /^#[0-9A-Fa-f]{6}$/.test(config.primaryColor) ? config.primaryColor : '#1B4F8A',
              }} />
              <div style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                background: /^#[0-9A-Fa-f]{6}$/.test(config.secondaryColor) ? config.secondaryColor : '#2EAA4A',
              }} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <span style={{ flex: 1, fontSize: 10, color: '#9CA3AF', textAlign: 'center' }}>Primary</span>
              <span style={{ flex: 1, fontSize: 10, color: '#9CA3AF', textAlign: 'center' }}>Secondary</span>
            </div>
          </section>
        )}
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
