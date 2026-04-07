'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

type Course = '3sfm' | 'bvm';

// ── Badge Layout Types ───────────────────────────────────────────────────────

interface BadgeTextField {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  visible: boolean;
}

interface BadgeLayout {
  certificateId: BadgeTextField;
  issueDate:     BadgeTextField;
}

type BadgeFieldKey = 'certificateId' | 'issueDate';

const DEFAULT_BADGE_LAYOUT: BadgeLayout = {
  certificateId: { x: 0, y: 44, fontSize: 12, color: '#ffffff', fontFamily: 'Arial', textAlign: 'center', visible: true },
  issueDate:     { x: 0, y: 22, fontSize: 11, color: 'rgba(255,255,255,0.8)', fontFamily: 'Arial', textAlign: 'center', visible: true },
};

const FIELD_LABELS: Record<BadgeFieldKey, string> = {
  certificateId: 'Certificate ID',
  issueDate:     'Issue Date',
};

const SAMPLE_TEXT: Record<BadgeFieldKey, string> = {
  certificateId: 'FMP-3SFM-2026-0001',
  issueDate:     '15 January 2026',
};

const FONT_OPTIONS = [
  { value: 'Arial',         label: 'Arial' },
  { value: 'Helvetica',     label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New',   label: 'Courier New' },
  { value: 'Georgia',       label: 'Georgia' },
];

const ALL_FIELD_KEYS: BadgeFieldKey[] = ['certificateId', 'issueDate'];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BadgeEditorPage() {
  const [course,      setCourse]      = useState<Course>('3sfm');
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState('');
  const [isError,     setIsError]     = useState(false);
  const [layout,      setLayout]      = useState<BadgeLayout>(DEFAULT_BADGE_LAYOUT);
  const [badgeSize,   setBadgeSize]   = useState<{ w: number; h: number }>({ w: 600, h: 600 });
  const fileRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string, error = false) {
    setToast(msg);
    setIsError(error);
    setTimeout(() => setToast(''), 4000);
  }

  // Load badge layout from API
  useEffect(() => {
    fetch('/api/admin/badge-layout')
      .then(r => r.json())
      .then((d: { layout?: BadgeLayout }) => {
        if (d.layout) {
          setLayout({
            certificateId: { ...DEFAULT_BADGE_LAYOUT.certificateId, ...d.layout.certificateId },
            issueDate:     { ...DEFAULT_BADGE_LAYOUT.issueDate,     ...d.layout.issueDate },
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load badge template from Supabase storage on course change
  useEffect(() => {
    setTemplateUrl(null);
    setPreviewUrl(null);

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { data: { publicUrl } } = sb.storage
      .from('badges')
      .getPublicUrl(`templates/${course}-badge.png`);

    const bust = `${publicUrl}?t=${Date.now()}`;

    fetch(bust, { method: 'HEAD' })
      .then(res => {
        if (res.ok) {
          setTemplateUrl(bust);
          // Load image to detect dimensions
          const img = new Image();
          img.onload = () => setBadgeSize({ w: img.naturalWidth, h: img.naturalHeight });
          img.src = bust;
        }
      })
      .catch(() => {});
  }, [course]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.png')) {
      showToast('Only PNG files are accepted for badge templates.', true);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', `${course}-badge`);

      const res  = await fetch('/api/admin/certificates/upload-template', { method: 'POST', body: form });
      const json = await res.json() as { success?: boolean; url?: string; error?: string };

      if (json.success) {
        const url = `${json.url}?t=${Date.now()}`;
        setTemplateUrl(url);
        setPreviewUrl(null);
        showToast('Badge template uploaded successfully.');
        // Detect dimensions
        const img = new Image();
        img.onload = () => setBadgeSize({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = url;
      } else {
        showToast(`Upload failed: ${json.error ?? 'Unknown error'}`, true);
      }
    } catch {
      showToast('Upload failed: network error.', true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete the ${course.toUpperCase()} badge template? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res  = await fetch('/api/admin/certificates/upload-template', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: `${course}-badge` }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (json.success) {
        setTemplateUrl(null);
        setPreviewUrl(null);
        showToast('Badge template deleted.');
      } else {
        showToast(`Delete failed: ${json.error ?? 'Unknown error'}`, true);
      }
    } catch {
      showToast('Delete failed: network error.', true);
    } finally {
      setDeleting(false);
    }
  }

  async function handleGeneratePreview() {
    setGenerating(true);
    setPreviewUrl(null);
    try {
      const res = await fetch('/api/admin/badge-preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ course, layout }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        showToast(`Preview failed: ${err.error ?? res.statusText}`, true);
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (e) {
      showToast(`Preview failed: ${String(e)}`, true);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch('/api/admin/badge-layout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ layout }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        showToast('Layout saved!');
        // Auto-generate preview after saving
        void handleGeneratePreview();
      } else {
        showToast(d.error ?? 'Error saving', true);
      }
    } catch (e) {
      showToast(String(e), true);
    } finally {
      setSaving(false);
    }
  }

  function handleFieldChange(key: BadgeFieldKey, field: string, value: string | number | boolean) {
    setLayout(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  function handleResetDefaults() {
    if (!confirm('Reset all fields to default positions?')) return;
    setLayout(DEFAULT_BADGE_LAYOUT);
  }

  // ── Canvas preview dimensions ──
  const CANVAS_W = 400;
  const canvasScale = CANVAS_W / badgeSize.w;
  const canvasH = Math.round(badgeSize.h * canvasScale);

  // ── Styles ─────────────────────────────────────────────────────────────────

  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 16,
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 800, color: '#9CA3AF',
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: 9, color: '#9CA3AF', marginBottom: 2,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '4px 6px', borderRadius: 4,
    border: '1px solid #D1D5DB', fontSize: 11,
    background: '#F0FFF4', outline: 'none',
  };

  const stepBtnStyle: React.CSSProperties = {
    width: 20, height: 22, padding: 0, flexShrink: 0,
    borderRadius: 3, border: '1px solid #D1D5DB',
    background: '#F3F4F6', cursor: 'pointer',
    fontSize: 14, fontWeight: 700, color: '#374151',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  };

  const btnPrimary: React.CSSProperties = {
    padding: '10px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700,
    border: 'none', cursor: 'pointer', background: '#2EAA4A', color: '#fff',
  };

  const btnSecondary: React.CSSProperties = {
    width: '100%', padding: '9px 0', borderRadius: 7, fontSize: 13, fontWeight: 700,
    border: '1px solid #1B4F8A', cursor: 'pointer', background: '#EFF6FF', color: '#1B4F8A',
  };

  const btnDanger: React.CSSProperties = {
    width: '100%', marginTop: 8, padding: '7px 0', borderRadius: 7, fontSize: 12,
    fontWeight: 600, border: '1px solid #FECACA', cursor: 'pointer',
    background: '#FEF2F2', color: '#DC2626',
  };

  const imgBox: React.CSSProperties = {
    background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB',
    minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  };

  const placeholder: React.CSSProperties = {
    textAlign: 'center', color: '#9CA3AF', padding: 24,
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA' }}>
        <CmsAdminNav />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
          Loading layout…
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* ── Header ── */}
        <div style={{
          padding: '16px 24px', background: '#fff',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0D2E5A' }}>
              Badge Editor
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9CA3AF' }}>
              Upload badge templates · Configure Certificate ID and Issue Date overlay positions
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {toast && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color:      isError ? '#DC2626' : '#065F46',
                padding:    '6px 12px', borderRadius: 6,
                background: isError ? '#FEF2F2' : '#F0FFF4',
                border:     `1px solid ${isError ? '#FECACA' : '#BBF7D0'}`,
              }}>
                {toast}
              </span>
            )}
            <button
              onClick={handleResetDefaults}
              title="Reset all fields to default positions"
              style={{ padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#fff', border: '1px solid #D1D5DB', color: '#6B7280' }}
            >
              Reset
            </button>
            <button
              onClick={handleGeneratePreview}
              disabled={!templateUrl || generating}
              style={{ padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: (!templateUrl || generating) ? 'not-allowed' : 'pointer', background: (!templateUrl || generating) ? '#E5E7EB' : '#fff', border: '1px solid #D1D5DB', color: '#374151', opacity: (!templateUrl || generating) ? 0.5 : 1 }}
            >
              {generating ? 'Generating...' : 'Preview'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...btnPrimary, opacity: saving ? 0.5 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving...' : 'Save Layout'}
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: 24, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* ── Left panel — controls ── */}
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Course selector */}
            <div style={cardStyle}>
              <div style={sectionLabel}>Course</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['3sfm', 'bvm'] as const).map(c => (
                  <button key={c} onClick={() => setCourse(c)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, fontSize: 13, fontWeight: 700,
                    border: 'none', cursor: 'pointer',
                    background: course === c ? '#1B4F8A' : '#E5E7EB',
                    color:      course === c ? '#fff'    : '#374151',
                  }}>
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Upload */}
            <div style={cardStyle}>
              <div style={sectionLabel}>Badge Template PNG</div>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6B7280', lineHeight: 1.6 }}>
                Upload a square PNG (recommended 600x600 or 800x800 px).
              </p>
              <input ref={fileRef} type="file" accept=".png" onChange={handleUpload}
                style={{ display: 'none' }} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{ ...btnSecondary, opacity: uploading ? 0.6 : 1, cursor: uploading ? 'not-allowed' : 'pointer' }}
              >
                {uploading ? 'Uploading...' : 'Upload PNG'}
              </button>
              {templateUrl && (
                <button onClick={handleDelete} disabled={deleting}
                  style={{ ...btnDanger, opacity: deleting ? 0.6 : 1, cursor: deleting ? 'not-allowed' : 'pointer' }}>
                  {deleting ? 'Deleting...' : 'Delete Template'}
                </button>
              )}
              {templateUrl && (
                <div style={{ marginTop: 8, fontSize: 10, color: '#9CA3AF', fontFamily: 'monospace' }}>
                  Image: {badgeSize.w} x {badgeSize.h} px
                </div>
              )}
            </div>

            {/* ── Text Field Editors ── */}
            {ALL_FIELD_KEYS.map(key => {
              const field = layout[key];
              return (
                <div key={key} style={{ ...cardStyle, border: `1px solid ${field.visible ? '#1B4F8A' : '#D1D5DB'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: field.visible ? '#1B4F8A' : '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {FIELD_LABELS[key]}
                    </div>
                    {/* Visible toggle */}
                    <button
                      onClick={() => handleFieldChange(key, 'visible', !field.visible)}
                      title={field.visible ? 'Hide this field' : 'Show this field'}
                      style={{
                        padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                        border: '1px solid', cursor: 'pointer',
                        background:  field.visible ? '#EFF6FF' : '#F9FAFB',
                        borderColor: field.visible ? '#1B4F8A' : '#D1D5DB',
                        color:       field.visible ? '#1B4F8A' : '#9CA3AF',
                      }}
                    >
                      {field.visible ? 'Visible' : 'Hidden'}
                    </button>
                  </div>

                  {field.visible && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {/* X / Y / SIZE grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                        {([
                          { f: 'x',        label: 'X',    step: 1 },
                          { f: 'y',        label: 'Y (from bottom)', step: 1 },
                          { f: 'fontSize', label: 'SIZE', step: 1 },
                        ] as const).map(({ f, label, step }) => {
                          const val = field[f as keyof BadgeTextField] as number;
                          const min = f === 'fontSize' ? 6 : f === 'y' ? 0 : -999;
                          return (
                            <div key={f}>
                              <div style={fieldLabel}>{label}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <button onClick={() => handleFieldChange(key, f, Math.max(min, val - step))} style={stepBtnStyle}>-</button>
                                <input type="number" value={val}
                                  onChange={e => handleFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                                  style={{ ...inputStyle, textAlign: 'center', minWidth: 0 }}
                                />
                                <button onClick={() => handleFieldChange(key, f, val + step)} style={stepBtnStyle}>+</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Text Align */}
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <div style={{ fontSize: 9, color: '#9CA3AF', marginRight: 2 }}>ALIGN</div>
                        {(['left', 'center', 'right'] as const).map(a => (
                          <button key={a} onClick={() => handleFieldChange(key, 'textAlign', a)}
                            style={{
                              flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 11,
                              fontWeight: 700, border: '1px solid', cursor: 'pointer',
                              background:  (field.textAlign ?? 'center') === a ? '#1B4F8A' : '#F3F4F6',
                              borderColor: (field.textAlign ?? 'center') === a ? '#1B4F8A' : '#D1D5DB',
                              color:       (field.textAlign ?? 'center') === a ? '#fff' : '#6B7280',
                            }}>
                            {a.charAt(0).toUpperCase() + a.slice(1)}
                          </button>
                        ))}
                      </div>

                      {/* Font */}
                      <div>
                        <div style={fieldLabel}>FONT</div>
                        <select value={field.fontFamily ?? 'Arial'}
                          onChange={e => handleFieldChange(key, 'fontFamily', e.target.value)}
                          style={{
                            width: '100%', boxSizing: 'border-box', padding: '4px 6px',
                            borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11,
                            background: '#F0FFF4', outline: 'none', cursor: 'pointer',
                            fontFamily: field.fontFamily ?? 'Arial',
                          }}>
                          {FONT_OPTIONS.map(o => (
                            <option key={o.value} value={o.value} style={{ fontFamily: o.value }}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Color */}
                      <div>
                        <div style={fieldLabel}>COLOR</div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input type="color" value={field.color.startsWith('rgba') ? '#ffffff' : field.color}
                            onChange={e => handleFieldChange(key, 'color', e.target.value)}
                            style={{ width: 28, height: 22, padding: 0, border: '1px solid #D1D5DB', borderRadius: 3, cursor: 'pointer' }} />
                          <input type="text" value={field.color}
                            onChange={e => handleFieldChange(key, 'color', e.target.value)}
                            style={{ flex: 1, ...inputStyle, fontFamily: 'monospace' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Preview panels ── */}
          <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Live canvas preview (CSS simulated) */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                Live Preview — {course.toUpperCase()}
              </div>
              <div style={{
                position: 'relative',
                width: CANVAS_W,
                height: canvasH,
                background: '#F9FAFB',
                borderRadius: 10,
                border: '1px solid #E5E7EB',
                overflow: 'hidden',
              }}>
                {templateUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={templateUrl}
                      alt={`${course} badge template`}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                    {/* Certificate ID text */}
                    {layout.certificateId.visible && (() => {
                      const f = layout.certificateId;
                      const fs = f.fontSize * canvasScale;
                      const align = f.textAlign ?? 'center';
                      // SVG: text baseline at y = bh - f.y → CSS top = canvasH - f.y*scale
                      // Offset up by ~80% of fontSize to approximate baseline alignment
                      const top = canvasH - f.y * canvasScale - fs * 0.8;
                      // SVG x: center = bw/2 + x, left = x, right = bw - x
                      const left = align === 'center' ? (CANVAS_W / 2 + f.x * canvasScale)
                                 : align === 'right'  ? (CANVAS_W - f.x * canvasScale)
                                 : (f.x * canvasScale);
                      return (
                        <div style={{
                          position: 'absolute',
                          top,
                          left,
                          transform: align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : 'none',
                          fontSize: fs,
                          color: f.color,
                          fontFamily: `${f.fontFamily ?? 'Arial'}, sans-serif`,
                          lineHeight: 1,
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}>
                          {SAMPLE_TEXT.certificateId}
                        </div>
                      );
                    })()}
                    {/* Issue Date text */}
                    {layout.issueDate.visible && (() => {
                      const f = layout.issueDate;
                      const fs = f.fontSize * canvasScale;
                      const align = f.textAlign ?? 'center';
                      const top = canvasH - f.y * canvasScale - fs * 0.8;
                      const left = align === 'center' ? (CANVAS_W / 2 + f.x * canvasScale)
                                 : align === 'right'  ? (CANVAS_W - f.x * canvasScale)
                                 : (f.x * canvasScale);
                      return (
                        <div style={{
                          position: 'absolute',
                          top,
                          left,
                          transform: align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : 'none',
                          fontSize: fs,
                          color: f.color,
                          fontFamily: `${f.fontFamily ?? 'Arial'}, sans-serif`,
                          lineHeight: 1,
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}>
                          {SAMPLE_TEXT.issueDate}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div style={placeholder}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>🎖</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No template uploaded</div>
                    <div style={{ fontSize: 11 }}>Upload a PNG badge template to see preview</div>
                  </div>
                )}
              </div>
            </div>

            {/* Server-rendered preview */}
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {/* Raw template */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                  Uploaded Template
                </div>
                <div style={imgBox}>
                  {templateUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={templateUrl}
                      alt={`${course} badge template`}
                      style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8 }}
                    />
                  ) : (
                    <div style={placeholder}>
                      <div style={{ fontSize: 30, marginBottom: 10 }}>📁</div>
                      <div style={{ fontSize: 12 }}>No template</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Server preview */}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                  Server Preview (actual output)
                </div>
                <div style={{ ...imgBox, borderColor: previewUrl ? '#BBF7D0' : '#E5E7EB' }}>
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Badge preview with overlay"
                      style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8 }}
                    />
                  ) : (
                    <div style={placeholder}>
                      <div style={{ fontSize: 30, marginBottom: 10 }}>🔍</div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {templateUrl ? 'Click Preview or Save Layout' : 'Upload a template first'}
                      </div>
                    </div>
                  )}
                </div>
                {previewUrl && (
                  <a
                    href={previewUrl}
                    download={`${course}-badge-preview.png`}
                    style={{
                      display: 'block', marginTop: 10, padding: '9px 16px',
                      borderRadius: 7, fontSize: 13, fontWeight: 600,
                      textAlign: 'center', textDecoration: 'none',
                      background: '#1B4F8A', color: '#fff',
                    }}
                  >
                    Download Preview PNG
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
