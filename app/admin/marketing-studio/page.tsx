'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { TEMPLATE_META, getTemplateMeta, type TemplateMeta } from '@/src/lib/marketing/templateMeta';

const NAVY = '#0D2E5A';
const BORDER = '#E5E7EB';

type Platform = 'youtube' | 'linkedin' | 'instagram' | 'twitter';

interface SavedDesign {
  id: string;
  name: string;
  template_type: string;
  content: Record<string, string>;
  ai_captions: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export default function MarketingStudioPage() {
  const [templateId, setTemplateId] = useState<string>(TEMPLATE_META[0].id);
  const [content, setContent] = useState<Record<string, string>>({ ...TEMPLATE_META[0].defaults });
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [captionPlatform, setCaptionPlatform] = useState<Platform>('linkedin');
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [captionError, setCaptionError] = useState('');

  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState('');

  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([]);
  const [currentDesignId, setCurrentDesignId] = useState<string | null>(null);
  const [designName, setDesignName] = useState('Untitled Design');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const template = getTemplateMeta(templateId)!;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlobUrlRef = useRef<string>('');

  // ── Render preview (debounced) ─────────────────────────────────────────
  const renderPreview = useCallback(async () => {
    setRendering(true);
    setRenderError('');
    try {
      const res = await fetch('/api/admin/marketing-studio/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template_type: templateId, content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Render failed' }));
        throw new Error(err.error || 'Render failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current);
      lastBlobUrlRef.current = url;
      setPreviewUrl(url);
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : 'Render failed');
    } finally {
      setRendering(false);
    }
  }, [templateId, content]);

  // Debounce preview rerender 500ms after last edit
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void renderPreview(); }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [renderPreview]);

  // Cleanup blob URL on unmount
  useEffect(() => () => { if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current); }, []);

  // ── Load saved designs ─────────────────────────────────────────────────
  const loadDesigns = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketing-studio/designs');
      const json = await res.json();
      setSavedDesigns(json.designs ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadDesigns(); }, [loadDesigns]);

  // ── Template switch ────────────────────────────────────────────────────
  function switchTemplate(id: string) {
    const t = getTemplateMeta(id);
    if (!t) return;
    setTemplateId(id);
    setContent({ ...t.defaults });
    setCaptions({});
    setCurrentDesignId(null);
    setDesignName('Untitled Design');
  }

  function setField(key: string, value: string) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  // ── Save / New ─────────────────────────────────────────────────────────
  async function saveDesign() {
    setSaving(true);
    setSaveMsg('');
    try {
      const body = { name: designName, template_type: templateId, content, ai_captions: captions };
      const url = currentDesignId
        ? `/api/admin/marketing-studio/designs/${currentDesignId}`
        : '/api/admin/marketing-studio/designs';
      const method = currentDesignId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      if (json.design) {
        setCurrentDesignId(json.design.id);
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

  function loadDesign(d: SavedDesign) {
    const t = getTemplateMeta(d.template_type);
    if (!t) { alert('Template no longer exists: ' + d.template_type); return; }
    setTemplateId(d.template_type);
    setContent({ ...t.defaults, ...d.content });
    setCaptions(d.ai_captions || {});
    setDesignName(d.name);
    setCurrentDesignId(d.id);
  }

  async function deleteDesign(id: string) {
    if (!confirm('Delete this design?')) return;
    await fetch(`/api/admin/marketing-studio/designs/${id}`, { method: 'DELETE' });
    if (currentDesignId === id) {
      setCurrentDesignId(null);
      setDesignName('Untitled Design');
    }
    await loadDesigns();
  }

  function newDesign() {
    switchTemplate(templateId);
  }

  // ── Download PNG ───────────────────────────────────────────────────────
  async function downloadPng() {
    try {
      const res = await fetch('/api/admin/marketing-studio/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template_type: templateId, content }),
      });
      if (!res.ok) throw new Error('Render failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = designName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
      a.download = `${slug}-${templateId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed');
    }
  }

  // ── Generate AI caption ────────────────────────────────────────────────
  async function generateCaption() {
    setGeneratingCaption(true);
    setCaptionError('');
    try {
      const res = await fetch('/api/admin/marketing-studio/generate-caption', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template_type: templateId, content, platform: captionPlatform }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Caption generation failed');
      setCaptions(prev => ({ ...prev, [captionPlatform]: json.caption }));
    } catch (e) {
      setCaptionError(e instanceof Error ? e.message : 'Caption generation failed');
    } finally {
      setGeneratingCaption(false);
    }
  }

  async function copyCaption() {
    const text = captions[captionPlatform] || '';
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setSaveMsg('Caption copied ✓'); setTimeout(() => setSaveMsg(''), 1500); }
    catch { /* ignore */ }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F9FAFB' }}>
      <CmsAdminNav />
      <div style={{ flex: 1, padding: '28px 32px', maxWidth: 1600 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginBottom: 2 }}>Marketing Studio</h1>
            <div style={{ fontSize: 12, color: '#6B7280' }}>Design social media assets with templates + AI captions.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/admin/marketing-studio/brand-kit" style={{ padding: '8px 14px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 7, fontSize: 12, fontWeight: 600, color: NAVY, textDecoration: 'none' }}>
              🎨 Brand Kit
            </Link>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) 1fr minmax(260px, 300px)', gap: 20, alignItems: 'start' }}>

          {/* ── LEFT: Template picker + saved designs ───────────────────── */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Panel title="Template">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {TEMPLATE_META.map(t => (
                  <button
                    key={t.id}
                    onClick={() => switchTemplate(t.id)}
                    style={{
                      textAlign: 'left', padding: '10px 12px', borderRadius: 7, cursor: 'pointer',
                      border: templateId === t.id ? `2px solid ${NAVY}` : '1px solid ' + BORDER,
                      background: templateId === t.id ? '#F0F5FA' : '#fff',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>{t.dimensions.width}×{t.dimensions.height} · {t.aspectRatio}</div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Saved Designs" action={
              <button onClick={newDesign} style={smallBtn}>+ New</button>
            }>
              {savedDesigns.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9CA3AF', padding: '8px 4px' }}>No saved designs yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
                  {savedDesigns.map(d => (
                    <div
                      key={d.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 6,
                        background: currentDesignId === d.id ? '#F0F5FA' : 'transparent',
                        border: currentDesignId === d.id ? `1px solid ${NAVY}` : '1px solid transparent',
                      }}
                    >
                      <button
                        onClick={() => loadDesign(d)}
                        style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                        <div style={{ fontSize: 9, color: '#9CA3AF' }}>{getTemplateMeta(d.template_type)?.name ?? d.template_type} · {new Date(d.updated_at).toLocaleDateString()}</div>
                      </button>
                      <button
                        onClick={() => deleteDesign(d.id)}
                        title="Delete"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 13, padding: 2 }}
                      >🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </aside>

          {/* ── MIDDLE: Preview ─────────────────────────────────────────── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <input
                type="text"
                value={designName}
                onChange={e => setDesignName(e.target.value)}
                placeholder="Design name"
                style={{ ...input, fontSize: 14, fontWeight: 600, flex: '1 1 240px', maxWidth: 400 }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {saveMsg && <span style={{ fontSize: 11, color: saveMsg.includes('fail') ? '#DC2626' : '#059669', fontWeight: 600 }}>{saveMsg}</span>}
                <button onClick={saveDesign} disabled={saving} style={{ ...btn, background: NAVY, color: '#fff' }}>
                  {saving ? 'Saving…' : (currentDesignId ? 'Update' : 'Save')}
                </button>
                <button onClick={downloadPng} style={{ ...btn, background: '#059669', color: '#fff' }}>↓ PNG</button>
              </div>
            </div>

            <Panel title={`Preview (${template.dimensions.width}×${template.dimensions.height})`}>
              <div style={{ background: '#111827', padding: 14, borderRadius: 8, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 380, position: 'relative' }}>
                {rendering && <div style={{ position: 'absolute', top: 10, right: 14, fontSize: 11, color: '#9CA3AF' }}>Rendering…</div>}
                {renderError && <div style={{ fontSize: 12, color: '#FCA5A5', padding: 20, textAlign: 'center' }}>⚠️ {renderError}</div>}
                {!renderError && previewUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={previewUrl}
                    alt="preview"
                    style={{ maxWidth: '100%', maxHeight: 560, width: 'auto', height: 'auto', borderRadius: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
                  />
                )}
                {!renderError && !previewUrl && !rendering && (
                  <div style={{ fontSize: 12, color: '#9CA3AF' }}>Preview will appear here…</div>
                )}
              </div>
            </Panel>
          </section>

          {/* ── RIGHT: Fields + AI captions ─────────────────────────────── */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Panel title="Content">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {template.fields.map(f => (
                  <div key={f.key}>
                    <label style={lbl}>
                      {f.label}
                      {f.required && <span style={{ color: '#DC2626', marginLeft: 3 }}>*</span>}
                      {f.maxLength && <span style={{ color: '#9CA3AF', fontWeight: 400, marginLeft: 6 }}>{(content[f.key] || '').length}/{f.maxLength}</span>}
                    </label>
                    {f.type === 'textarea' ? (
                      <textarea
                        value={content[f.key] ?? ''}
                        onChange={e => setField(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        maxLength={f.maxLength}
                        rows={3}
                        style={{ ...input, resize: 'vertical', minHeight: 60 }}
                      />
                    ) : f.type === 'select' ? (
                      <select
                        value={content[f.key] ?? ''}
                        onChange={e => setField(f.key, e.target.value)}
                        style={input}
                      >
                        {(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={content[f.key] ?? ''}
                        onChange={e => setField(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        maxLength={f.maxLength}
                        style={input}
                      />
                    )}
                    {f.helpText && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>{f.helpText}</div>}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="AI Caption">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <select
                  value={captionPlatform}
                  onChange={e => setCaptionPlatform(e.target.value as Platform)}
                  style={input}
                >
                  <option value="linkedin">LinkedIn Post</option>
                  <option value="youtube">YouTube Description</option>
                  <option value="instagram">Instagram Caption</option>
                  <option value="twitter">Twitter Thread Opener</option>
                </select>
                <button
                  onClick={generateCaption}
                  disabled={generatingCaption}
                  style={{ ...btn, background: '#7C3AED', color: '#fff' }}
                >
                  {generatingCaption ? 'Generating…' : '✨ Generate Caption'}
                </button>
                {captionError && <div style={{ fontSize: 11, color: '#DC2626' }}>{captionError}</div>}
                {captions[captionPlatform] && (
                  <>
                    <textarea
                      value={captions[captionPlatform]}
                      onChange={e => setCaptions(prev => ({ ...prev, [captionPlatform]: e.target.value }))}
                      rows={10}
                      style={{ ...input, fontSize: 12, lineHeight: 1.5, resize: 'vertical', minHeight: 160 }}
                    />
                    <button onClick={copyCaption} style={{ ...btn, background: '#fff', border: `1px solid ${BORDER}`, color: NAVY }}>
                      📋 Copy
                    </button>
                  </>
                )}
              </div>
            </Panel>
          </aside>

        </div>
      </div>
    </div>
  );
}

// ── Shared atoms ────────────────────────────────────────────────────────────
function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '8px 10px', border: `1px solid ${BORDER}`,
  borderRadius: 6, background: '#fff', color: '#111827', fontFamily: 'inherit', boxSizing: 'border-box',
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4,
};
const btn: React.CSSProperties = {
  padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
};
const smallBtn: React.CSSProperties = {
  padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
  border: `1px solid ${BORDER}`, background: '#fff', color: NAVY,
};
