'use client';

import React from 'react';
import { BrandingConfig } from '../types/branding.types';
import { DEFAULT_BRANDING, PLATFORM_REGISTRY, USER_SUBSCRIPTION } from '../core/branding';
import ColorPicker from './ColorPicker';
import OfficeColorPicker from './OfficeColorPicker';

// ── Colour preset themes ───────────────────────────────────────────────────────
const COLOR_THEMES = [
  { name: 'Navy Blue',     primary: '#1E3A8A', secondary: '#3B82F6' },
  { name: 'Midnight',      primary: '#1E1B4B', secondary: '#6366F1' },
  { name: 'Forest Green',  primary: '#14532D', secondary: '#22C55E' },
  { name: 'Royal Purple',  primary: '#581C87', secondary: '#A855F7' },
  { name: 'Crimson',       primary: '#7F1D1D', secondary: '#EF4444' },
  { name: 'Teal Ocean',    primary: '#0C4A6E', secondary: '#0EA5E9' },
  { name: 'Charcoal',      primary: '#1F2937', secondary: '#6B7280' },
  { name: 'Bronze Gold',   primary: '#78350F', secondary: '#F59E0B' },
  { name: 'Slate',         primary: '#1E293B', secondary: '#64748B' },
  { name: 'Emerald',       primary: '#064E3B', secondary: '#10B981' },
  { name: 'Rose',          primary: '#881337', secondary: '#F43F5E' },
  { name: 'Indigo',        primary: '#312E81', secondary: '#818CF8' },
];

type TabId = 'portal' | 'toolbar' | 'colors' | 'cards';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'portal',  icon: '🏠', label: 'Portal Identity' },
  { id: 'toolbar', icon: '⚙️', label: 'Platform Toolbar' },
  { id: 'colors',  icon: '🎨', label: 'Colour Palette' },
  { id: 'cards',   icon: '🗂️', label: 'Platform Cards' },
];

// ── Logo Upload Zone ───────────────────────────────────────────────────────────
interface LogoZoneProps {
  prefix: 'portal' | 'platform';
  title: string;
  subtitle: string;
  draft: BrandingConfig;
  upd: (key: keyof BrandingConfig, val: BrandingConfig[keyof BrandingConfig]) => void;
}

