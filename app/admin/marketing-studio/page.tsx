'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { CanvasEditor } from '@/src/components/marketing/canvas/CanvasEditor';
import { PRESETS, getPreset } from '@/src/lib/marketing/presets';
import type { Design, BrandKit, CanvasElement, CanvasBackground } from '@/src/lib/marketing/types';
import { DEFAULT_BRAND_KIT } from '@/src/lib/marketing/types';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

type Platform = 'youtube' | 'linkedin' | 'instagram' | 'twitter';

interface SavedDesignRow {
  id: string;
  name: string;
  template_type: string;
  dimensions?: { width: number; height: number };
  background?: CanvasBackground;
  elements?: CanvasElement[];
  ai_captions: Record<string, string>;
  updated_at: string;
}

export default function MarketingStudioPage() {
  const [brandKit, setBrandKit] = useState<BrandKit>({ ...DEFAULT_BRAND_KIT });
  const [brandKitLoaded, setBrandKitLoaded] = useState(false);

  const [design, setDesign] = useState<Design>(() => {
    const preset = PRESETS[0];
    const { background, elements } = preset.buildPreset(DEFAULT_BRAND_KIT);
    return {
      id: 'new',
      name: 'Untitled Design',
      template_type: preset.id,
      dimensions: preset.dimensions,
      background, elements,
      ai_captions: {},
    };
  });
  const [currentDesignId, setCurrentDesignId] = useState<string | null>(null);

  const [savedDesigns, setSavedDesigns] = useState<SavedDesignRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [captionPlatform, setCaptionPlatform] = useState<Platform>('linkedin');
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [captionError, setCaptionError] = useState('');

  const [downloading, setDownloading] = useState(false);

  // ── Load brand kit + designs on mount ────────────────────────────────────
  const loadBrandKit = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketing-studio/brand-kit');
      const json = await res.json();
      if (json.brandKit) setBrandKit(json.brandKit);
    } catch { /* ignore */ }
    setBrandKitLoaded(true);
  }, []);

  const loadDesigns = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketing-studio/designs');
      const json = await res.json();
      setSavedDesigns(json.designs ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadBrandKit(); void loadDesigns(); }, [loadBrandKit, loadDesigns]);

  // Once brand kit actually loads, re-apply the first preset so it uses real logos/photos.
  const appliedRealKitRef = useRef(false);
  useEffect(() => {
    if (!brandKitLoaded || appliedRealKitRef.current) return;
    appliedRealKitRef.current = true;
    if (currentDesignId || design.elements.length === 0) return;
    const p = getPreset(design.template_type);
    if (!p) return;
    const { background, elements } = p.buildPreset(brandKit);
    setDesign(d => ({ ...d, background, elements }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKitLoaded]);

  // ── Preset switching ─────────────────────────────────────────────────────
  function applyPreset(presetId: string) {
    const p = getPreset(presetId);
    if (!p) return;
    const { background, elements } = p.buildPreset(brandKit);
    setDesign({
      id: 'new',
      name: p.name,
      template_type: p.id,
      dimensions: p.dimensions,
      background, elements,
      ai_captions: {},
    });
    setCurrentDesignId(null);
  }

  function newBlank() {
    applyPreset('blank-custom');
  }

  function updateDimensions(w: number, h: number) {
    setDesign(d => ({ ...d, dimensions: { width: Math.max(1, w), height: Math.max(1, h) } }));
  }

  // ── Save / load / delete ─────────────────────────────────────────────────
  async function save() {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        name: design.name,
        template_type: design.template_type,
        dimensions: design.dimensions,
        background: design.background,
        elements: design.elements,
        ai_captions: design.ai_captions,
      };
      const url = currentDesignId
        ? `/api/admin/marketing-studio/designs/${currentDesignId}`
        : '/api/admin/marketing-studio/designs';
      const method = currentDesignId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      if (json.design) {
        setCurrentDesignId(json.design.id);
        setDesign(d => ({ ...d, id: json.design.id }));
        setSaveMsg(currentDesignId ? 'Updated ✓' : 'Saved ✓');
      }
      await loadDesigns();
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function loadSaved(row: SavedDesignRow) {
    setDesign({
      id: row.id,
      name: row.name,
      template_type: row.template_type,
      dimensions: row.dimensions ?? { width: 1280, height: 720 },
      background: row.background ?? { type: 'color', color: brandKit.primary_color },
      elements: row.elements ?? [],
      ai_captions: row.ai_captions ?? {},
    });
    setCurrentDesignId(row.id);
  }

  async function deleteSaved(id: string) {
    if (!confirm('Delete this design?')) return;
    await fetch(`/api/admin/marketing-studio/designs/${id}`, { method: 'DELETE' });
    if (currentDesignId === id) { setCurrentDesignId(null); newBlank(); }
    await loadDesigns();
  }

  // ── Download PNG ─────────────────────────────────────────────────────────
  async function download() {
    setDownloading(true);
    try {
      const res = await fetch('/api/admin/marketing-studio/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dimensions: design.dimensions, background: design.background, elements: design.elements }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Render failed' }));
        throw new Error(err.error || 'Render failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
      a.download = `${slug}-${design.dimensions.width}x${design.dimensions.height}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  // ── AI caption ───────────────────────────────────────────────────────────
  async function generateCaption() {
    setGeneratingCaption(true);
    setCaptionError('');
    try {
      const res = await fetch('/api/admin/marketing-studio/generate-caption', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template_type: design.template_type, elements: design.elements, platform: captionPlatform }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Caption generation failed');
      setDesign(d => ({ ...d, ai_captions: { ...d.ai_captions, [captionPlatform]: json.caption } }));
    } catch (e) {
      setCaptionError(e instanceof Error ? e.message : 'Caption generation failed');
    } finally {
      setGeneratingCaption(false);
    }
  }

  async function copyCaption() {
    const text = design.ai_captions[captionPlatform] || '';
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setSaveMsg('Caption copied ✓'); setTimeout(() => setSaveMsg(''), 1500); }
    catch { /* ignore */ }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F9FAFB' }}>
      <CmsAdminNav />
      <div style={{ flex: 1, padding: '24px 28px', maxWidth: 1800, overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 2 }}>Marketing Studio</h1>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Drag-and-drop canvas editor. Use presets or start blank.</div>
            </div>
            <Link href="/admin/marketing-studio/brand-kit" style={{ padding: '6px 12px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 11, fontWeight: 600, color: NAVY, textDecoration: 'none' }}>
              🎨 Brand Kit
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={design.name}
              onChange={e => setDesign(d => ({ ...d, name: e.target.value }))}
              placeholder="Design name"
              style={{ fontSize: 12, fontWeight: 600, padding: '7px 10px', border: `1px solid ${BORDER}`, borderRadius: 6, width: 220 }}
            />
            {saveMsg && <span style={{ fontSize: 11, color: saveMsg.includes('fail') ? '#DC2626' : '#059669', fontWeight: 600 }}>{saveMsg}</span>}
            <button onClick={save} disabled={saving} style={{ ...btn, background: NAVY, color: '#fff' }}>
              {saving ? 'Saving…' : (currentDesignId ? 'Update' : 'Save')}
            </button>
            <button onClick={download} disabled={downloading} style={{ ...btn, background: '#059669', color: '#fff' }}>
              {downloading ? 'Rendering…' : '↓ PNG'}
            </button>
          </div>
        </div>

        {/* Preset picker + dimensions + saved designs */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {PRESETS.map(p => {
              const isFmp = p.id.startsWith('fmp-');
              const active = design.template_type === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  title={p.description}
                  style={{
                    padding: '7px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                    border: active ? `2px solid ${NAVY}` : `1px solid ${isFmp ? '#F59E0B' : BORDER}`,
                    background: active ? '#F0F5FA' : (isFmp ? '#FFFBEB' : '#fff'),
                    color: NAVY,
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {isFmp && <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: '#F59E0B', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.05em' }}>FMP</span>}
                  {p.name}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 8px' }}>
            <span style={{ fontSize: 10, color: '#6B7280' }}>W</span>
            <input type="number" value={design.dimensions.width} onChange={e => updateDimensions(Number(e.target.value), design.dimensions.height)} style={{ width: 64, border: 'none', fontSize: 12, fontWeight: 600, color: NAVY, outline: 'none' }} />
            <span style={{ fontSize: 10, color: '#6B7280' }}>× H</span>
            <input type="number" value={design.dimensions.height} onChange={e => updateDimensions(design.dimensions.width, Number(e.target.value))} style={{ width: 64, border: 'none', fontSize: 12, fontWeight: 600, color: NAVY, outline: 'none' }} />
          </div>
          {savedDesigns.length > 0 && (
            <select
              onChange={e => { const row = savedDesigns.find(d => d.id === e.target.value); if (row) loadSaved(row); }}
              value={currentDesignId ?? ''}
              style={{ fontSize: 12, padding: '7px 8px', border: `1px solid ${BORDER}`, borderRadius: 6, color: NAVY, fontWeight: 500, minWidth: 200 }}
            >
              <option value="">— Load Saved Design —</option>
              {savedDesigns.map(d => (
                <option key={d.id} value={d.id}>{d.name} · {d.template_type}</option>
              ))}
            </select>
          )}
          {currentDesignId && (
            <button onClick={() => deleteSaved(currentDesignId)} style={{ ...btn, background: '#fff', border: `1px solid #FCA5A5`, color: '#DC2626' }}>
              Delete
            </button>
          )}
        </div>

        {/* Canvas editor */}
        <CanvasEditor
          design={design}
          brandKit={brandKit}
          onDesignChange={setDesign}
          onBrandKitChange={(patch) => setBrandKit(prev => ({ ...prev, ...patch }))}
        />

        {/* AI caption bar */}
        <div style={{ marginTop: 14, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: design.ai_captions[captionPlatform] ? 10 : 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>AI Caption</span>
            <select value={captionPlatform} onChange={e => setCaptionPlatform(e.target.value as Platform)} style={{ fontSize: 12, padding: '5px 7px', border: `1px solid ${BORDER}`, borderRadius: 5 }}>
              <option value="linkedin">LinkedIn</option>
              <option value="youtube">YouTube</option>
              <option value="instagram">Instagram</option>
              <option value="twitter">Twitter</option>
            </select>
            <button onClick={generateCaption} disabled={generatingCaption} style={{ ...btn, background: '#7C3AED', color: '#fff' }}>
              {generatingCaption ? 'Generating…' : '✨ Generate'}
            </button>
            {design.ai_captions[captionPlatform] && (
              <button onClick={copyCaption} style={{ ...btn, background: '#fff', border: `1px solid ${BORDER}`, color: NAVY }}>📋 Copy</button>
            )}
            {captionError && <span style={{ fontSize: 11, color: '#DC2626' }}>{captionError}</span>}
          </div>
          {design.ai_captions[captionPlatform] && (
            <textarea
              value={design.ai_captions[captionPlatform]}
              onChange={e => setDesign(d => ({ ...d, ai_captions: { ...d.ai_captions, [captionPlatform]: e.target.value } }))}
              rows={6}
              style={{ width: '100%', fontSize: 12, lineHeight: 1.5, padding: '8px 10px', border: `1px solid ${BORDER}`, borderRadius: 5, fontFamily: 'inherit', resize: 'vertical' }}
            />
          )}
        </div>

      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '7px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: 'none',
};
