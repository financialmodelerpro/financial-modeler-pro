'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PdfField {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string; // 'Helvetica' | 'Times-Roman' | 'Courier'
}

interface PdfQrField {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfLayout {
  studentName?:       PdfField;
  courseName?:        PdfField;
  courseSubheading?:  PdfField;
  courseDescription?: PdfField;
  issueDate?:         PdfField;
  certificateId?:     PdfField;
  qrCode?:            PdfQrField;
}

type PdfFieldKey = keyof PdfLayout;

// ── Constants ─────────────────────────────────────────────────────────────────

const CANVAS_W   = 1240;
const CANVAS_H   = 877;
const SCALE      = 0.65;
const MARKER_W   = 320; // default text marker width

const DEFAULT_PDF_LAYOUT: PdfLayout = {
  studentName:       { x: 180, y: 310, fontSize: 36, color: '#0D2E5A', fontWeight: 'bold',  textAlign: 'left', fontFamily: 'Helvetica' },
  courseName:        { x: 180, y: 380, fontSize: 26, color: '#C9A84C', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica' },
  courseSubheading:  { x: 180, y: 425, fontSize: 16, color: '#374151', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica' },
  courseDescription: { x: 180, y: 460, fontSize: 13, color: '#6B7280', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica' },
  issueDate:         { x: 180, y: 530, fontSize: 14, color: '#374151', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica' },
  certificateId:     { x: 180, y: 560, fontSize: 12, color: '#9CA3AF', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica' },
  qrCode:            { x: 1050, y: 680, width: 130, height: 130 },
};

const PDF_FIELD_LABELS: Record<PdfFieldKey, string> = {
  studentName:       'Student Name',
  courseName:        'Course Name',
  courseSubheading:  'Course Subheading',
  courseDescription: 'Course Description',
  issueDate:         'Issue Date',
  certificateId:     'Certificate ID',
  qrCode:            'QR Code',
};

const SAMPLE_TEXT: Record<PdfFieldKey, string> = {
  studentName:       'Ahmad Din',
  courseName:        '3-Statement Financial Modeling',
  courseSubheading:  'Corporate Finance Track',
  courseDescription: 'Successfully completed with Distinction',
  issueDate:         '15 January 2026',
  certificateId:     'FMP-3SFM-2026-0001',
  qrCode:            '',
};

const FONT_OPTIONS = [
  { value: 'Helvetica',   label: 'Helvetica' },
  { value: 'Times-Roman', label: 'Times Roman' },
  { value: 'Courier',     label: 'Courier' },
];

const CSS_FONT: Record<string, string> = {
  'Helvetica':   'Arial, Helvetica, sans-serif',
  'Times-Roman': '"Times New Roman", Times, serif',
  'Courier':     '"Courier New", Courier, monospace',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the CSS left offset for a text marker given its alignment */
function alignOffset(textAlign: string | undefined): number {
  if (textAlign === 'center') return -MARKER_W / 2;
  if (textAlign === 'right')  return -MARKER_W;
  return 0;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CertificateEditorPage() {
  const [pdfLayout,      setPdfLayout]      = useState<PdfLayout>(DEFAULT_PDF_LAYOUT);
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState('');
  const [loading,        setLoading]        = useState(true);
  const [templateBg,     setTemplateBg]     = useState<string | null>(null);
  const [course,         setCourse]         = useState<'3sfm' | 'bvm'>('3sfm');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Active drag key — only for visual feedback
  const [activeKey, setActiveKey] = useState<PdfFieldKey | null>(null);

  // Refs for drag state (avoids stale closures in window listeners)
  const canvasRef      = useRef<HTMLDivElement>(null);
  const draggingKeyRef = useRef<PdfFieldKey | null>(null);
  const dragOffsetRef  = useRef({ x: 0, y: 0 });

  // ── Load pdfLayout from API ──
  useEffect(() => {
    fetch('/api/admin/certificate-layout')
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.pdfLayout) setPdfLayout(d.pdfLayout as PdfLayout);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Load template background when course changes ──
  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { publicUrl } } = sb.storage
      .from('certificates')
      .getPublicUrl(`templates/${course.toLowerCase()}-template.pdf`);
    fetch(publicUrl, { method: 'HEAD' })
      .then(res => { setTemplateBg(res.ok ? publicUrl : null); })
      .catch(() => { setTemplateBg(null); });
  }, [course]);

  // ── Global mouse handlers for drag ──
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const key = draggingKeyRef.current;
      if (!key || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const logX = (e.clientX - rect.left) / SCALE;
      const logY = (e.clientY - rect.top)  / SCALE;
      const newX = Math.round(Math.max(0, Math.min(CANVAS_W - 10, logX - dragOffsetRef.current.x)));
      const newY = Math.round(Math.max(0, Math.min(CANVAS_H - 10, logY - dragOffsetRef.current.y)));
      setPdfLayout(prev => {
        const existing = prev[key];
        if (!existing) return prev;
        return { ...prev, [key]: { ...existing, x: newX, y: newY } };
      });
    }
    function onMouseUp() {
      if (draggingKeyRef.current) {
        draggingKeyRef.current = null;
        setActiveKey(null);
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  // ── Start dragging ──
  const handleMarkerMouseDown = useCallback(
    (e: React.MouseEvent, key: PdfFieldKey) => {
      e.preventDefault();
      if (!canvasRef.current) return;
      const rect  = canvasRef.current.getBoundingClientRect();
      const logX  = (e.clientX - rect.left) / SCALE;
      const logY  = (e.clientY - rect.top)  / SCALE;
      const curX  = (pdfLayout[key] as { x: number } | undefined)?.x ?? 0;
      const curY  = (pdfLayout[key] as { y: number } | undefined)?.y ?? 0;
      dragOffsetRef.current  = { x: logX - curX, y: logY - curY };
      draggingKeyRef.current = key;
      setActiveKey(key);
    },
    [pdfLayout],
  );

  // ── Save layout ──
  async function handleSave() {
    setSaving(true);
    setSaveMsg('');
    try {
      const r = await fetch('/api/admin/certificate-layout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pdfLayout }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setSaveMsg('Saved!');
        setTimeout(() => setSaveMsg(''), 2500);
      } else {
        setSaveMsg(d.error ?? 'Error saving');
      }
    } catch (e) {
      setSaveMsg(String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Generate PDF preview with sample data ──
  async function handlePreview() {
    setPreviewLoading(true);
    try {
      const res = await fetch('/api/admin/certificate-layout/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pdfLayout, course }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        alert(`Preview failed: ${err.error ?? res.statusText}`);
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(`Preview failed: ${String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  }

  // ── Update a single field value ──
  function handleFieldChange(key: PdfFieldKey, field: string, value: string | number) {
    setPdfLayout(prev => {
      const existing = prev[key] ?? (
        key === 'qrCode'
          ? { x: 0, y: 0, width: 120, height: 120 }
          : { x: 0, y: 0, fontSize: 14, color: '#000000', textAlign: 'left' as const, fontFamily: 'Helvetica' }
      );
      return { ...prev, [key]: { ...existing, [field]: value } };
    });
  }

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

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* ── Header ── */}
        <div style={{
          padding: '16px 24px', background: '#fff',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0D2E5A' }}>
              🎨 Certificate Editor
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9CA3AF' }}>
              Drag fields to reposition. Sample text shows live on canvas. Save then Preview to generate PDF.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {saveMsg && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color:      saveMsg === 'Saved!' ? '#2EAA4A' : '#DC2626',
                padding:   '6px 12px',
                background: saveMsg === 'Saved!' ? '#F0FFF4' : '#FEF2F2',
                borderRadius: 6,
                border: `1px solid ${saveMsg === 'Saved!' ? '#BBF7D0' : '#FECACA'}`,
              }}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={handlePreview}
              disabled={previewLoading}
              style={{ padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: previewLoading ? 'not-allowed' : 'pointer', background: previewLoading ? '#E5E7EB' : '#fff', border: '1px solid #D1D5DB', color: '#374151' }}
            >
              {previewLoading ? 'Generating…' : 'Preview PDF ↗'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '8px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#9CA3AF' : '#2EAA4A', border: 'none', color: '#fff' }}
            >
              {saving ? 'Saving…' : 'Save Layout'}
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ display: 'flex', flex: 1, gap: 24, padding: 24, overflow: 'auto', minHeight: 0 }}>

          {/* ── Canvas area ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

            {/* Course selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>Course:</span>
              {(['3sfm', 'bvm'] as const).map(c => (
                <button key={c} onClick={() => setCourse(c)}
                  style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: course === c ? '#1B4F8A' : '#E5E7EB', color: course === c ? '#fff' : '#374151' }}>
                  {c.toUpperCase()}
                </button>
              ))}
              <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>
                Upload templates at{' '}
                <a href="/admin/certificates" style={{ color: '#1B4F8A' }}>/admin/certificates</a>
              </span>
            </div>

            {/* Canvas */}
            <div
              ref={canvasRef}
              style={{
                position:        'relative',
                width:           CANVAS_W * SCALE,
                height:          CANVAS_H * SCALE,
                overflow:        'hidden',
                border:          '1px solid #ddd',
                backgroundColor: '#fff',
                boxShadow:       '0 8px 40px rgba(0,0,0,0.15)',
                borderRadius:    4,
                flexShrink:      0,
                userSelect:      'none',
                cursor:          activeKey ? 'grabbing' : 'default',
              }}
            >
              {/* PDF background */}
              {templateBg ? (
                <object
                  data={`${templateBg}#toolbar=0&navpanes=0`}
                  type="application/pdf"
                  style={{
                    position:        'absolute',
                    top: 0, left: 0,
                    width:           `${CANVAS_W}px`,
                    height:          `${CANVAS_H}px`,
                    transform:       `scale(${SCALE})`,
                    transformOrigin: 'top left',
                    border:          'none',
                    pointerEvents:   'none',
                  }}
                >
                  <p style={{ color: '#999', fontSize: 13, padding: 20 }}>
                    PDF preview not available in this browser
                  </p>
                </object>
              ) : (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#ccc', fontSize: 14, textAlign: 'center', padding: 20,
                }}>
                  📄 Upload a PDF template at /admin/certificates to see background
                </div>
              )}

              {/* Field markers — 1240×877 unscaled coordinate space */}
              <div style={{
                position:        'absolute',
                top: 0, left: 0,
                width:           CANVAS_W,
                height:          CANVAS_H,
                transform:       `scale(${SCALE})`,
                transformOrigin: 'top left',
                zIndex:          1,
                pointerEvents:   'none',
              }}>
                {(Object.keys(pdfLayout) as PdfFieldKey[]).map(key => {
                  const field      = pdfLayout[key];
                  if (!field) return null;
                  const isQr       = key === 'qrCode';
                  const qr         = field as PdfQrField;
                  const tf         = field as PdfField;
                  const isDragging = activeKey === key;
                  const sample     = SAMPLE_TEXT[key];
                  const align      = tf.textAlign ?? 'left';
                  const cssFont    = CSS_FONT[tf.fontFamily ?? 'Helvetica'] ?? CSS_FONT['Helvetica'];

                  // Adjust marker left based on text alignment
                  const markerLeft = isQr ? qr.x : (tf.x + alignOffset(align));
                  const markerTop  = isQr ? qr.y : tf.y;
                  const markerW    = isQr ? qr.width  : MARKER_W;
                  const markerH    = isQr ? qr.height : Math.max(tf.fontSize + 10, 28);

                  return (
                    <div
                      key={key}
                      onMouseDown={e => handleMarkerMouseDown(e, key)}
                      style={{
                        position:      'absolute',
                        left:          markerLeft,
                        top:           markerTop,
                        width:         markerW,
                        height:        markerH,
                        border:        `2px ${isDragging ? 'solid' : 'dashed'} ${isDragging ? '#3B82F6' : '#10B981'}`,
                        background:    isDragging ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.55)',
                        pointerEvents: 'auto',
                        cursor:        isDragging ? 'grabbing' : 'grab',
                        boxSizing:     'border-box',
                        overflow:      'hidden',
                        display:       'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                      }}
                    >
                      {isQr ? (
                        // QR placeholder
                        <div style={{
                          width: '100%', height: '100%',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          background: 'repeating-linear-gradient(45deg, #e5e7eb 0px, #e5e7eb 4px, #f3f4f6 4px, #f3f4f6 12px)',
                          fontSize: 10, color: '#6B7280', fontWeight: 700, gap: 4,
                        }}>
                          <span style={{ fontSize: 22 }}>▦</span>
                          <span>QR CODE</span>
                          <span style={{ fontSize: 9, fontWeight: 400 }}>{qr.width}×{qr.height}</span>
                        </div>
                      ) : (
                        // Sample text
                        <div style={{
                          padding:     '0 4px',
                          fontSize:    tf.fontSize,
                          fontWeight:  tf.fontWeight === 'bold' ? 700 : 400,
                          color:       tf.color,
                          fontFamily:  cssFont,
                          textAlign:   align as React.CSSProperties['textAlign'],
                          lineHeight:  1,
                          whiteSpace:  'nowrap',
                          overflow:    'hidden',
                          textOverflow: 'ellipsis',
                          width:       '100%',
                        }}>
                          {sample}
                        </div>
                      )}

                      {/* Label chip — top-left corner */}
                      <div style={{
                        position:   'absolute',
                        top: 0, left: 0,
                        fontSize:   7,
                        fontWeight: 800,
                        color:      isDragging ? '#3B82F6' : '#10B981',
                        background: 'rgba(255,255,255,0.92)',
                        padding:    '1px 3px',
                        lineHeight: 1.5,
                        borderRadius: '0 0 3px 0',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                      }}>
                        {PDF_FIELD_LABELS[key]}
                        {isDragging && (
                          <span style={{ marginLeft: 4, color: '#6B7280', fontWeight: 400 }}>
                            ({isQr ? qr.x : tf.x}, {isQr ? qr.y : tf.y})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div style={{ width: 256, flexShrink: 0 }}>
            <div style={{
              background:   '#fff',
              borderRadius: 10,
              border:       '1px solid #10B981',
              padding:      16,
              boxShadow:    '0 2px 12px rgba(0,0,0,0.05)',
              maxHeight:    'calc(100vh - 160px)',
              overflowY:    'auto',
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                PDF Field Positions
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 12, lineHeight: 1.5 }}>
                Drag on canvas or type values. Coords are in 1240×877 unscaled space.
              </div>

              {(Object.keys(pdfLayout) as PdfFieldKey[]).map(key => {
                const field    = pdfLayout[key];
                if (!field) return null;
                const isQr     = key === 'qrCode';
                const qr       = field as PdfQrField;
                const tf       = field as PdfField;
                const isActive = activeKey === key;

                return (
                  <div key={key} style={{
                    marginBottom:  12,
                    paddingBottom: 12,
                    borderBottom:  '1px solid #F3F4F6',
                    borderRadius:  6,
                    outline:       isActive ? '2px solid #3B82F6' : 'none',
                    outlineOffset: 3,
                  }}>
                    {/* Field label */}
                    <div style={{ fontSize: 10, fontWeight: 800, color: isActive ? '#3B82F6' : '#374151', marginBottom: 6 }}>
                      {PDF_FIELD_LABELS[key]}
                    </div>

                    {isQr ? (
                      // QR: X / Y / W / H
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {(['x', 'y', 'width', 'height'] as const).map(f => (
                          <div key={f}>
                            <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>{f.toUpperCase()}</div>
                            <input
                              type="number"
                              value={qr[f]}
                              onChange={e => handleFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                              style={inputStyle}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

                        {/* Row 1: X / Y / SIZE */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                          {(['x', 'y', 'fontSize'] as const).map(f => (
                            <div key={f}>
                              <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>{f === 'fontSize' ? 'SIZE' : f.toUpperCase()}</div>
                              <input
                                type="number"
                                value={tf[f]}
                                onChange={e => handleFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                                style={{ ...inputStyle, background: isActive ? '#EFF6FF' : '#F0FFF4' }}
                              />
                            </div>
                          ))}
                        </div>

                        {/* Row 2: Align + Bold */}
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <div style={{ fontSize: 9, color: '#9CA3AF', marginRight: 2 }}>ALIGN</div>
                          {(['left', 'center', 'right'] as const).map(a => (
                            <button
                              key={a}
                              onClick={() => handleFieldChange(key, 'textAlign', a)}
                              style={{
                                padding: '3px 7px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                border: '1px solid',
                                cursor: 'pointer',
                                background: tf.textAlign === a ? '#1B4F8A' : '#F3F4F6',
                                borderColor: tf.textAlign === a ? '#1B4F8A' : '#D1D5DB',
                                color: tf.textAlign === a ? '#fff' : '#6B7280',
                              }}
                              title={`Align ${a}`}
                            >
                              {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
                            </button>
                          ))}
                          <div style={{ marginLeft: 6, fontSize: 9, color: '#9CA3AF' }}>BOLD</div>
                          <button
                            onClick={() => handleFieldChange(key, 'fontWeight', tf.fontWeight === 'bold' ? 'normal' : 'bold')}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 800,
                              border: '1px solid',
                              cursor: 'pointer',
                              background: tf.fontWeight === 'bold' ? '#1B4F8A' : '#F3F4F6',
                              borderColor: tf.fontWeight === 'bold' ? '#1B4F8A' : '#D1D5DB',
                              color: tf.fontWeight === 'bold' ? '#fff' : '#6B7280',
                            }}
                          >
                            B
                          </button>
                        </div>

                        {/* Row 3: Font family */}
                        <div>
                          <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>FONT</div>
                          <select
                            value={tf.fontFamily ?? 'Helvetica'}
                            onChange={e => handleFieldChange(key, 'fontFamily', e.target.value)}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              padding: '4px 6px', borderRadius: 4,
                              border: '1px solid #D1D5DB', fontSize: 11,
                              background: '#F0FFF4', outline: 'none',
                              fontFamily: CSS_FONT[tf.fontFamily ?? 'Helvetica'],
                              cursor: 'pointer',
                            }}
                          >
                            {FONT_OPTIONS.map(o => (
                              <option key={o.value} value={o.value} style={{ fontFamily: CSS_FONT[o.value] }}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Row 4: Color */}
                        <div>
                          <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>COLOR</div>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input
                              type="color"
                              value={tf.color}
                              onChange={e => handleFieldChange(key, 'color', e.target.value)}
                              style={{ width: 32, height: 24, padding: 0, border: '1px solid #D1D5DB', borderRadius: 3, cursor: 'pointer' }}
                            />
                            <input
                              type="text"
                              value={tf.color}
                              onChange={e => handleFieldChange(key, 'color', e.target.value)}
                              style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: '#F0FFF4', outline: 'none', fontFamily: 'monospace' }}
                            />
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

// ── Shared input style ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid #D1D5DB',
  fontSize: 11,
  background: '#F0FFF4',
  outline: 'none',
};
