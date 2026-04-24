'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PDFDocument } from 'pdf-lib';
import { createClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PdfField {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  fontFamily?: string;
  width?: number;
}

interface PdfQrField {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfLayout {
  studentName?:   PdfField;
  issueDate?:     PdfField;
  certificateId?: PdfField;
  qrCode?:        PdfQrField;
}

type PdfFieldKey = keyof PdfLayout;

interface CanvasSize {
  width:     number;
  height:    number;
  pdfWidth:  number;
  pdfHeight: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DISPLAY_W       = 900;
const MIN_W           = 30;
const RESIZE_HANDLE_W = 12;

const A4_W = 841.89;
const A4_H = 595.28;

const DEFAULT_CANVAS: CanvasSize = {
  width:     DISPLAY_W,
  height:    Math.round(DISPLAY_W * (A4_H / A4_W)),
  pdfWidth:  A4_W,
  pdfHeight: A4_H,
};

const DEFAULT_PDF_LAYOUT: PdfLayout = {
  studentName:   { x: 120, y: 280, fontSize: 28, color: '#ffffff', fontWeight: 'bold',   textAlign: 'left', fontFamily: 'Helvetica', width: 500 },
  issueDate:     { x: 750, y: 460, fontSize: 13, color: '#ffffff', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica', width: 200 },
  certificateId: { x: 750, y: 490, fontSize: 11, color: '#a0b0c0', fontWeight: 'normal', textAlign: 'left', fontFamily: 'Helvetica', width: 220 },
  qrCode:        { x: 1050, y: 440, width: 120, height: 120 },
};

const PDF_FIELD_LABELS: Record<PdfFieldKey, string> = {
  studentName:   'Student Name',
  issueDate:     'Issue Date',
  certificateId: 'Certificate ID',
  qrCode:        'QR Code',
};

const SAMPLE_TEXT: Record<PdfFieldKey, string> = {
  studentName:   'Ahmad Din',
  issueDate:     '15 January 2026',
  certificateId: 'FMP-3SFM-2026-0001',
  qrCode:        '',
};

const SAMPLE_QR_URL =
  'https://api.qrserver.com/v1/create-qr-code/' +
  '?size=300x300&data=' +
  encodeURIComponent('https://learn.financialmodelerpro.com/verify/FMP-3SFM-2026-0001');

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

const ALL_FIELD_KEYS: PdfFieldKey[] = ['studentName', 'issueDate', 'certificateId', 'qrCode'];

function alignOffset(textAlign: string | undefined, width: number): number {
  if (textAlign === 'center') return -width / 2;
  if (textAlign === 'right')  return -width;
  return 0;
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export function CertificateLayoutTab() {
  const [pdfLayout,      setPdfLayout]      = useState<PdfLayout>(DEFAULT_PDF_LAYOUT);
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState('');
  const [loading,        setLoading]        = useState(true);
  const [templateBg,     setTemplateBg]     = useState<string | null>(null);
  const [canvasSize,     setCanvasSize]     = useState<CanvasSize>(DEFAULT_CANVAS);
  const [course,         setCourse]         = useState<'3sfm' | 'bvm'>('3sfm');
  const [previewLoading, setPreviewLoading] = useState(false);

  const [activeKey,  setActiveKey]  = useState<PdfFieldKey | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [showGuides, setShowGuides] = useState(true);

  const canvasRef       = useRef<HTMLDivElement>(null);
  const draggingKeyRef  = useRef<PdfFieldKey | null>(null);
  const dragOffsetRef   = useRef({ x: 0, y: 0 });
  const resizingKeyRef  = useRef<PdfFieldKey | null>(null);
  const resizeStartRef  = useRef({ startLogX: 0, startWidth: 0 });
  const canvasSizeRef   = useRef<CanvasSize>(DEFAULT_CANVAS);

  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);

  useEffect(() => {
    fetch('/api/admin/certificate-layout')
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        if (d.pdfLayout) {
          const raw = d.pdfLayout as Record<string, unknown>;
          const clean: PdfLayout = {};
          for (const k of ALL_FIELD_KEYS) {
            if (raw[k]) (clean as Record<string, unknown>)[k] = raw[k];
          }
          setPdfLayout(clean);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { publicUrl } } = sb.storage
      .from('certificates')
      .getPublicUrl(`templates/${course.toLowerCase()}-template.pdf`);
    const bust = `${publicUrl}?t=${Date.now()}`;

    async function loadTemplate() {
      try {
        const headRes = await fetch(bust, { method: 'HEAD' });
        if (!headRes.ok) {
          setTemplateBg(null);
          setCanvasSize(DEFAULT_CANVAS);
          return;
        }
        setTemplateBg(bust);

        const pdfRes   = await fetch(bust);
        const pdfBytes = await pdfRes.arrayBuffer();
        const pdfDoc   = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const page     = pdfDoc.getPages()[0];
        const { width, height } = page.getSize();

        const ratio = height / width;
        setCanvasSize({
          width:     DISPLAY_W,
          height:    Math.round(DISPLAY_W * ratio),
          pdfWidth:  width,
          pdfHeight: height,
        });
      } catch {
        setTemplateBg(null);
        setCanvasSize(DEFAULT_CANVAS);
      }
    }
    void loadTemplate();
  }, [course]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!canvasRef.current) return;
      const cs    = canvasSizeRef.current;
      const scale = DISPLAY_W / cs.pdfWidth;
      const rect  = canvasRef.current.getBoundingClientRect();
      const logX  = (e.clientX - rect.left) / scale;
      const logY  = (e.clientY - rect.top)  / scale;

      const rKey = resizingKeyRef.current;
      if (rKey) {
        const delta    = logX - resizeStartRef.current.startLogX;
        const newWidth = Math.round(Math.max(MIN_W, Math.min(cs.pdfWidth, resizeStartRef.current.startWidth + delta)));
        setPdfLayout(prev => {
          const f = prev[rKey];
          if (!f) return prev;
          return { ...prev, [rKey]: { ...f, width: newWidth } };
        });
        return;
      }

      const mKey = draggingKeyRef.current;
      if (mKey) {
        const newX = Math.round(Math.max(0, Math.min(cs.pdfWidth  - 10, logX - dragOffsetRef.current.x)));
        const newY = Math.round(Math.max(0, Math.min(cs.pdfHeight - 10, logY - dragOffsetRef.current.y)));
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

  const handleMarkerMouseDown = useCallback((e: React.MouseEvent, key: PdfFieldKey) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const cs    = canvasSizeRef.current;
    const scale = DISPLAY_W / cs.pdfWidth;
    const rect  = canvasRef.current.getBoundingClientRect();
    const logX  = (e.clientX - rect.left) / scale;
    const logY  = (e.clientY - rect.top)  / scale;
    const curX  = (pdfLayout[key] as { x: number } | undefined)?.x ?? 0;
    const curY  = (pdfLayout[key] as { y: number } | undefined)?.y ?? 0;
    dragOffsetRef.current  = { x: logX - curX, y: logY - curY };
    draggingKeyRef.current = key;
    setActiveKey(key);
    setIsResizing(false);
  }, [pdfLayout]);

  const handleResizerMouseDown = useCallback((e: React.MouseEvent, key: PdfFieldKey) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canvasRef.current) return;
    const startLogX  = (e.clientX - canvasRef.current.getBoundingClientRect().left) / (DISPLAY_W / canvasSizeRef.current.pdfWidth);
    const startWidth = (pdfLayout[key] as PdfField | undefined)?.width ?? 200;
    resizeStartRef.current = { startLogX, startWidth };
    resizingKeyRef.current = key;
    setActiveKey(key);
    setIsResizing(true);
  }, [pdfLayout]);

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
      window.open(url, 'cert-preview');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(`Preview failed: ${String(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  }

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

  function handleFieldChange(key: PdfFieldKey, field: string, value: string | number) {
    setPdfLayout(prev => {
      const existing = prev[key] ?? (
        key === 'qrCode'
          ? { x: 0, y: 0, width: 100, height: 100 }
          : { x: 0, y: 0, fontSize: 14, color: '#000000', textAlign: 'left' as const, fontFamily: 'Helvetica', width: 200 }
      );
      return { ...prev, [key]: { ...existing, [field]: value } };
    });
  }

  function handleRemoveField(key: PdfFieldKey) {
    setPdfLayout(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (activeKey === key) setActiveKey(null);
  }

  function handleAddField(key: PdfFieldKey) {
    setPdfLayout(prev => ({ ...prev, [key]: DEFAULT_PDF_LAYOUT[key] }));
  }

  function handleResetDefaults() {
    if (!confirm('Reset all fields to default positions?')) return;
    setPdfLayout(DEFAULT_PDF_LAYOUT);
    setActiveKey(null);
  }

  function snapFieldH(key: PdfFieldKey, target: 'left' | 'center' | 'right') {
    const tf    = pdfLayout[key] as PdfField;
    if (!tf) return;
    const cw    = canvasSize.pdfWidth;
    const width = tf.width ?? 200;
    const ao    = alignOffset(tf.textAlign, width);
    let newX: number;
    if (target === 'left')        newX = -ao;
    if (target === 'center')      newX = cw / 2 - ao - width / 2;
    else if (target === 'right')  newX = cw - ao - width;
    handleFieldChange(key, 'x', Math.round(newX!));
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
        Loading layout…
      </div>
    );
  }

  const scale = DISPLAY_W / canvasSize.pdfWidth;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

      {/* ── Local toolbar ── */}
      <div style={{
        padding: '16px 24px', background: '#fff',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>
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
          <button onClick={handleResetDefaults} title="Reset all fields to default positions"
            style={{ padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#fff', border: '1px solid #D1D5DB', color: '#6B7280' }}>
            ↺ Reset
          </button>
          <button onClick={() => setShowGuides(v => !v)}
            style={{ padding: '8px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: showGuides ? '#EEF2FF' : '#fff', border: `1px solid ${showGuides ? '#6366F1' : '#D1D5DB'}`, color: showGuides ? '#4F46E5' : '#6B7280' }}>
            {showGuides ? '📐 Guides On' : '📐 Guides Off'}
          </button>
          <button onClick={handlePreview} disabled={previewLoading}
            style={{ padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: previewLoading ? 'not-allowed' : 'pointer', background: previewLoading ? '#E5E7EB' : '#fff', border: '1px solid #D1D5DB', color: '#374151' }}>
            {previewLoading ? 'Generating…' : 'Preview PDF ↗'}
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', background: saving ? '#9CA3AF' : '#2EAA4A', border: 'none', color: '#fff' }}>
            {saving ? 'Saving…' : 'Save Layout'}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, gap: 24, padding: 24, overflow: 'auto', minHeight: 0 }}>

        {/* Canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>Course:</span>
            {(['3sfm', 'bvm'] as const).map(c => (
              <button key={c} onClick={() => setCourse(c)}
                style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: course === c ? '#1B4F8A' : '#E5E7EB', color: course === c ? '#fff' : '#374151' }}>
                {c.toUpperCase()}
              </button>
            ))}
            <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>
              Upload templates in the <strong>Templates</strong> tab
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9CA3AF', fontFamily: 'monospace', flexShrink: 0 }}>
              PDF: {Math.round(canvasSize.pdfWidth)} × {Math.round(canvasSize.pdfHeight)} pt
            </span>
          </div>

          <div
            ref={canvasRef}
            style={{
              position: 'relative',
              width:    canvasSize.width,
              height:   canvasSize.height,
              overflow: 'hidden',
              border:   '1px solid #ddd',
              backgroundColor: '#fff',
              boxShadow:    '0 8px 40px rgba(0,0,0,0.15)',
              borderRadius: 4,
              flexShrink:   0,
              userSelect:   'none',
              cursor:       isResizing ? 'ew-resize' : (activeKey ? 'grabbing' : 'default'),
            }}
          >
            {templateBg ? (
              <object
                data={`${templateBg}#toolbar=0&navpanes=0&scrollbar=0`}
                type="application/pdf"
                style={{
                  position: 'absolute',
                  top:      0,
                  left:     0,
                  width:    `${canvasSize.pdfWidth}px`,
                  height:   `${canvasSize.pdfHeight}px`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  border:        'none',
                  pointerEvents: 'none',
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
                📄 Upload a PDF template in the Templates tab to see background
              </div>
            )}

            {showGuides && (
              <div style={{
                position: 'absolute', top: 0, left: 0,
                width: canvasSize.pdfWidth, height: canvasSize.pdfHeight,
                transform: `scale(${scale})`, transformOrigin: 'top left',
                zIndex: 1, pointerEvents: 'none',
              }}>
                <div style={{
                  position: 'absolute',
                  left: canvasSize.pdfWidth / 2, top: 0,
                  width: 1, height: canvasSize.pdfHeight,
                  borderLeft: '1.5px dashed rgba(99,102,241,0.55)',
                }} />
                <div style={{
                  position: 'absolute',
                  left: 0, top: canvasSize.pdfHeight / 2,
                  width: canvasSize.pdfWidth, height: 1,
                  borderTop: '1.5px dashed rgba(99,102,241,0.55)',
                }} />
                <div style={{
                  position: 'absolute',
                  left: canvasSize.pdfWidth / 2 + 4, top: canvasSize.pdfHeight / 2 + 4,
                  fontSize: 9, color: 'rgba(99,102,241,0.7)',
                  fontWeight: 700, fontFamily: 'Arial, sans-serif',
                  background: 'rgba(255,255,255,0.8)', padding: '1px 4px', borderRadius: 2,
                }}>
                  center
                </div>
              </div>
            )}

            <div style={{
              position: 'absolute', top: 0, left: 0,
              width: canvasSize.pdfWidth, height: canvasSize.pdfHeight,
              transform: `scale(${scale})`, transformOrigin: 'top left',
              zIndex: 2, pointerEvents: 'none',
            }}>
              {ALL_FIELD_KEYS.filter(k => pdfLayout[k]).map(key => {
                const field       = pdfLayout[key];
                if (!field) return null;
                const isQr        = key === 'qrCode';
                const qr          = field as PdfQrField;
                const tf          = field as PdfField;
                const isActive    = activeKey === key;
                const fieldWidth  = isQr ? qr.width  : (tf.width ?? 200);
                const fieldHeight = isQr ? qr.height : Math.max(tf.fontSize + 10, 28);
                const align       = tf.textAlign ?? 'left';
                const cssFont     = CSS_FONT[tf.fontFamily ?? 'Helvetica'] ?? CSS_FONT['Helvetica'];
                const markerLeft  = isQr ? qr.x : (tf.x + alignOffset(align, fieldWidth));
                const markerTop   = isQr ? qr.y : tf.y;
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
                      alignItems:    'flex-start',
                    }}
                  >
                    {isQr ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={SAMPLE_QR_URL} alt="QR Code preview"
                        style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }} />
                    ) : (
                      <div style={{
                        padding:      '0',
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
                          {isResizing ? `w:${tf.width ?? 200}` : `(${tf.x}, ${tf.y})`}
                        </span>
                      )}
                    </div>

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
                          fontSize: 8, color: isActive ? '#3B82F6' : '#10B981',
                          fontWeight: 900, lineHeight: 1, letterSpacing: '-1px', userSelect: 'none',
                        }}>⋮⋮</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ width: 260, flexShrink: 0 }}>
          <div style={{
            background:   '#fff',
            borderRadius: 10,
            border:       '1px solid #10B981',
            padding:      16,
            boxShadow:    '0 2px 12px rgba(0,0,0,0.05)',
            maxHeight:    'calc(100vh - 220px)',
            overflowY:    'auto',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              PDF Field Positions
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 12, lineHeight: 1.5 }}>
              Drag to move · Right-edge grip ↔ to resize · Coords in PDF points ({Math.round(canvasSize.pdfWidth)}×{Math.round(canvasSize.pdfHeight)}).
            </div>

            {(ALL_FIELD_KEYS.filter(k => pdfLayout[k])).map(key => {
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: isActive ? '#3B82F6' : '#374151' }}>
                      {PDF_FIELD_LABELS[key]}
                    </div>
                    <button onClick={() => handleRemoveField(key)} title={`Remove ${PDF_FIELD_LABELS[key]} from layout`}
                      style={{ width: 18, height: 18, padding: 0, border: '1px solid #FECACA', borderRadius: 3, background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, fontWeight: 800, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      ✕
                    </button>
                  </div>

                  {isQr ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {([
                        { f: 'x',      label: 'X',      step: 1, min: 0 },
                        { f: 'y',      label: 'Y',      step: 1, min: 0 },
                        { f: 'width',  label: 'WIDTH',  step: 5, min: 20 },
                        { f: 'height', label: 'HEIGHT', step: 5, min: 20 },
                      ] as const).map(({ f, label, step, min }) => (
                        <div key={f}>
                          <div style={labelStyle}>{label}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <button onClick={() => handleFieldChange(key, f, Math.max(min, qr[f] - step))} style={stepBtnStyle}>−</button>
                            <input type="number" value={qr[f]}
                              onChange={e => handleFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                              style={{ ...inputStyle, textAlign: 'center', minWidth: 0 }} />
                            <button onClick={() => handleFieldChange(key, f, qr[f] + step)} style={stepBtnStyle}>+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {([
                          { f: 'x',        label: 'X',     step: 1, min: 0 },
                          { f: 'y',        label: 'Y',     step: 1, min: 0 },
                          { f: 'fontSize', label: 'SIZE',  step: 1, min: 6 },
                          { f: 'width',    label: 'WIDTH', step: 5, min: 30 },
                        ] as const).map(({ f, label, step, min }) => {
                          const val = f === 'width' ? (tf.width ?? 200) : tf[f as 'x' | 'y' | 'fontSize'];
                          return (
                            <div key={f}>
                              <div style={labelStyle}>{label}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <button onClick={() => handleFieldChange(key, f, Math.max(min, val - step))} style={stepBtnStyle}>−</button>
                                <input type="number" value={val}
                                  onChange={e => handleFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                                  style={{ ...inputStyle, textAlign: 'center', minWidth: 0, background: isActive ? '#EFF6FF' : '#F0FFF4' }} />
                                <button onClick={() => handleFieldChange(key, f, val + step)} style={stepBtnStyle}>+</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <div style={{ fontSize: 9, color: '#9CA3AF', marginRight: 2 }}>SNAP</div>
                        {(['left', 'center', 'right'] as const).map(t => (
                          <button key={t} onClick={() => snapFieldH(key, t)} title={`Snap to canvas ${t}`}
                            style={{
                              flex: 1, padding: '3px 0', borderRadius: 4, fontSize: 11,
                              fontWeight: 700, border: '1px solid #D1D5DB',
                              cursor: 'pointer', background: '#F3F4F6', color: '#374151',
                            }}>
                            {t === 'left' ? '|◀' : t === 'center' ? '↔' : '▶|'}
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <div style={{ fontSize: 9, color: '#9CA3AF', marginRight: 2 }}>ALIGN</div>
                        {(['left', 'center', 'right'] as const).map(a => (
                          <button key={a} onClick={() => handleFieldChange(key, 'textAlign', a)} title={`Align ${a}`}
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

            {ALL_FIELD_KEYS.filter(k => !pdfLayout[k]).map(key => (
              <div key={key} style={{
                marginBottom: 8, padding: '8px 10px',
                borderRadius: 6, border: '1px dashed #D1D5DB',
                background: '#FAFAFA',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF' }}>
                  {PDF_FIELD_LABELS[key]}
                </span>
                <button onClick={() => handleAddField(key)} title={`Add ${PDF_FIELD_LABELS[key]} back to layout`}
                  style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, border: '1px solid #BBF7D0', background: '#F0FFF4', color: '#2EAA4A', cursor: 'pointer', flexShrink: 0 }}>
                  + Add
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
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

const stepBtnStyle: React.CSSProperties = {
  width: 20, height: 22, padding: 0, flexShrink: 0,
  borderRadius: 3, border: '1px solid #D1D5DB',
  background: '#F3F4F6', cursor: 'pointer',
  fontSize: 14, fontWeight: 700, color: '#374151',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  lineHeight: 1,
};
