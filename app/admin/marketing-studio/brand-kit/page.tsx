'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { DEFAULT_BRAND_KIT, type BrandKit } from '@/src/lib/marketing/types';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

export default function BrandKitPage() {
  const [kit, setKit] = useState<BrandKit>({ ...DEFAULT_BRAND_KIT });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/marketing-studio/brand-kit');
      const json = await res.json();
      if (json.brandKit) setKit(json.brandKit);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/marketing-studio/brand-kit', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(kit),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      if (json.brandKit) setKit(json.brandKit);
      setMsg('Saved ✓');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof BrandKit>(k: K, v: BrandKit[K]) {
    setKit(prev => ({ ...prev, [k]: v }));
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F9FAFB' }}>
      <CmsAdminNav />
      <div style={{ flex: 1, padding: '28px 32px', maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <Link href="/admin/marketing-studio" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>← Marketing Studio</Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginTop: 4 }}>Brand Kit</h1>
            <div style={{ fontSize: 12, color: '#6B7280' }}>Logos, colors and fonts shared across all Marketing Studio templates.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {msg && <span style={{ fontSize: 11, color: msg.includes('fail') ? '#DC2626' : '#059669', fontWeight: 600 }}>{msg}</span>}
            <button onClick={save} disabled={saving || loading} style={{ padding: '9px 18px', background: NAVY, color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: '#6B7280' }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gap: 18 }}>
            {/* Logos + photo */}
            <Panel title="Logos & Photo">
              <ImageField label="Primary Logo (dark backgrounds)" value={kit.logo_url} onChange={v => setField('logo_url', v)} helpText="Used on dark-themed templates. Transparent PNG or SVG recommended." />
              <ImageField label="Light Variant Logo (light backgrounds)" value={kit.logo_light_url} onChange={v => setField('logo_light_url', v)} helpText="Optional. Used on light-background templates." />
              <ImageField label="Founder Photo" value={kit.founder_photo_url} onChange={v => setField('founder_photo_url', v)} helpText="Square image, face centered. Used on bylines + split layouts." />
            </Panel>

            {/* Colors */}
            <Panel title="Colors">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                <ColorField label="Primary"   value={kit.primary_color}    onChange={v => setField('primary_color', v)} />
                <ColorField label="Secondary" value={kit.secondary_color}  onChange={v => setField('secondary_color', v)} />
                <ColorField label="Accent"    value={kit.accent_color}     onChange={v => setField('accent_color', v)} />
                <ColorField label="Text (dark)"  value={kit.text_color_dark}  onChange={v => setField('text_color_dark', v)} />
                <ColorField label="Text (light)" value={kit.text_color_light} onChange={v => setField('text_color_light', v)} />
              </div>
            </Panel>

            {/* Font */}
            <Panel title="Typography">
              <label style={lbl}>Font Family</label>
              <select value={kit.font_family} onChange={e => setField('font_family', e.target.value)} style={input}>
                <option value="Inter">Inter (default)</option>
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
              </select>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6 }}>
                Satori rendering currently bundles Inter TTF files. Other fonts fall back to Inter when generating PNGs.
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 42, height: 36, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', background: '#fff', padding: 2 }} />
        <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ ...input, fontFamily: 'monospace', fontSize: 12 }} />
      </div>
    </div>
  );
}

function ImageField({ label, value, onChange, helpText }: { label: string; value: string | null; onChange: (v: string) => void; helpText?: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bucket', 'cms-assets');
      const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      if (json.url) onChange(json.url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={lbl}>{label}</label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {value ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={value} alt="" style={{ width: 80, height: 80, objectFit: 'contain', border: `1px solid ${BORDER}`, borderRadius: 6, background: '#F3F4F6', padding: 4 }} />
        ) : (
          <div style={{ width: 80, height: 80, border: `1px dashed ${BORDER}`, borderRadius: 6, background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9CA3AF' }}>empty</div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder="https://…" style={input} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{ fontSize: 11, padding: '5px 11px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 5, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            {value && <button type="button" onClick={() => onChange('')} style={{ fontSize: 11, padding: '5px 11px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 5, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Clear</button>}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
          </div>
          {helpText && <div style={{ fontSize: 10, color: '#9CA3AF' }}>{helpText}</div>}
        </div>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '8px 10px', border: `1px solid ${BORDER}`,
  borderRadius: 6, background: '#fff', color: '#111827', fontFamily: 'inherit', boxSizing: 'border-box',
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 5,
};
