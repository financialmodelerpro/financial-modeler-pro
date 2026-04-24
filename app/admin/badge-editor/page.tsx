'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { CertificatesHubTabs } from '@/src/components/admin/CertificatesHubTabs';

type Course = '3sfm' | 'bvm';

interface BadgeTextField {
  x: number; y: number; fontSize: number; color: string;
  textAlign?: 'left' | 'center' | 'right'; visible: boolean;
}
interface BadgeLayout {
  certificateId: BadgeTextField;
  issueDate: BadgeTextField;
}
type FieldKey = 'certificateId' | 'issueDate';

const DEFAULTS: BadgeLayout = {
  certificateId: { x: 0, y: 44, fontSize: 14, color: '#ffffff', textAlign: 'center', visible: true },
  issueDate:     { x: 0, y: 22, fontSize: 12, color: '#ffffff', textAlign: 'center', visible: true },
};

const FIELD_LABELS: Record<FieldKey, string> = { certificateId: 'Certificate ID', issueDate: 'Issue Date' };
const SAMPLE: Record<FieldKey, string> = { certificateId: 'FMP-3SFM-2026-0001', issueDate: '15 January 2026' };

export default function BadgeEditorPage() {
  const [course, setCourse]           = useState<Course>('3sfm');
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [loading, setLoading]         = useState(true);
  const [toast, setToast]             = useState('');
  const [layout, setLayout]           = useState<BadgeLayout>(DEFAULTS);
  const [imgSize, setImgSize]         = useState({ w: 600, h: 600 });
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Load layout from DB
  useEffect(() => {
    fetch('/api/admin/badge-layout').then(r => r.json())
      .then((d: { layout?: BadgeLayout }) => {
        if (d.layout) setLayout({
          certificateId: { ...DEFAULTS.certificateId, ...d.layout.certificateId },
          issueDate:     { ...DEFAULTS.issueDate,     ...d.layout.issueDate },
        });
      }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Load template on course change
  useEffect(() => {
    setTemplateUrl(null); setPreviewUrl(null);
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data: { publicUrl } } = sb.storage.from('badges').getPublicUrl(`templates/${course}-badge.png`);
    const bust = `${publicUrl}?t=${Date.now()}`;
    fetch(bust, { method: 'HEAD' }).then(res => {
      if (res.ok) {
        setTemplateUrl(bust);
        const img = new Image(); img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight }); img.src = bust;
      }
    }).catch(() => {});
  }, [course]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith('.png')) { flash('Only PNG files accepted.'); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('type', `${course}-badge`);
      const res = await fetch('/api/admin/certificates/upload-template', { method: 'POST', body: fd });
      const j = await res.json() as { success?: boolean; url?: string; error?: string };
      if (j.success) { setTemplateUrl(`${j.url}?t=${Date.now()}`); setPreviewUrl(null); flash('Uploaded.'); }
      else flash(j.error ?? 'Upload failed.');
    } catch { flash('Upload failed.'); }
    setUploading(false); if (fileRef.current) fileRef.current.value = '';
  }

  async function handlePreview() {
    setGenerating(true); setPreviewUrl(null);
    try {
      const res = await fetch('/api/admin/badge-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course, layout }),
      });
      if (!res.ok) { flash('Preview failed.'); setGenerating(false); return; }
      setPreviewUrl(URL.createObjectURL(await res.blob()));
    } catch { flash('Preview failed.'); }
    setGenerating(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch('/api/admin/badge-layout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout }),
      });
      const d = await r.json() as { ok?: boolean };
      if (d.ok) { flash('Saved!'); handlePreview(); } else flash('Save failed.');
    } catch { flash('Save failed.'); }
    setSaving(false);
  }

  function setField(key: FieldKey, prop: string, val: string | number | boolean) {
    setLayout(p => ({ ...p, [key]: { ...p[key], [prop]: val } }));
  }

  // Preview dimensions
  const PW = 360;
  const scale = PW / imgSize.w;
  const PH = Math.round(imgSize.h * scale);

  const IS: React.CSSProperties = { width: '100%', padding: '5px 8px', fontSize: 12, borderRadius: 5, border: '1px solid #D1D5DB', background: '#F9FAFB', outline: 'none', boxSizing: 'border-box' };
  const LB: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 2, display: 'block' };

  if (loading) return <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA' }}><CmsAdminNav /><div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>Loading...</div></div>;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter',sans-serif" }}>
      <CmsAdminNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '14px 24px 0' }}>
          <CertificatesHubTabs />
        </div>
        {/* Header */}
        <div style={{ padding: '14px 24px', background: '#fff', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0D2E5A' }}>Badge Editor</h1>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9CA3AF' }}>Configure Certificate ID and Issue Date text overlay</p>
          </div>
          {toast && <span style={{ fontSize: 12, fontWeight: 600, color: '#2EAA4A', padding: '4px 10px', background: '#F0FFF4', borderRadius: 6, border: '1px solid #BBF7D0' }}>{toast}</span>}
          <button onClick={() => setLayout(DEFAULTS)} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#6B7280' }}>Reset</button>
          <button onClick={handlePreview} disabled={!templateUrl || generating}
            style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151', opacity: (!templateUrl || generating) ? 0.5 : 1 }}>
            {generating ? 'Generating...' : 'Preview'}
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Save Layout'}
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* ── Controls ── */}
          <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Course */}
            <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #E5E7EB', padding: 12 }}>
              <div style={LB}>Course</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['3sfm', 'bvm'] as const).map(c => (
                  <button key={c} onClick={() => setCourse(c)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: course === c ? '#1B4F8A' : '#E5E7EB', color: course === c ? '#fff' : '#374151',
                  }}>{c.toUpperCase()}</button>
                ))}
              </div>
            </div>

            {/* Upload */}
            <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #E5E7EB', padding: 12 }}>
              <div style={LB}>Badge Template</div>
              <input ref={fileRef} type="file" accept=".png" onChange={handleUpload} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ width: '100%', padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid #1B4F8A', background: '#EFF6FF', color: '#1B4F8A', cursor: 'pointer' }}>
                {uploading ? 'Uploading...' : 'Upload PNG'}
              </button>
            </div>

            {/* Field editors */}
            {(['certificateId', 'issueDate'] as FieldKey[]).map(key => {
              const f = layout[key];
              return (
                <div key={key} style={{ background: '#fff', borderRadius: 8, border: `1px solid ${f.visible ? '#1B4F8A' : '#D1D5DB'}`, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: f.visible ? '#0D2E5A' : '#9CA3AF' }}>{FIELD_LABELS[key]}</span>
                    <button onClick={() => setField(key, 'visible', !f.visible)}
                      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid', cursor: 'pointer',
                        background: f.visible ? '#EFF6FF' : '#F9FAFB', borderColor: f.visible ? '#1B4F8A' : '#D1D5DB', color: f.visible ? '#1B4F8A' : '#9CA3AF' }}>
                      {f.visible ? 'Visible' : 'Hidden'}
                    </button>
                  </div>
                  {f.visible && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                        <div><label style={LB}>X</label><input type="number" style={IS} value={f.x} onChange={e => setField(key, 'x', +e.target.value)} /></div>
                        <div><label style={LB}>Y (from bottom)</label><input type="number" style={IS} value={f.y} onChange={e => setField(key, 'y', +e.target.value)} /></div>
                        <div><label style={LB}>Size</label><input type="number" style={IS} value={f.fontSize} onChange={e => setField(key, 'fontSize', +e.target.value)} /></div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <label style={LB}>Color</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input type="color" value={f.color} onChange={e => setField(key, 'color', e.target.value)} style={{ width: 26, height: 26, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
                            <input style={IS} value={f.color} onChange={e => setField(key, 'color', e.target.value)} />
                          </div>
                        </div>
                        <div>
                          <label style={LB}>Align</label>
                          <div style={{ display: 'flex', gap: 2 }}>
                            {(['left', 'center', 'right'] as const).map(a => (
                              <button key={a} onClick={() => setField(key, 'textAlign', a)} style={{
                                padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                                border: '1px solid', background: f.textAlign === a ? '#1B4F8A' : '#F3F4F6',
                                borderColor: f.textAlign === a ? '#1B4F8A' : '#D1D5DB', color: f.textAlign === a ? '#fff' : '#6B7280',
                              }}>{a[0].toUpperCase()}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Preview ── */}
          <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Live preview */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Live Preview</div>
              <div style={{ position: 'relative', width: PW, height: PH, background: '#1a1a1a', borderRadius: 8, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                {templateUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={templateUrl} alt="Badge" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    {layout.certificateId.visible && (
                      <div style={{
                        position: 'absolute', left: 0, right: 0,
                        bottom: layout.certificateId.y * scale,
                        fontSize: layout.certificateId.fontSize * scale,
                        color: layout.certificateId.color,
                        textAlign: (layout.certificateId.textAlign ?? 'center') as React.CSSProperties['textAlign'],
                        paddingLeft: layout.certificateId.textAlign === 'left' ? layout.certificateId.x * scale : 0,
                        paddingRight: layout.certificateId.textAlign === 'right' ? layout.certificateId.x * scale : 0,
                        transform: layout.certificateId.textAlign === 'center' ? `translateX(${layout.certificateId.x * scale}px)` : 'none',
                        lineHeight: 1, pointerEvents: 'none', fontFamily: 'sans-serif',
                      }}>{SAMPLE.certificateId}</div>
                    )}
                    {layout.issueDate.visible && (
                      <div style={{
                        position: 'absolute', left: 0, right: 0,
                        bottom: layout.issueDate.y * scale,
                        fontSize: layout.issueDate.fontSize * scale,
                        color: layout.issueDate.color,
                        textAlign: (layout.issueDate.textAlign ?? 'center') as React.CSSProperties['textAlign'],
                        paddingLeft: layout.issueDate.textAlign === 'left' ? layout.issueDate.x * scale : 0,
                        paddingRight: layout.issueDate.textAlign === 'right' ? layout.issueDate.x * scale : 0,
                        transform: layout.issueDate.textAlign === 'center' ? `translateX(${layout.issueDate.x * scale}px)` : 'none',
                        lineHeight: 1, pointerEvents: 'none', fontFamily: 'sans-serif',
                      }}>{SAMPLE.issueDate}</div>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6B7280', fontSize: 13 }}>Upload a PNG template</div>
                )}
              </div>
            </div>

            {/* Server preview */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Uploaded Template</div>
                <div style={{ background: '#1a1a1a', borderRadius: 8, border: '1px solid #E5E7EB', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {templateUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={templateUrl} alt="Template" style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }} />
                    : <span style={{ color: '#6B7280', fontSize: 12 }}>No template</span>}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Server Preview (actual output)</div>
                <div style={{ background: '#1a1a1a', borderRadius: 8, border: `1px solid ${previewUrl ? '#BBF7D0' : '#E5E7EB'}`, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {previewUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={previewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }} />
                    : <span style={{ color: '#6B7280', fontSize: 12 }}>{templateUrl ? 'Click Preview or Save' : 'Upload template first'}</span>}
                </div>
                {previewUrl && (
                  <a href={previewUrl} download={`${course}-badge-preview.png`}
                    style={{ display: 'block', marginTop: 8, padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 600, textAlign: 'center', textDecoration: 'none', background: '#1B4F8A', color: '#fff' }}>
                    Download Preview
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
