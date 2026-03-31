'use client';

import { useEffect, useRef, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';
import type { BrandingConfig } from '@/src/types/branding.types';

// ── Default config ─────────────────────────────────────────────────────────────
const DEFAULT: BrandingConfig = {
  platformName: 'Financial Modeler Pro',
  portalTitle: 'Financial Modeler Pro',
  portalSubtitle: 'Professional Real Estate Financial Modeling',
  portalDescription: '',
  footerText: '© Financial Modeler Pro',
  portalLogoType: 'emoji',
  portalLogoEmoji: '📐',
  portalLogoImage: null,
  platformLogoType: 'emoji',
  platformLogoEmoji: '📐',
  platformLogoImage: null,
  primaryColor: '#1B4F8A',
  secondaryColor: '#2EAA4A',
  whiteLabel: { enabled: false, clientName: '', clientLogo: null, clientPrimaryColor: null },
  platforms: null,
  platformOverrides: {},
  customDomain: null,
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

  input: {
    padding: '8px 12px',
    fontSize: 13,
    border: '1px solid #D1D5DB',
    borderRadius: 7,
    background: '#FFFBEB',
    width: '100%',
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  textarea: {
    padding: '8px 12px',
    fontSize: 13,
    border: '1px solid #D1D5DB',
    borderRadius: 7,
    background: '#FFFBEB',
    width: '100%',
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    minHeight: 72,
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

  logoPreview: {
    width: 80,
    height: 80,
    objectFit: 'contain' as const,
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    background: '#F9FAFB',
  } as React.CSSProperties,

  logoEmojiFallback: {
    width: 80,
    height: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 36,
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    background: '#F9FAFB',
    flexShrink: 0,
  } as React.CSSProperties,

  uploadBtn: {
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: '#1B4F8A',
    background: '#E8F0FB',
    border: '1px solid #BDD0F0',
    borderRadius: 7,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  clearBtn: {
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: '#6B7280',
    background: '#F3F4F6',
    border: '1px solid #D1D5DB',
    borderRadius: 7,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginLeft: 8,
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

  enterpriseBadge: {
    background: '#7C3AED18',
    color: '#7C3AED',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 20,
    border: '1px solid #7C3AED30',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,

  toggleTrack: (on: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    width: 42,
    height: 24,
    borderRadius: 12,
    background: on ? '#1B4F8A' : '#D1D5DB',
    position: 'relative',
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    flexShrink: 0,
    transition: 'background 0.2s',
  }),

  toggleThumb: (on: boolean): React.CSSProperties => ({
    position: 'absolute',
    top: 3,
    left: on ? 21 : 3,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  }),
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

// ── Logo upload field ──────────────────────────────────────────────────────────
interface LogoFieldProps {
  label: string;
  imageValue: string | null;
  emojiValue: string;
  onUpload: (dataUrl: string) => void;
  onClear: () => void;
}

function LogoField({ label, imageValue, emojiValue, onUpload, onClear }: LogoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('Image is larger than 2 MB. Please choose a smaller file.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpload(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div>
      <span style={S.label}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {imageValue ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageValue} alt={label} style={S.logoPreview} />
        ) : (
          <div style={S.logoEmojiFallback}>{emojiValue}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 0 }}>
            <button type="button" onClick={() => inputRef.current?.click()} style={S.uploadBtn}>
              Upload Image
            </button>
            {imageValue && (
              <button type="button" onClick={onClear} style={S.clearBtn}>
                Clear
              </button>
            )}
          </div>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>
            PNG, JPEG, WebP, SVG — max 2 MB
          </span>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
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
    // Allow free typing; only update config when it looks like a valid hex
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showToast(message: string, type: 'success' | 'error') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  function patch(partial: Partial<BrandingConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  function patchWL(partial: Partial<BrandingConfig['whiteLabel']>) {
    setConfig((prev) => ({
      ...prev,
      whiteLabel: { ...prev.whiteLabel, ...partial },
    }));
  }

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/branding?scope=global');
        if (!res.ok) throw new Error('Failed to load');
        const data = (await res.json()) as { config: BrandingConfig | null };
        if (!cancelled) {
          // Merge loaded config on top of DEFAULT so any new BrandingConfig fields
          // are always initialised — prevents undefined fields being dropped on save
          setConfig({ ...DEFAULT, ...(data.config ?? {}) });
        }
      } catch {
        // Non-fatal — use default config
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // ── Save handler ───────────────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/branding" />

      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>
              Branding Settings
            </h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>
              Configure platform identity, logos, colors, and white-label options.
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
          <>
            {/* ── Section 1 — Portal Identity ─────────────────────────────── */}
            <section style={S.card}>
              <div style={S.sectionTitle}>
                <span>🏷️</span> Portal Identity
              </div>

              <div style={S.grid2}>
                <div>
                  <label style={S.label}>Portal Title</label>
                  <input
                    type="text"
                    value={config.portalTitle}
                    onChange={(e) => patch({ portalTitle: e.target.value })}
                    style={S.input}
                    placeholder="Financial Modeler Pro"
                  />
                </div>
                <div>
                  <label style={S.label}>Portal Subtitle</label>
                  <input
                    type="text"
                    value={config.portalSubtitle}
                    onChange={(e) => patch({ portalSubtitle: e.target.value })}
                    style={S.input}
                    placeholder="Professional Real Estate Financial Modeling"
                  />
                </div>
              </div>

              <div style={S.fieldGroup}>
                <label style={S.label}>Portal Description</label>
                <textarea
                  value={config.portalDescription}
                  onChange={(e) => patch({ portalDescription: e.target.value })}
                  style={S.textarea}
                  placeholder="Brief description shown on the portal landing page…"
                />
              </div>

              <div style={S.grid2}>
                <div>
                  <label style={S.label}>Platform Name</label>
                  <input
                    type="text"
                    value={config.platformName}
                    onChange={(e) => patch({ platformName: e.target.value })}
                    style={S.input}
                    placeholder="Financial Modeler Pro"
                  />
                </div>
                <div>
                  <label style={S.label}>Footer Text</label>
                  <input
                    type="text"
                    value={config.footerText}
                    onChange={(e) => patch({ footerText: e.target.value })}
                    style={S.input}
                    placeholder="© Financial Modeler Pro"
                  />
                </div>
              </div>
            </section>

            {/* ── Section 2 — Logos ───────────────────────────────────────── */}
            <section style={S.card}>
              <div style={S.sectionTitle}>
                <span>🖼️</span> Logos
              </div>

              <div style={S.grid2}>
                <LogoField
                  label="Portal Logo"
                  imageValue={config.portalLogoImage}
                  emojiValue={config.portalLogoEmoji}
                  onUpload={(dataUrl) => patch({ portalLogoImage: dataUrl, portalLogoType: 'image' })}
                  onClear={() => patch({ portalLogoImage: null, portalLogoType: 'emoji' })}
                />
                <LogoField
                  label="Platform Logo"
                  imageValue={config.platformLogoImage}
                  emojiValue={config.platformLogoEmoji}
                  onUpload={(dataUrl) => patch({ platformLogoImage: dataUrl, platformLogoType: 'image' })}
                  onClear={() => patch({ platformLogoImage: null, platformLogoType: 'emoji' })}
                />
              </div>
            </section>

            {/* ── Section 3 — Brand Colors ─────────────────────────────────── */}
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

              {/* Live preview strip */}
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

            {/* ── Section 4 — White-Label ──────────────────────────────────── */}
            <section style={S.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🏷️</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B' }}>White-Label</span>
                  <span style={S.enterpriseBadge}>Enterprise Only</span>
                </div>

                {/* Enable toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>
                    {config.whiteLabel.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.whiteLabel.enabled}
                    onClick={() => patchWL({ enabled: !config.whiteLabel.enabled })}
                    style={S.toggleTrack(config.whiteLabel.enabled)}
                  >
                    <span style={S.toggleThumb(config.whiteLabel.enabled)} />
                  </button>
                </div>
              </div>

              <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 20, fontStyle: 'italic' }}>
                White-label features are available on Enterprise plan. Enable the toggle above to configure.
              </p>

              <fieldset disabled={!config.whiteLabel.enabled} style={{ border: 'none', padding: 0, margin: 0, opacity: config.whiteLabel.enabled ? 1 : 0.45 }}>
                <div style={S.grid2}>
                  <div style={S.fieldGroup}>
                    <label style={S.label}>Client Name</label>
                    <input
                      type="text"
                      value={config.whiteLabel.clientName}
                      onChange={(e) => patchWL({ clientName: e.target.value })}
                      style={S.input}
                      placeholder="Acme Capital"
                      disabled={!config.whiteLabel.enabled}
                    />
                  </div>

                  <div style={S.fieldGroup}>
                    <label style={S.label}>Client Primary Color</label>
                    <div style={S.colorRow}>
                      <input
                        type="color"
                        value={
                          config.whiteLabel.clientPrimaryColor &&
                          /^#[0-9A-Fa-f]{6}$/.test(config.whiteLabel.clientPrimaryColor)
                            ? config.whiteLabel.clientPrimaryColor
                            : '#000000'
                        }
                        onChange={(e) => patchWL({ clientPrimaryColor: e.target.value })}
                        disabled={!config.whiteLabel.enabled}
                        style={S.colorSwatch}
                      />
                      <input
                        type="text"
                        value={config.whiteLabel.clientPrimaryColor ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const clean = raw.startsWith('#') ? raw : '#' + raw;
                          if (/^#[0-9A-Fa-f]{0,6}$/.test(clean)) {
                            patchWL({ clientPrimaryColor: clean });
                          }
                        }}
                        maxLength={7}
                        placeholder="#000000"
                        disabled={!config.whiteLabel.enabled}
                        style={S.hexInput}
                      />
                    </div>
                  </div>
                </div>

                <div style={S.fieldGroup}>
                  <LogoField
                    label="Client Logo"
                    imageValue={config.whiteLabel.clientLogo}
                    emojiValue="🏢"
                    onUpload={(dataUrl) => patchWL({ clientLogo: dataUrl })}
                    onClear={() => patchWL({ clientLogo: null })}
                  />
                </div>
              </fieldset>
            </section>
          </>
        )}
      </main>

      {/* Toast notification */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Spinner keyframe */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
