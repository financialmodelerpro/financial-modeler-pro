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

// Landscape A4 canvas — coordinates are in this unscaled pixel space.
// These same values are used by pdf-lib when generating certificates.
const CANVAS_W = 1240;
const CANVAS_H = 877;
const SCALE    = 0.65;

const DEFAULT_PDF_LAYOUT: PdfLayout = {
  studentName:       { x: 180, y: 310, fontSize: 36, color: '#0D2E5A', fontWeight: 'bold' },
  courseName:        { x: 180, y: 380, fontSize: 26, color: '#C9A84C' },
  courseSubheading:  { x: 180, y: 425, fontSize: 16, color: '#374151' },
  courseDescription: { x: 180, y: 460, fontSize: 13, color: '#6B7280' },
  issueDate:         { x: 180, y: 530, fontSize: 14, color: '#374151' },
  certificateId:     { x: 180, y: 560, fontSize: 12, color: '#9CA3AF' },
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CertificateEditorPage() {
  const [pdfLayout,   setPdfLayout]   = useState<PdfLayout>(DEFAULT_PDF_LAYOUT);
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState('');
  const [loading,     setLoading]     = useState(true);
  const [templateBg,  setTemplateBg]  = useState<string | null>(null);
  const [course,      setCourse]      = useState<'3sfm' | 'bvm'>('3sfm');

  // Active drag key — only for visual feedback (border colour, cursor)
  const [activeKey, setActiveKey] = useState<PdfFieldKey | null>(null);

  // Refs used inside window event listeners — avoids stale closures
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

  // ── Global mouse-move / mouse-up handlers for drag ──
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const key = draggingKeyRef.current;
      if (!key || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      // Convert screen coords → unscaled canvas coords
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
  }, []); // empty — reads state only through refs

  // ── Start dragging a marker ──
  const handleMarkerMouseDown = useCallback(
    (e: React.MouseEvent, key: PdfFieldKey) => {
      e.preventDefault();
      if (!canvasRef.current) return;
      const rect   = canvasRef.current.getBoundingClientRect();
      const logX   = (e.clientX - rect.left) / SCALE;
      const logY   = (e.clientY - rect.top)  / SCALE;
      const field  = DEFAULT_PDF_LAYOUT[key]; // use current state via closure below
      const curX   = (pdfLayout[key] as { x: number; y: number } | undefined)?.x ?? (field?.x ?? 0);
      const curY   = (pdfLayout[key] as { x: number; y: number } | undefined)?.y ?? (field?.y ?? 0);
      dragOffsetRef.current  = { x: logX - curX, y: logY - curY };
      draggingKeyRef.current = key;
      setActiveKey(key);
    },
    [pdfLayout],
  );

  // ── Save ──
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
        console.log('[CertEditor] Layout saved:', { course, pdfLayout });
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

  // ── Update a single PDF field value (from right-panel inputs) ──
  function handlePdfFieldChange(key: PdfFieldKey, field: string, value: string | number) {
    setPdfLayout(prev => {
      const existing = prev[key] ?? (
        key === 'qrCode'
          ? { x: 0, y: 0, width: 120, height: 120 }
          : { x: 0, y: 0, fontSize: 14, color: '#000000' }
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
              Drag fields to reposition. X/Y update live in the panel. Click Save Layout when done.
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
              onClick={() => window.open('/training/certificate?regId=preview&course=3sfm', '_blank')}
              style={{ padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#fff', border: '1px solid #D1D5DB', color: '#374151' }}
            >
              Preview ↗
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

            {/* Canvas — landscape 1240×877, scaled to 0.65 */}
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
              {/* PDF background — <object> scaled via CSS transform */}
              {templateBg ? (
                <object
                  data={`${templateBg}#toolbar=0&navpanes=0`}
                  type="application/pdf"
                  style={{
                    position:        'absolute',
                    top:             0,
                    left:            0,
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
                  position:       'absolute',
                  inset:          0,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  color:          '#999',
                  fontSize:       14,
                  textAlign:      'center',
                  padding:        20,
                }}>
                  📄 Upload a PDF template at /admin/certificates to see it here
                </div>
              )}

              {/* Field markers — 1240×877 unscaled space, scaled via transform.
                  Parent pointer-events:none so the PDF background is unobstructed;
                  each marker overrides with pointer-events:auto for drag. */}
              <div style={{
                position:        'absolute',
                top:             0,
                left:            0,
                width:           CANVAS_W,
                height:          CANVAS_H,
                transform:       `scale(${SCALE})`,
                transformOrigin: 'top left',
                zIndex:          1,
                pointerEvents:   'none',
              }}>
                {(Object.keys(pdfLayout) as PdfFieldKey[]).map(key => {
                  const field    = pdfLayout[key];
                  if (!field) return null;
                  const isQr     = key === 'qrCode';
                  const qr       = field as PdfQrField;
                  const tf       = field as PdfField;
                  const isDragging = activeKey === key;

                  return (
                    <div
                      key={key}
                      onMouseDown={e => handleMarkerMouseDown(e, key)}
                      style={{
                        position:     'absolute',
                        left:         isQr ? qr.x : tf.x,
                        top:          isQr ? qr.y : tf.y,
                        width:        isQr ? qr.width  : 280,
                        height:       isQr ? qr.height : (tf.fontSize + 6),
                        border:       `2px ${isDragging ? 'solid' : 'dashed'} ${isDragging ? '#3B82F6' : '#10B981'}`,
                        background:   isDragging ? 'rgba(59,130,246,0.10)' : 'rgba(16,185,129,0.06)',
                        pointerEvents: 'auto',
                        cursor:       isDragging ? 'grabbing' : 'grab',
                        boxSizing:    'border-box',
                        overflow:     'hidden',
                      }}
                    >
                      {/* Label chip */}
                      <div style={{
                        position:      'absolute',
                        top: 1, left: 2,
                        fontSize:      8,
                        fontWeight:    800,
                        color:         isDragging ? '#3B82F6' : '#10B981',
                        letterSpacing: '0.06em',
                        background:    'rgba(255,255,255,0.9)',
                        padding:       '0 3px',
                        borderRadius:  2,
                        lineHeight:    1.6,
                        whiteSpace:    'nowrap',
                        userSelect:    'none',
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

          {/* ── Right panel — PDF Field Positions ── */}
          <div style={{ width: 240, flexShrink: 0 }}>
            <div style={{
              background:   '#fff',
              borderRadius: 10,
              border:       '1px solid #10B981',
              padding:      16,
              boxShadow:    '0 2px 12px rgba(0,0,0,0.05)',
              maxHeight:    'calc(100vh - 160px)',
              overflowY:    'auto',
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
                PDF Field Positions
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10, lineHeight: 1.5 }}>
                Drag markers on the canvas or type values here. Coordinates are in the 1240×877 unscaled space.
              </div>

              {(Object.keys(pdfLayout) as PdfFieldKey[]).map(key => {
                const field      = pdfLayout[key];
                if (!field) return null;
                const isQr       = key === 'qrCode';
                const qr         = field as PdfQrField;
                const tf         = field as PdfField;
                const isActive   = activeKey === key;

                return (
                  <div key={key} style={{
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: '1px solid #F3F4F6',
                    borderRadius: 6,
                    outline: isActive ? '2px solid #3B82F6' : 'none',
                    outlineOffset: 2,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: isActive ? '#3B82F6' : '#374151', marginBottom: 6 }}>
                      {PDF_FIELD_LABELS[key]}
                    </div>
                    {isQr ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {(['x', 'y', 'width', 'height'] as const).map(f => (
                          <div key={f}>
                            <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>{f.toUpperCase()}</div>
                            <input
                              type="number"
                              value={qr[f]}
                              onChange={e => handlePdfFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                              style={{ width: '100%', boxSizing: 'border-box', padding: '4px 6px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: '#F0FFF4', outline: 'none' }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                          {(['x', 'y', 'fontSize'] as const).map(f => (
                            <div key={f}>
                              <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>{f === 'fontSize' ? 'SIZE' : f.toUpperCase()}</div>
                              <input
                                type="number"
                                value={tf[f]}
                                onChange={e => handlePdfFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                                style={{ width: '100%', boxSizing: 'border-box', padding: '4px 6px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: isActive ? '#EFF6FF' : '#F0FFF4', outline: 'none' }}
                              />
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>COLOR</div>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input
                              type="color"
                              value={tf.color}
                              onChange={e => handlePdfFieldChange(key, 'color', e.target.value)}
                              style={{ width: 32, height: 24, padding: 0, border: '1px solid #D1D5DB', borderRadius: 3, cursor: 'pointer' }}
                            />
                            <input
                              type="text"
                              value={tf.color}
                              onChange={e => handlePdfFieldChange(key, 'color', e.target.value)}
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
