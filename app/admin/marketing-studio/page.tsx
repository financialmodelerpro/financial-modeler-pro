'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { CanvasEditor } from '@/src/components/marketing/canvas/CanvasEditor';
import { QuickFillPanel } from '@/src/components/marketing/QuickFillPanel';
import { CaptionsPanel } from '@/src/components/marketing/CaptionsPanel';
import { DesignsSidebar } from '@/src/components/marketing/DesignsSidebar';
import { PRESETS, PRESET_GROUPS, getPreset, FMP_EXPORT_PRESET_IDS } from '@/src/lib/marketing/presets';
import { VARIANTS, getVariant } from '@/src/lib/marketing/variants';
import { autoFillElements, type AutoFillSource } from '@/src/lib/marketing/autoFill';
import type { Design, BrandKit, CanvasElement, CanvasBackground, VariantId } from '@/src/lib/marketing/types';
import { DEFAULT_BRAND_KIT } from '@/src/lib/marketing/types';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

interface SavedDesignRow {
  id: string;
  name: string;
  template_type: string;
  variant_id?: VariantId;
  content?: { variant_id?: string };
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

  const [downloading, setDownloading] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);

  // ── Load brand kit + designs ─────────────────────────────────────────────
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

  // Apply real brand kit to initial preset when it loads
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

  // ── Presets / variants / dimensions ──────────────────────────────────────
  function applyPreset(presetId: string) {
    const p = getPreset(presetId);
    if (!p) return;
    const { background, elements } = p.buildPreset(brandKit);
    setDesign({
      id: 'new',
      name: p.name,
      template_type: p.id,
      variant_id: 'default',
      dimensions: p.dimensions,
      background, elements,
      ai_captions: design.ai_captions, // preserve captions across preset swap
    });
    setCurrentDesignId(null);
  }

  /** Swap the elements+background layout to a variant while keeping dimensions. */
  function applyVariant(variantId: VariantId) {
    if (variantId === 'default') {
      // Restore the preset's default layout at current dimensions
      const p = getPreset(design.template_type);
      if (!p) return;
      const { background, elements } = p.buildPreset(brandKit);
      setDesign(d => ({ ...d, variant_id: 'default', background, elements }));
      return;
    }
    const v = getVariant(variantId);
    if (!v) return;
    const { background, elements } = v.build(brandKit, design.dimensions);
    setDesign(d => ({ ...d, variant_id: variantId, background, elements }));
  }

  function newBlank() { applyPreset('blank-custom'); }

  function updateDimensions(w: number, h: number) {
    setDesign(d => ({ ...d, dimensions: { width: Math.max(1, w), height: Math.max(1, h) } }));
  }

  // ── Quick Fill ────────────────────────────────────────────────────────────
  function handleQuickFill(source: AutoFillSource) {
    setDesign(d => ({ ...d, elements: autoFillElements(d.elements, source) }));
  }

  // ── Save / load / delete ─────────────────────────────────────────────────
  async function save() {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        name: design.name,
        template_type: design.template_type,
        variant_id: design.variant_id ?? 'default',
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
    const variantId = (row.variant_id ?? (row.content?.variant_id as VariantId | undefined) ?? 'default') as VariantId;
    setDesign({
      id: row.id,
      name: row.name,
      template_type: row.template_type,
      variant_id: variantId,
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

  // ── Download single PNG ─────────────────────────────────────────────────
  async function renderBlob(dimensions: { width: number; height: number }, background: CanvasBackground, elements: CanvasElement[]): Promise<Blob> {
    const res = await fetch('/api/admin/marketing-studio/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dimensions, background, elements }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Render failed' }));
      throw new Error(err.error || 'Render failed');
    }
    return res.blob();
  }

  async function download() {
    setDownloading(true);
    try {
      const blob = await renderBlob(design.dimensions, design.background, design.elements);
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

  // ── Export to all platforms (ZIP) ────────────────────────────────────────
  async function exportAllPlatforms() {
    setExportingZip(true);
    setSaveMsg('');
    try {
      const zip = new JSZip();
      const slug = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
      // Walk through each FMP preset, rebuild its layout with brand kit,
      // then pull over text content from the current design so the user's
      // headline/subtitle/session carries across adapted dimensions.
      const currentTexts: AutoFillSource = textsFromCurrentDesign(design.elements);

      for (const presetId of FMP_EXPORT_PRESET_IDS) {
        const preset = getPreset(presetId);
        if (!preset) continue;
        const built = preset.buildPreset(brandKit);
        const adapted = autoFillElements(built.elements, currentTexts);
        const blob = await renderBlob(preset.dimensions, built.background, adapted);
        const platformSlug = presetId.replace('fmp-', '').replace('-thumbnail', '').replace('-post', '');
        zip.file(`${slug}_${platformSlug}_${preset.dimensions.width}x${preset.dimensions.height}.png`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-all-platforms.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveMsg('Exported ✓');
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExportingZip(false);
    }
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
              <div style={{ fontSize: 11, color: '#6B7280' }}>Drag-and-drop canvas · Auto-populate from CMS · Multi-platform captions.</div>
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
            <button onClick={exportAllPlatforms} disabled={exportingZip} title="Renders FMP YouTube + LinkedIn + Instagram adaptations and downloads them as a ZIP."
              style={{ ...btn, background: '#F59E0B', color: '#fff' }}>
              {exportingZip ? 'Zipping…' : '📦 Export All'}
            </button>
          </div>
        </div>

        {/* Preset picker — grouped by platform */}
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {PRESET_GROUPS.filter(g => g.presets.length > 0).map(group => (
              <div key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group.label}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {group.presets.map(p => {
                    const isFmp = p.id.startsWith('fmp-');
                    const active = design.template_type === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => applyPreset(p.id)}
                        title={`${p.description} (${p.dimensions.width}×${p.dimensions.height})`}
                        style={{
                          padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
                          border: active ? `2px solid ${NAVY}` : `1px solid ${isFmp ? '#F59E0B' : BORDER}`,
                          background: active ? '#F0F5FA' : (isFmp ? '#FFFBEB' : '#fff'),
                          color: NAVY,
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {isFmp && <span style={{ fontSize: 8, fontWeight: 800, color: '#fff', background: '#F59E0B', padding: '1px 4px', borderRadius: 2, letterSpacing: '0.05em' }}>FMP</span>}
                        {p.name.replace(/^FMP\s+/, '')}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', background: '#F9FAFB', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 8px', alignSelf: 'flex-end' }}>
              <span style={{ fontSize: 10, color: '#6B7280' }}>W</span>
              <input type="number" value={design.dimensions.width} onChange={e => updateDimensions(Number(e.target.value), design.dimensions.height)} style={{ width: 64, border: 'none', fontSize: 12, fontWeight: 600, color: NAVY, outline: 'none', background: 'transparent' }} />
              <span style={{ fontSize: 10, color: '#6B7280' }}>× H</span>
              <input type="number" value={design.dimensions.height} onChange={e => updateDimensions(design.dimensions.width, Number(e.target.value))} style={{ width: 64, border: 'none', fontSize: 12, fontWeight: 600, color: NAVY, outline: 'none', background: 'transparent' }} />
            </div>
          </div>

          {/* Variant selector — only shown for non-blank presets */}
          {design.template_type !== 'blank-custom' && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BORDER}`, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Variant</span>
              <button
                onClick={() => applyVariant('default')}
                title="Default preset layout"
                style={{
                  padding: '5px 9px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
                  border: (design.variant_id ?? 'default') === 'default' ? `2px solid ${NAVY}` : `1px solid ${BORDER}`,
                  background: (design.variant_id ?? 'default') === 'default' ? '#F0F5FA' : '#fff', color: NAVY,
                }}
              >⭐ Default</button>
              {VARIANTS.map(v => {
                const active = design.variant_id === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => applyVariant(v.id)}
                    title={v.description}
                    style={{
                      padding: '5px 9px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
                      border: active ? `2px solid ${NAVY}` : `1px solid ${BORDER}`,
                      background: active ? '#F0F5FA' : '#fff', color: NAVY,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >{v.icon} {v.name}</button>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Fill */}
        <div style={{ marginBottom: 14 }}>
          <QuickFillPanel onApply={handleQuickFill} />
        </div>

        {/* Canvas editor */}
        <CanvasEditor
          design={design}
          brandKit={brandKit}
          onDesignChange={setDesign}
          onBrandKitChange={(patch) => setBrandKit(prev => ({ ...prev, ...patch }))}
        />

        {/* Captions + Saved designs */}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <CaptionsPanel
            templateType={design.template_type}
            elements={design.elements}
            captions={design.ai_captions}
            onCaptionsChange={(next) => setDesign(d => ({ ...d, ai_captions: next }))}
          />
          <DesignsSidebar
            designs={savedDesigns}
            currentDesignId={currentDesignId}
            onLoad={loadSaved}
            onDelete={deleteSaved}
          />
        </div>

      </div>
    </div>
  );
}

/** Extract headline / subtitle / session from current canvas text elements. */
function textsFromCurrentDesign(elements: CanvasElement[]): AutoFillSource {
  const byBucket: Record<string, string> = {};
  const sorted = [...elements].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  for (const el of sorted) {
    if (el.type !== 'text' || !el.text) continue;
    const id = el.id.toLowerCase();
    if ((id.startsWith('session-') || id.includes('session_number')) && !byBucket.session) {
      byBucket.session = el.text.content;
    } else if ((id.startsWith('title-') || id.startsWith('headline-')) && !byBucket.title) {
      byBucket.title = el.text.content;
    } else if ((id.startsWith('subtitle-') || id.startsWith('insight-') || id.startsWith('description-') || id.startsWith('title2-')) && !byBucket.subtitle) {
      byBucket.subtitle = el.text.content;
    }
  }
  // Fallback: take first text element as title if no 'title-' match
  if (!byBucket.title && sorted.length > 0 && sorted[0].type === 'text' && sorted[0].text) {
    byBucket.title = sorted[0].text.content;
  }
  return {
    title:    byBucket.title ?? '',
    subtitle: byBucket.subtitle ?? '',
    session:  byBucket.session ?? '',
  };
}

const btn: React.CSSProperties = {
  padding: '7px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: 'none',
};