function LogoZone({ prefix, title, subtitle, draft, upd }: LogoZoneProps) {
  const fileRef  = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const d        = draft as unknown as Record<string, unknown>;
  const isImg    = d[prefix + 'LogoType'] === 'image';
  const imgSrc   = d[prefix + 'LogoImage'] as string | null;
  const emoji    = (d[prefix + 'LogoEmoji'] as string) || (prefix === 'portal' ? '💼' : '🏗️');

  const handleFile = (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) { alert('Max file size is 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      upd((prefix + 'LogoImage') as keyof BrandingConfig, e.target?.result as string);
      upd((prefix + 'LogoType')  as keyof BrandingConfig, 'image');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-grey-dark)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 12 }}>{subtitle}</div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Preview */}
        <div style={{
          width: 72, height: 72, flexShrink: 0, borderRadius: 12,
          background: isImg ? 'var(--color-grey-pale)' : 'var(--color-navy-light)',
          border: `2px solid ${isImg ? 'var(--color-grey-light)' : '#BFDBFE'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          {isImg && imgSrc
            ? <img src={imgSrc} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : emoji}
        </div>

        <div style={{ flex: 1 }}>
          {/* Type toggle */}
          <div style={{ display: 'flex', borderRadius: 8, border: '1.5px solid var(--color-grey-light)', overflow: 'hidden', marginBottom: 12, width: 'fit-content' }}>
            {(['emoji', 'image'] as const).map((t) => (
              <button key={t}
                onClick={() => upd((prefix + 'LogoType') as keyof BrandingConfig, t)}
                style={{
                  padding: '6px 16px', border: 'none', cursor: 'pointer',
                  fontFamily: 'Inter,sans-serif', fontSize: 12, fontWeight: 700,
                  background: d[prefix + 'LogoType'] === t ? 'var(--color-navy)' : 'var(--color-grey-pale)',
                  color:      d[prefix + 'LogoType'] === t ? 'white'   : 'var(--color-muted)',
                  transition: 'all 0.15s',
                }}>
                {t === 'emoji' ? '😀 Emoji' : '🖼️ Upload Image'}
              </button>
            ))}
          </div>

          {/* Emoji input */}
          {!isImg && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                style={{
                  border: '1.5px solid var(--color-grey-light)', borderRadius: 8, padding: '8px 12px',
                  fontSize: 20, width: 64, textAlign: 'center',
                  background: 'var(--color-input-bg)', fontFamily: 'Inter,sans-serif',
                }}
                value={emoji}
                onChange={(e) => upd((prefix + 'LogoEmoji') as keyof BrandingConfig, e.target.value)}
                placeholder="💼"
                maxLength={4}
              />
              <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>Type or paste any emoji</span>
            </div>
          )}

          {/* Drop zone */}
          {isImg && (
            <div>
              <input
                ref={fileRef} type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true);  }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: drag ? '2.5px solid var(--color-navy)' : '2px dashed var(--color-grey-light)',
                  borderRadius: 10, padding: '18px 16px', cursor: 'pointer',
                  background: drag ? 'var(--color-navy-light)' : 'var(--color-grey-pale)', textAlign: 'center',
                  transition: 'all 0.15s', marginBottom: imgSrc ? 8 : 0,
                }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{drag ? '📂' : '⬆️'}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: drag ? 'var(--color-navy)' : 'var(--color-grey-dark)', marginBottom: 2 }}>
                  {drag ? 'Drop to upload' : imgSrc ? 'Click or drag to replace' : 'Click or drag image here'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                  PNG · JPG · SVG · WebP · max 2 MB · recommended 64×64 px
                </div>
              </div>
              {imgSrc && (
                <button
                  onClick={() => {
                    upd((prefix + 'LogoImage') as keyof BrandingConfig, null);
                    upd((prefix + 'LogoType')  as keyof BrandingConfig, 'emoji');
                  }}
                  style={{
                    padding: '5px 14px', border: '1px solid #FECACA',
                    borderRadius: 6, background: '#FEF2F2', color: 'var(--color-negative)',
                    cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    fontFamily: 'Inter,sans-serif',
                  }}>
                  ✕ Remove Image
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Field helpers ──────────────────────────────────────────────────────────────
const FL: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: 'var(--color-grey-mid)', marginBottom: 6,
};
const FI: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1.5px solid var(--color-grey-light)',
  borderRadius: 8, fontSize: 13, fontFamily: 'Inter,sans-serif',
  background: 'var(--color-input-bg)', color: 'var(--color-navy)', boxSizing: 'border-box',
  outline: 'none', transition: 'border-color 0.15s',
};
const FTA: React.CSSProperties = {
  ...FI, resize: 'vertical', minHeight: 80, lineHeight: 1.6,
};

// ── Main panel ─────────────────────────────────────────────────────────────────
interface BrandingSettingsPanelProps {
  branding: BrandingConfig;
  onSave: (b: BrandingConfig) => void;
  onClose: () => void;
  isAdmin: boolean;
}

export default function BrandingSettingsPanel({
  branding, onSave, onClose, isAdmin,
}: BrandingSettingsPanelProps) {

  const initDraft = (): BrandingConfig => {
    const d = { ...branding };
    if (!d.platforms || !Array.isArray(d.platforms) || d.platforms.length === 0) {
      d.platforms = PLATFORM_REGISTRY.map((p) => ({
        id: p.id, name: p.name, description: p.description, status: p.status,
      }));
    }
    if (!d.platformName) d.platformName = DEFAULT_BRANDING.platformName;
    if (!d.primaryColor)   d.primaryColor   = DEFAULT_BRANDING.primaryColor;
    if (!d.secondaryColor) d.secondaryColor = DEFAULT_BRANDING.secondaryColor;
    return d;
  };

  const [draft,  setDraft]  = React.useState<BrandingConfig>(initDraft);
  const [tab,    setTab]    = React.useState<TabId>('portal');
  const [saved,  setSaved]  = React.useState(false);
  const [slideIn] = React.useState(true);

  const upd = (key: keyof BrandingConfig, val: BrandingConfig[keyof BrandingConfig]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  // ── Non-admin guard ──
  if (!isAdmin) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}>
        <div style={{ background: 'var(--color-navy-darkest)', borderRadius: 16, padding: '40px 48px', textAlign: 'center', color: 'white', maxWidth: 360, boxShadow: '0 28px 90px rgba(0,0,0,0.55)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Admin Only</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, marginBottom: 24 }}>Branding settings require the Admin role.</div>
          <button onClick={onClose} style={{ padding: '9px 28px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'Inter,sans-serif' }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const handleSave = () => {
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (!window.confirm('Reset all branding to factory defaults? This cannot be undone.')) return;
    setDraft({
      ...DEFAULT_BRANDING,
      platforms: PLATFORM_REGISTRY.map((p) => ({
        id: p.id, name: p.name, description: p.description, status: p.status,
      })),
    });
  };

  // ── Derived preview values ──
  const previewHeaderBg = draft.primaryColor || '#1E3A8A';
  const previewDeep     = darkenHex(previewHeaderBg, 0.28);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 99990, backdropFilter: 'blur(4px)' }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(900px, 96vw)', zIndex: 99999,
        background: 'var(--color-grey-white)', display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 48px rgba(0,0,0,0.22)',
        animation: slideIn ? 'slideInRight 0.28s cubic-bezier(.22,.68,0,1.2)' : undefined,
      }}>

        {/* ── Header ── */}
        <div style={{
          background: previewDeep, padding: '0 28px',
          height: 62, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div>
            <div style={{ fontWeight: 800, color: 'white', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              🎨 Branding Settings
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(239,68,68,0.3)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Admin Only
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
              Changes are saved to your browser and synced to Supabase
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.12)', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
          >✕</button>
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--color-grey-pale)', background: 'var(--color-grey-pale)', flexShrink: 0, overflowX: 'auto' }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '14px 22px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? previewHeaderBg : 'var(--color-grey-mid)',
              borderBottom: tab === t.id ? `3px solid ${previewHeaderBg}` : '3px solid transparent',
              marginBottom: -2, fontFamily: 'Inter,sans-serif', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 15 }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

          {/* ══════════════════════════════════════════
              TAB 1 — PORTAL IDENTITY
          ══════════════════════════════════════════ */}
          {tab === 'portal' && (
            <div>
              <SectionBanner color="#EFF6FF" border="#BFDBFE" text="Customise everything shown on the portal hub — header text, welcome message, footer, and the portal logo." />

              <FieldGroup label="Portal Title" hint="Shown in the portal header bar">
                <input style={FI} value={draft.portalTitle}
                  onChange={(e) => upd('portalTitle', e.target.value)}
                  placeholder="e.g. Financial Modeler Pro" />
              </FieldGroup>

              <FieldGroup label="Portal Subtitle" hint="Small caps text below the title">
                <input style={FI} value={draft.portalSubtitle}
                  onChange={(e) => upd('portalSubtitle', e.target.value)}
                  placeholder="e.g. FINANCIAL MODELING HUB" />
              </FieldGroup>

              <FieldGroup label="Welcome Description" hint="Body text in the welcome banner">
                <textarea style={FTA} value={draft.portalDescription}
                  onChange={(e) => upd('portalDescription', e.target.value)}
                  placeholder="Describe your platform suite…" />
              </FieldGroup>

              <FieldGroup label="Footer Text" hint="Shown in the portal footer bar">
                <input style={FI} value={draft.footerText}
                  onChange={(e) => upd('footerText', e.target.value)}
                  placeholder="e.g. Powered by Financial Modeler Pro" />
              </FieldGroup>

              <Divider />

              <SectionTitle badge="LOGOS" badgeColor="#F0FDF4" badgeText="#166534">Portal Logo</SectionTitle>
              <LogoZone prefix="portal" title="Portal Header Logo"
                subtitle="Displayed in the top-left of the portal header bar"
                draft={draft} upd={upd} />

              <Divider />

              {/* Live preview */}
              <SectionTitle badge="PREVIEW" badgeColor="#FFF7ED" badgeText="#92400E">Live Preview</SectionTitle>
              <div style={{ background: previewDeep, borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
                <div style={{ width: 36, height: 36, background: previewHeaderBg, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }}>
                  {draft.portalLogoType === 'image' && draft.portalLogoImage
                    ? <img src={draft.portalLogoImage} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
                    : draft.portalLogoEmoji || '💼'}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: 'white', fontSize: 13 }}>{draft.portalTitle || '—'}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{draft.portalSubtitle || '—'}</div>
                </div>
              </div>
              <div style={{ background: 'var(--color-grey-white)', border: '1px solid var(--color-grey-light)', borderRadius: 10, padding: '16px 18px', borderLeft: `4px solid ${previewHeaderBg}`, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: 'var(--color-navy-darkest)', fontSize: 14, marginBottom: 4 }}>Welcome to {draft.portalTitle || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--color-grey-mid)', lineHeight: 1.6 }}>{draft.portalDescription || '—'}</div>
              </div>
              <div style={{ background: 'var(--color-grey-pale)', border: '1px solid var(--color-grey-light)', borderRadius: 10, padding: '10px 18px', textAlign: 'center', fontSize: 11, color: 'var(--color-muted)' }}>
                <strong style={{ color: 'var(--color-grey-dark)' }}>{draft.portalTitle || '—'}</strong>
                {' · '}{draft.footerText || '—'}
                {' · '}<span style={{ color: 'var(--color-green-dark)', fontWeight: 600 }}>{USER_SUBSCRIPTION.platforms.length} Platform Active</span>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════
              TAB 2 — PLATFORM TOOLBAR
          ══════════════════════════════════════════ */}
          {tab === 'toolbar' && (
            <div>
              <SectionBanner color="#EFF6FF" border="#BFDBFE" text="Controls the name and logo shown inside the REFM platform toolbar — separate from the portal header." />

              <FieldGroup label="Platform Name" hint="Shown in the platform toolbar (all-caps)">
                <input style={FI} value={draft.platformName || ''}
                  onChange={(e) => upd('platformName', e.target.value)}
                  placeholder="e.g. REFM Platform" />
              </FieldGroup>

              <Divider />

              <SectionTitle badge="LOGO" badgeColor="#F0FDF4" badgeText="#166534">Platform Toolbar Logo</SectionTitle>
              <LogoZone prefix="platform" title="Platform Logo"
                subtitle="Small icon shown next to the platform name in the toolbar"
                draft={draft} upd={upd} />

              {/* Quick-pick emoji grid */}
              {(draft.platformLogoType !== 'image') && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-grey-mid)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Quick Pick</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                    {['🏗️', '🏢', '🌆', '🏙️', '📐', '💼', '🔷', '🏛️', '📊', '🔑', '🏘️', '⬡'].map((icon) => (
                      <button key={icon} onClick={() => upd('platformLogoEmoji', icon)}
                        style={{
                          fontSize: 22, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                          border: 'none', transition: 'all 0.15s',
                          background: draft.platformLogoEmoji === icon ? '#EFF6FF' : '#F9FAFB',
                          boxShadow: draft.platformLogoEmoji === icon ? `0 0 0 2.5px ${previewHeaderBg}` : '0 0 0 1px #E5E7EB',
                        }}>
                        {icon}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <Divider />

              {/* Toolbar preview */}
              <SectionTitle badge="PREVIEW" badgeColor="#FFF7ED" badgeText="#92400E">Toolbar Preview</SectionTitle>
              <div style={{ background: previewDeep, borderRadius: 10, padding: '0 18px', height: 48, display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.2)' }}>
                <div style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.12)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {draft.platformLogoType === 'image' && draft.platformLogoImage
                    ? <img src={draft.platformLogoImage} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
                    : draft.platformLogoEmoji || '🏗️'}
                </div>
                <span style={{ color: 'white', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {draft.platformName || 'REFM Platform'}
                </span>
                <div style={{ flex: 1 }} />
                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 8px', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>v40</div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════
              TAB 3 — COLOUR PALETTE
          ══════════════════════════════════════════ */}
          {tab === 'colors' && (
            <div>
              <SectionBanner color="#FFF7ED" border="#FED7AA" text="Pick from the Office-style palette, or use the full colour canvas for any custom colour. Changes are reflected instantly in the preview." />

              {/* ── OFFICE-STYLE QUICK PICKERS ── */}
              <SectionTitle badge="PALETTE" badgeColor="#EFF6FF" badgeText="#1E40AF">Colour Palette</SectionTitle>
              <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
                <OfficeColorPicker
                  label="Primary Colour"
                  desc="Header, toolbar, buttons & active states"
                  value={draft.primaryColor || '#1B4F8A'}
                  onChange={(v) => v && upd('primaryColor', v)}
                />
                <OfficeColorPicker
                  label="Secondary Colour"
                  desc="Accent links, badges & highlights"
                  value={draft.secondaryColor || '#3B82F6'}
                  onChange={(v) => v && upd('secondaryColor', v)}
                />
              </div>

              <Divider />

              {/* ── FULL CANVAS PICKERS ── */}
              <SectionTitle badge="CUSTOM" badgeColor="#F5F3FF" badgeText="#6D28D9">Fine-Tune with Canvas Picker</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
                <ColorPicker
                  label="Primary Colour"
                  desc="Header, toolbar, buttons & active states"
                  value={draft.primaryColor || '#1B4F8A'}
                  onChange={(v) => upd('primaryColor', v)}
                />
                <ColorPicker
                  label="Secondary Colour"
                  desc="Accent links, badges & highlight elements"
                  value={draft.secondaryColor || '#3B82F6'}
                  onChange={(v) => upd('secondaryColor', v)}
                />
              </div>

              {/* Live colour preview */}
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--color-grey-light)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', marginBottom: 32 }}>
                {/* Toolbar mockup */}
                <div style={{ background: darkenHex(draft.primaryColor || '#1E3A8A', 0.28), padding: '0 16px', height: 46, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🏗️</div>
                  <span style={{ color: 'white', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{draft.platformName || 'REFM Platform'}</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ background: draft.primaryColor || '#1E3A8A', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: 'white', fontWeight: 600 }}>💾 Save</div>
                  <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>← Portal</div>
                </div>
                {/* Portal header mockup */}
                <div style={{ background: darkenHex(draft.primaryColor || '#1E3A8A', 0.14), padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 30, height: 30, background: draft.primaryColor || '#1E3A8A', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💼</div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'white', fontSize: 12 }}>{draft.portalTitle || 'Financial Modeler Pro'}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{draft.portalSubtitle || 'FINANCIAL MODELING HUB'}</div>
                  </div>
                </div>
                {/* Button + badge row */}
                <div style={{ background: 'var(--color-grey-pale)', padding: '14px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button style={{ background: draft.primaryColor || '#1E3A8A', color: 'white', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, fontFamily: 'Inter,sans-serif', cursor: 'default' }}>Primary Button</button>
                  <button style={{ background: 'white', color: draft.primaryColor || '#1E3A8A', border: `1.5px solid ${draft.primaryColor || '#1E3A8A'}`, borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 700, fontFamily: 'Inter,sans-serif', cursor: 'default' }}>Secondary</button>
                  <span style={{ background: `${draft.secondaryColor || '#3B82F6'}22`, color: draft.secondaryColor || '#3B82F6', border: `1px solid ${draft.secondaryColor || '#3B82F6'}44`, borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>Active</span>
                  <span style={{ background: `${draft.primaryColor || '#1E3A8A'}15`, color: draft.primaryColor || '#1E3A8A', borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>Professional Plan</span>
                </div>
              </div>

              <Divider />

              {/* ── PRESET THEMES (secondary, below custom) ── */}
              <SectionTitle badge="PRESETS" badgeColor="#EFF6FF" badgeText="#1E40AF">Quick-Start Themes</SectionTitle>
              <p style={{ fontSize: 12, color: 'var(--color-grey-mid)', marginBottom: 16, marginTop: -8 }}>
                Click any theme to load it into the pickers above — you can then fine-tune the colours freely.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                {COLOR_THEMES.map((theme) => {
                  const isActive = draft.primaryColor === theme.primary && draft.secondaryColor === theme.secondary;
                  return (
                    <button key={theme.name}
                      onClick={() => { upd('primaryColor', theme.primary); upd('secondaryColor', theme.secondary); }}
                      style={{
                        border: isActive ? `2.5px solid ${theme.primary}` : '1.5px solid var(--color-grey-light)',
                        borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                        background: isActive ? `${theme.primary}12` : 'var(--color-grey-pale)',
                        textAlign: 'left', transition: 'all 0.15s',
                        boxShadow: isActive ? `0 0 0 3px ${theme.primary}28` : 'none',
                      }}>
                      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: theme.primary, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: theme.secondary, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }} />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: isActive ? 700 : 600, color: isActive ? theme.primary : 'var(--color-grey-dark)' }}>{theme.name}</div>
                      {isActive && <div style={{ fontSize: 10, color: theme.primary, fontWeight: 700, marginTop: 2 }}>✓ Loaded</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════
              TAB 4 — PLATFORM CARDS
          ══════════════════════════════════════════ */}
          {tab === 'cards' && (() => {
            const draftPlatforms = (draft.platforms && draft.platforms.length)
              ? draft.platforms
              : PLATFORM_REGISTRY.map((p) => ({ id: p.id, name: p.name, description: p.description, status: p.status as 'active' | 'coming_soon' }));

            const updPlatform = (id: string, field: string, value: string) => {
              upd('platforms', draftPlatforms.map((p) => p.id === id ? { ...p, [field]: value } : p));
            };

            return (
              <div>
                <SectionBanner color="#EFF6FF" border="#BFDBFE" text="Edit the name, description, and status of each platform card shown on the portal. Toggle Coming Soon to hide unfinished platforms." />
                {PLATFORM_REGISTRY.map((reg, idx) => {
                  const p = draftPlatforms.find((x) => x.id === reg.id) || reg;
                  return (
                    <div key={reg.id} style={{ border: '1.5px solid var(--color-grey-light)', borderRadius: 12, padding: '18px 20px', marginBottom: 16, background: 'var(--color-grey-pale)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: reg.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, border: '1px solid var(--color-grey-light)', flexShrink: 0 }}>
                          {reg.icon}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Platform {idx + 1} · ID: {reg.id}
                          </div>
                        </div>
                        {/* Status toggle */}
                        <div style={{ display: 'flex', borderRadius: 6, border: '1.5px solid var(--color-grey-light)', overflow: 'hidden' }}>
                          {(['active', 'coming_soon'] as const).map((s) => (
                            <button key={s} onClick={() => updPlatform(reg.id, 'status', s)}
                              style={{
                                padding: '5px 12px', border: 'none', cursor: 'pointer',
                                fontFamily: 'Inter,sans-serif', fontSize: 11, fontWeight: 700,
                                background: p.status === s ? (s === 'active' ? 'var(--color-green-dark)' : '#92400E') : 'var(--color-grey-pale)',
                                color: p.status === s ? 'white' : 'var(--color-muted)', transition: 'all 0.15s',
                              }}>
                              {s === 'active' ? '✅ Active' : '🚧 Coming Soon'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={FL}>Platform Name</label>
                        <input style={FI} value={p.name}
                          onChange={(e) => updPlatform(reg.id, 'name', e.target.value)}
                          placeholder={reg.name} />
                      </div>
                      <div>
                        <label style={FL}>Description</label>
                        <textarea style={FTA} value={p.description}
                          onChange={(e) => updPlatform(reg.id, 'description', e.target.value)}
                          placeholder={reg.description} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '14px 28px', borderTop: '1px solid var(--color-grey-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-grey-pale)', flexShrink: 0 }}>
          <button onClick={handleReset}
            style={{ padding: '8px 16px', border: '1px solid var(--color-grey-light)', borderRadius: 8, background: 'var(--color-grey-white)', cursor: 'pointer', fontSize: 12, color: 'var(--color-muted)', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
            ↩ Reset to Defaults
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: '9px 20px', border: '1.5px solid var(--color-grey-light)', borderRadius: 8, background: 'var(--color-grey-white)', cursor: 'pointer', fontSize: 13, color: 'var(--color-grey-dark)', fontFamily: 'Inter,sans-serif', fontWeight: 600 }}>
              Cancel
            </button>
            <button onClick={handleSave}
              style={{ padding: '9px 24px', background: saved ? 'var(--color-green-dark)' : (previewHeaderBg), color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'Inter,sans-serif', transition: 'background 0.2s', display: 'flex', alignItems: 'center', gap: 6 }}>
              {saved ? '✓ Saved!' : '💾 Save Branding'}
            </button>
          </div>
        </div>

      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ── Small reusable sub-components ─────────────────────────────────────────────

function SectionBanner({ color, border, text }: { color: string; border: string; text: string }) {
  return (
    <div style={{ background: color, border: `1px solid ${border}`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--color-navy-mid)', lineHeight: 1.55, marginBottom: 24 }}>
      {text}
    </div>
  );
}

function SectionTitle({ badge, badgeColor, badgeText, children }: { badge: string; badgeColor: string; badgeText: string; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-grey-dark)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ background: badgeColor, color: badgeText, padding: '3px 8px', borderRadius: 5, fontSize: 10 }}>{badge}</span>
      {children}
    </div>
  );
}

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={FL}>
        {label}
        {hint && <span style={{ fontWeight: 400, color: 'var(--color-muted)', textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--color-grey-pale)', margin: '8px 0 24px' }} />;
}


// ── Colour helpers ─────────────────────────────────────────────────────────────
function darkenHex(hex: string, amount: number): string {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amount)));
    const g = Math.max(0, Math.round(((n >>  8) & 255) * (1 - amount)));
    const b = Math.max(0, Math.round(( n        & 255) * (1 - amount)));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch { return hex; }
}

function lightenHex(hex: string, amount: number): string {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amount));
    const g = Math.min(255, Math.round(((n >>  8) & 255) + (255 - ((n >>  8) & 255)) * amount));
    const b = Math.min(255, Math.round(( n        & 255) + (255 - ( n        & 255)) * amount));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  } catch { return hex; }
}
