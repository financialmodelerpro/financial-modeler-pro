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
  fontFamily?: string;
  width?: number; // field box width in unscaled canvas coords
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

const CANVAS_W    = 1240;
const CANVAS_H    = 877;
const SCALE       = 0.65;
const MIN_W       = 60;   // minimum field width
const RESIZE_HANDLE_W = 12; // resize grip width in unscaled px

const DEFAULT_PDF_LAYOUT: PdfLayout = {
  studentName:       { x: 180, y: 310, fontSize: 36, color: '#0D2E5A', fontWeight: 'bold',   textAlign: 'left', fontFamily: 'Helvetica',   width: 620 },
  courseName:        { x: 180, y: 380, fontSize: 26, color: '#C9A84C', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica',   width: 680 },
  courseSubheading:  { x: 180, y: 425, fontSize: 16, color: '#374151', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica',   width: 500 },
  courseDescription: { x: 180, y: 460, fontSize: 13, color: '#6B7280', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica',   width: 660 },
  issueDate:         { x: 180, y: 530, fontSize: 14, color: '#374151', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica',   width: 300 },
  certificateId:     { x: 180, y: 560, fontSize: 12, color: '#9CA3AF', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica',   width: 320 },
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

function alignOffset(textAlign: string | undefined, width: number): number {
  if (textAlign === 'center') return -width / 2;
  if (textAlign === 'right')  return -width;
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

  // Active key — shared visual feedback for move AND resize
  const [activeKey, setActiveKey] = useState<PdfFieldKey | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Refs — avoids stale closures in window event listeners
  const canvasRef       = useRef<HTMLDivElement>(null);
  const draggingKeyRef  = useRef<PdfFieldKey | null>(null);
  const dragOffsetRef   = useRef({ x: 0, y: 0 });
  const resizingKeyRef  = useRef<PdfFieldKey | null>(null);
  const resizeStartRef  = useRef({ startLogX: 0, startWidth: 0 });

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

  // ── Load template background ──
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

  // ── Global mouse handlers — shared by drag-move AND drag-resize ──
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const logX = (e.clientX - rect.left) / SCALE;
      const logY = (e.clientY - rect.top)  / SCALE;

      // Resize takes priority
      const rKey = resizingKeyRef.current;
      if (rKey) {
        const delta    = logX - resizeStartRef.current.startLogX;
        const newWidth = Math.round(Math.max(MIN_W, Math.min(CANVAS_W, resizeStartRef.current.startWidth + delta)));
        setPdfLayout(prev => {
          const f = prev[rKey];
          if (!f) return prev;
          return { ...prev, [rKey]: { ...f, width: newWidth } };
        });
        return;
      }

      // Move
      const mKey = draggingKeyRef.current;
      if (mKey) {
        const newX = Math.round(Math.max(0, Math.min(CANVAS_W - 10, logX - dragOffsetRef.current.x)));
        const newY = Math.round(Math.max(0, Math.min(CANVAS_H - 10, logY - dragOffsetRef.current.y)));
        setPdfLayout(prev => {
          const f = prev[mKey];
          if (!f) return prev;
          return { ...prev, [mKey]: { ...f, x: newX, y: newY } };
        });
      }
    }

    function onMouseUp() {
      if (resizingKeyRef.current || draggingKeyRef.current) {
        resizingKeyRef.current = null;
        draggingKeyRef.current = null;
        setActiveKey(null);
        setIsResizing(false);
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  // ── Start drag-to-move ──
  const handleMarkerMouseDown = useCallback((e: React.MouseEvent, key: PdfFieldKey) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const logX = (e.clientX - rect.left) / SCALE;
    const logY = (e.clientY - rect.top)  / SCALE;
    const curX = (pdfLayout[key] as { x: number } | undefined)?.x ?? 0;
    const curY = (pdfLayout[key] as { y: number } | undefined)?.y ?? 0;
    dragOffsetRef.current  = { x: logX - curX, y: logY - curY };
    draggingKeyRef.current = key;
    setActiveKey(key);
    setIsResizing(false);
  }, [pdfLayout]);

  // ── Start drag-to-resize ──
  const handleResizerMouseDown = useCallback((e: React.MouseEvent, key: PdfFieldKey) => {
    e.preventDefault();
    e.stopPropagation(); // don't trigger parent marker's move handler
    if (!canvasRef.current) return;
    const rect       = canvasRef.current.getBoundingClientRect();
    const startLogX  = (e.clientX - rect.left) / SCALE;
    const startWidth = (pdfLayout[key] as PdfField | undefined)?.width ?? 320;
    resizeStartRef.current = { startLogX, startWidth };
    resizingKeyRef.current = key;
    setActiveKey(key);
    setIsResizing(true);
  }, [pdfLayout]);

  // ── Generate and open PDF preview ──
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
      // Named target reuses the same tab on subsequent opens
      window.open(url, 'cert-preview');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(`Preview failed: ${String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  }

  // ── Save layout, then auto-refresh preview ──
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
        setSaveMsg('Saved! Refreshing preview…');
        // Auto-refresh the preview tab with the saved layout
        void handlePreview().then(() => setSaveMsg('Saved!'));
        setTimeout(() => setSaveMsg(''), 4000);
      } else {
        setSaveMsg(d.error ?? 'Error saving');
      }
    } catch (e) {
      setSaveMsg(String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Update a single field value ──
  function handleFieldChange(key: PdfFieldKey, field: string, value: string | number) {
    setPdfLayout(prev => {
      const existing = prev[key] ?? (
        key === 'qrCode'
          ? { x: 0, y: 0, width: 120, height: 120 }
          : { x: 0, y: 0, fontSize: 14, color: '#000000', textAlign: 'left' as const, fontFamily: 'Helvetica', width: 320 }
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
              Drag to move · Drag right edge ↔ to resize · Save Layout auto-updates preview tab
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {saveMsg && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color:      saveMsg.startsWith('Saved') ? '#2EAA4A' : '#DC2626',
                padding:   '6px 12px',
                background: saveMsg.startsWith('Saved') ? '#F0FFF4' : '#FEF2F2',
                borderRadius: 6,
                border: `1px solid ${saveMsg.startsWith('Saved') ? '#BBF7D0' : '#FECACA'}`,
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
                cursor:          isResizing ? 'ew-resize' : (activeKey ? 'grabbing' : 'default'),
              }}
            >
              {/* PDF background */}
              {templateBg ? (
                <object
                  data={`${templateBg}#toolbar=0&navpanes=0`}
                  type="application/pdf"
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: `${CANVAS_W}px`, height: `${CANVAS_H}px`,
                    transform: `scale(${SCALE})`, transformOrigin: 'top left',
                    border: 'none', pointerEvents: 'none',
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
                position: 'absolute', top: 0, left: 0,
                width: CANVAS_W, height: CANVAS_H,
                transform: `scale(${SCALE})`, transformOrigin: 'top left',
                zIndex: 1, pointerEvents: 'none',
              }}>
                {(Object.keys(pdfLayout) as PdfFieldKey[]).map(key => {
                  const field      = pdfLayout[key];
                  if (!field) return null;
                  const isQr       = key === 'qrCode';
                  const qr         = field as PdfQrField;
                  const tf         = field as PdfField;
                  const isActive   = activeKey === key;
                  const fieldWidth = isQr ? qr.width  : (tf.width ?? 320);
                  const fieldHeight= isQr ? qr.height : Math.max(tf.fontSize + 10, 28);
                  const align      = tf.textAlign ?? 'left';
                  const cssFont    = CSS_FONT[tf.fontFamily ?? 'Helvetica'] ?? CSS_FONT['Helvetica'];
                  const markerLeft = isQr ? qr.x : (tf.x + alignOffset(align, fieldWidth));
                  const markerTop  = isQr ? qr.y : tf.y;
                  const borderColor = isActive ? '#3B82F6' : '#10B981';

                  return (
                    <div
                      key={key}
                      onMouseDown={e => handleMarkerMouseDown(e, key)}
                      style={{
                        position:      'absolute',
                        left:          markerLeft,
                        top:           markerTop,
                        width:         fieldWidth,
                        height:        fieldHeight,
                        border:        `2px ${isActive ? 'solid' : 'dashed'} ${borderColor}`,
                        background:    isActive ? 'rgba(59,130,246,0.07)' : 'rgba(255,255,255,0.55)',
                        pointerEvents: 'auto',
                        cursor:        isActive && !isResizing ? 'grabbing' : 'grab',
                        boxSizing:     'border-box',
                        overflow:      'visible',
                        display:       'flex',
                        alignItems:    'center',
                      }}
                    >
                      {isQr ? (
                        /* QR placeholder */
                        <div style={{
                          width: '100%', height: '100%',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          background: 'repeating-linear-gradient(45deg,#e5e7eb 0,#e5e7eb 4px,#f3f4f6 4px,#f3f4f6 12px)',
                          fontSize: 10, color: '#6B7280', fontWeight: 700, gap: 4,
                        }}>
                          <span style={{ fontSize: 22 }}>▦</span>
                          <span>QR CODE</span>
                          <span style={{ fontSize: 9, fontWeight: 400 }}>{qr.width}×{qr.height}</span>
                        </div>
                      ) : (
                        /* Sample text */
                        <div style={{
                          padding:      '0 4px',
                          width:        '100%',
                          fontSize:     tf.fontSize,
                          fontWeight:   tf.fontWeight === 'bold' ? 700 : 400,
                          color:        tf.color,
                          fontFamily:   cssFont,
                          textAlign:    align as React.CSSProperties['textAlign'],
                          lineHeight:   1,
                          whiteSpace:   'nowrap',
                          overflow:     'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {SAMPLE_TEXT[key]}
                        </div>
                      )}

                      {/* Label chip */}
                      <div style={{
                        position:   'absolute',
                        top: -16, left: 0,
                        fontSize:   8,
                        fontWeight: 800,
                        color:      borderColor,
                        background: 'rgba(255,255,255,0.95)',
                        padding:    '1px 4px',
                        borderRadius: 3,
                        letterSpacing: '0.04em',
                        whiteSpace:  'nowrap',
                        pointerEvents: 'none',
                        border:      `1px solid ${borderColor}`,
                      }}>
                        {PDF_FIELD_LABELS[key]}
                        {isActive && !isQr && (
                          <span style={{ marginLeft: 4, color: '#6B7280', fontWeight: 400 }}>
                            {isResizing
                              ? `w:${tf.width ?? 320}`
                              : `(${tf.x}, ${tf.y})`}
                          </span>
                        )}
                      </div>

                      {/* Resize handle — right edge (text fields only) */}
                      {!isQr && (
                        <div
                          onMouseDown={e => handleResizerMouseDown(e, key)}
                          title="Drag to resize field width"
                          style={{
                            position:   'absolute',
                            right:      -RESIZE_HANDLE_W / 2,
                            top:        0,
                            bottom:     0,
                            width:      RESIZE_HANDLE_W,
                            cursor:     'ew-resize',
                            background: isActive ? 'rgba(59,130,246,0.25)' : 'rgba(16,185,129,0.18)',
                            borderRadius: 3,
                            display:    'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'auto',
                            zIndex:     2,
                          }}
                        >
                          <span style={{
                            fontSize: 8,
                            color:    isActive ? '#3B82F6' : '#10B981',
                            fontWeight: 900,
                            lineHeight: 1,
                            letterSpacing: '-1px',
                            userSelect: 'none',
                          }}>
                            ⋮⋮
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div style={{ width: 260, flexShrink: 0 }}>
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
                Drag to move · Right-edge grip ↔ to resize · Coords in 1240×877 space.
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
                    <div style={{ fontSize: 10, fontWeight: 800, color: isActive ? '#3B82F6' : '#374151', marginBottom: 6 }}>
                      {PDF_FIELD_LABELS[key]}
                    </div>

                    {isQr ? (
                      /* QR: 2×2 grid */
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {(['x', 'y', 'width', 'height'] as const).map(f => (
                          <div key={f}>
                            <div style={labelStyle}>{f.toUpperCase()}</div>
                            <input type="number" value={qr[f]}
                              onChange={e => handleFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                              style={inputStyle} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

                        {/* X / Y / SIZE / WIDTH — 2×2 grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                          {([
                            { f: 'x',         label: 'X' },
                            { f: 'y',         label: 'Y' },
                            { f: 'fontSize',  label: 'SIZE' },
                            { f: 'width',     label: 'WIDTH' },
                          ] as const).map(({ f, label }) => (
                            <div key={f}>
                              <div style={labelStyle}>{label}</div>
                              <input type="number"
                                value={f === 'width' ? (tf.width ?? 320) : tf[f as 'x' | 'y' | 'fontSize']}
                                onChange={e => handleFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                                style={{ ...inputStyle, background: isActive ? '#EFF6FF' : '#F0FFF4' }}
                              />
                            </div>
                          ))}
                        </div>

                        {/* Align + Bold */}
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <div style={{ fontSize: 9, color: '#9CA3AF', marginRight: 2 }}>ALIGN</div>
                          {(['left', 'center', 'right'] as const).map(a => (
                            <button key={a} onClick={() => handleFieldChange(key, 'textAlign', a)}
                              title={`Align ${a}`}
                              style={{
                                padding: '3px 7px', borderRadius: 4, fontSize: 11,
                                fontWeight: 700, border: '1px solid', cursor: 'pointer',
                                background:  (tf.textAlign ?? 'left') === a ? '#1B4F8A' : '#F3F4F6',
                                borderColor: (tf.textAlign ?? 'left') === a ? '#1B4F8A' : '#D1D5DB',
                                color:       (tf.textAlign ?? 'left') === a ? '#fff' : '#6B7280',
                              }}>
                              {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
                            </button>
                          ))}
                          <div style={{ marginLeft: 6, fontSize: 9, color: '#9CA3AF' }}>BOLD</div>
                          <button onClick={() => handleFieldChange(key, 'fontWeight', tf.fontWeight === 'bold' ? 'normal' : 'bold')}
                            style={{
                              padding: '3px 8px', borderRadius: 4, fontSize: 11,
                              fontWeight: 800, border: '1px solid', cursor: 'pointer',
                              background:  tf.fontWeight === 'bold' ? '#1B4F8A' : '#F3F4F6',
                              borderColor: tf.fontWeight === 'bold' ? '#1B4F8A' : '#D1D5DB',
                              color:       tf.fontWeight === 'bold' ? '#fff' : '#6B7280',
                            }}>B</button>
                        </div>

                        {/* Font */}
                        <div>
                          <div style={labelStyle}>FONT</div>
                          <select value={tf.fontFamily ?? 'Helvetica'}
                            onChange={e => handleFieldChange(key, 'fontFamily', e.target.value)}
                            style={{
                              width: '100%', boxSizing: 'border-box', padding: '4px 6px',
                              borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11,
                              background: '#F0FFF4', outline: 'none',
                              fontFamily: CSS_FONT[tf.fontFamily ?? 'Helvetica'], cursor: 'pointer',
                            }}>
                            {FONT_OPTIONS.map(o => (
                              <option key={o.value} value={o.value} style={{ fontFamily: CSS_FONT[o.value] }}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Color */}
                        <div>
                          <div style={labelStyle}>COLOR</div>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input type="color" value={tf.color}
                              onChange={e => handleFieldChange(key, 'color', e.target.value)}
                              style={{ width: 32, height: 24, padding: 0, border: '1px solid #D1D5DB', borderRadius: 3, cursor: 'pointer' }} />
                            <input type="text" value={tf.color}
                              onChange={e => handleFieldChange(key, 'color', e.target.value)}
                              style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: '#F0FFF4', outline: 'none', fontFamily: 'monospace' }} />
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

// ── Shared micro-styles ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '4px 6px', borderRadius: 4,
  border: '1px solid #D1D5DB', fontSize: 11,
  background: '#F0FFF4', outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontSize: 9, color: '#9CA3AF', marginBottom: 2,
};
