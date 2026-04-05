'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ElemPos {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CertLayout {
  logo: ElemPos;
  heading: ElemPos;
  studentBlock: ElemPos;
  signature: ElemPos;
}

type BlockKey = keyof CertLayout;

// PDF layout field (for pdf-lib certificate generation)
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

const CANVAS_W = 680;
const CANVAS_H = 960;
const SCALE    = 0.75;

const DEFAULT_LAYOUT: CertLayout = {
  logo:         { left: 195, top: 46,  width: 290, height: 80  },
  heading:      { left: 40,  top: 185, width: 600, height: 60  },
  studentBlock: { left: 40,  top: 280, width: 600, height: 380 },
  signature:    { left: 80,  top: 750, width: 520, height: 70  },
};

const DEFAULT_PDF_LAYOUT: PdfLayout = {
  studentName:       { x: 120, y: 280, fontSize: 28, color: '#0D2E5A', fontWeight: 'bold' },
  courseName:        { x: 120, y: 340, fontSize: 22, color: '#C9A84C' },
  courseSubheading:  { x: 120, y: 375, fontSize: 14, color: '#374151' },
  courseDescription: { x: 120, y: 400, fontSize: 12, color: '#6B7280' },
  issueDate:         { x: 120, y: 460, fontSize: 13, color: '#374151' },
  certificateId:     { x: 120, y: 490, fontSize: 11, color: '#9CA3AF' },
  qrCode:            { x: 650, y: 420, width: 120, height: 120 },
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

const BLOCK_LABELS: Record<BlockKey, string> = {
  logo:         'LOGO',
  heading:      'HEADING',
  studentBlock: 'STUDENT INFO',
  signature:    'SIGNATURE',
};

// ── Drag state ────────────────────────────────────────────────────────────────

interface DragState {
  key: BlockKey;
  isResize: boolean;
  startMX: number;
  startMY: number;
  origPos: ElemPos;
  /** For proportional resize (logo) */
  aspectRatio: number;
}

// ── Gold rule sub-component ───────────────────────────────────────────────────

function GoldRule() {
  return (
    <div style={{
      height: 2,
      margin: '0 auto',
      maxWidth: 320,
      background: 'linear-gradient(90deg, transparent, #C9A84C 20%, #E8C96E 50%, #C9A84C 80%, transparent)',
      borderRadius: 1,
    }} />
  );
}

// ── Certificate block content ─────────────────────────────────────────────────

function LogoContent() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      gap: 10, width: '100%', height: '100%',
      pointerEvents: 'none',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 9, background: '#2EAA4A',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, flexShrink: 0,
      }}>🎓</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A', lineHeight: 1.2 }}>
          Financial Modeler Pro
        </div>
        <div style={{ fontSize: 10, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Training Hub
        </div>
      </div>
    </div>
  );
}

function HeadingContent() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', width: '100%', height: '100%',
      gap: 10, pointerEvents: 'none',
    }}>
      <div style={{
        fontSize: 15, fontWeight: 800, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: '#0D2E5A',
      }}>
        Certificate of Completion
      </div>
      <GoldRule />
    </div>
  );
}

function StudentBlockContent() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start', paddingTop: 8,
      width: '100%', height: '100%',
      pointerEvents: 'none', textAlign: 'center',
    }}>
      <p style={{ fontSize: 13, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 12, marginTop: 0 }}>
        This is to certify that
      </p>
      <div style={{
        fontSize: 32, fontWeight: 800, color: '#0D2E5A', lineHeight: 1.15, marginBottom: 14,
        fontFamily: "'Georgia', 'Times New Roman', serif", letterSpacing: '-0.01em',
      }}>
        [Student Name]
      </div>
      <p style={{ fontSize: 13, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 10, marginTop: 0 }}>
        has successfully completed
      </p>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#0D2E5A', marginBottom: 14, lineHeight: 1.3 }}>
        [Course Name]
      </div>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>
        April 2026
      </div>
      <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', letterSpacing: '0.05em', marginBottom: 14 }}>
        Certificate ID: FMP-2026-XXXX
      </div>
      <GoldRule />
    </div>
  );
}

function SignatureContent() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      gap: 32, flexWrap: 'wrap', width: '100%', height: '100%',
      pointerEvents: 'none',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A' }}>Ahmad Din</div>
        <div style={{ fontSize: 11, color: '#9CA3AF' }}>CEO &amp; Founder</div>
      </div>
      <div style={{ width: 1, height: 32, background: '#E5E7EB', flexShrink: 0 }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A' }}>Financial Modeler Pro</div>
        <div style={{ fontSize: 11, color: '#9CA3AF' }}>financialmodelerpro.com</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CertificateEditorPage() {
  const [layout, setLayout]         = useState<CertLayout>(DEFAULT_LAYOUT);
  const [pdfLayout, setPdfLayout]   = useState<PdfLayout>(DEFAULT_PDF_LAYOUT);
  const [selected, setSelected]     = useState<BlockKey | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState('');
  const [loading, setLoading]       = useState(true);
  const [templateBg, setTemplateBg] = useState<string | null>(null);
  const [course, setCourse]         = useState<'3sfm' | 'bvm'>('3sfm');

  const dragRef = useRef<DragState | null>(null);

  // ── Load layouts + template background ──
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/certificate-layout').then(r => r.json()).catch(() => ({})),
    ]).then(([d]) => {
      if ((d as Record<string, unknown>).layout) setLayout((d as { layout: CertLayout }).layout);
      if ((d as Record<string, unknown>).pdfLayout) setPdfLayout((d as { pdfLayout: PdfLayout }).pdfLayout);
    }).finally(() => setLoading(false));
  }, []);

  // ── Load template background image when course changes ──
  useEffect(() => {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { publicUrl } } = sb.storage
      .from('certificates')
      .getPublicUrl(`templates/${course.toLowerCase()}-template.pdf`);
    // Verify the file actually exists before showing it
    fetch(publicUrl, { method: 'HEAD' })
      .then(res => { setTemplateBg(res.ok ? publicUrl : null); })
      .catch(() => { setTemplateBg(null); });
  }, [course]);

  // ── Mouse move / up handlers ──
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = (e.clientX - drag.startMX) / SCALE;
    const dy = (e.clientY - drag.startMY) / SCALE;

    setLayout(prev => {
      const orig = drag.origPos;
      let updated: ElemPos;

      if (drag.isResize) {
        const newW = Math.max(40, orig.width + dx);
        let newH: number;
        if (drag.key === 'logo') {
          // Proportional resize for logo
          newH = Math.max(20, newW * drag.aspectRatio);
        } else {
          // Width-only resize for other blocks
          newH = orig.height;
        }
        // Clamp to canvas
        const clampedW = Math.min(newW, CANVAS_W - orig.left);
        const clampedH = drag.key === 'logo'
          ? clampedW * drag.aspectRatio
          : newH;
        updated = { ...orig, width: Math.round(clampedW), height: Math.round(clampedH) };
      } else {
        // Move
        const newLeft = Math.max(0, Math.min(orig.left + dx, CANVAS_W - orig.width));
        const newTop  = Math.max(0, Math.min(orig.top  + dy, CANVAS_H - orig.height));
        updated = { ...orig, left: Math.round(newLeft), top: Math.round(newTop) };
      }

      return { ...prev, [drag.key]: updated };
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // ── Start drag ──
  function startDrag(e: React.MouseEvent, key: BlockKey, isResize: boolean) {
    e.preventDefault();
    e.stopPropagation();
    const origPos = layout[key];
    dragRef.current = {
      key,
      isResize,
      startMX: e.clientX,
      startMY: e.clientY,
      origPos: { ...origPos },
      aspectRatio: origPos.height / origPos.width,
    };
    setIsDragging(true);
    setSelected(key);
  }

  // ── Save ──
  async function handleSave() {
    setSaving(true);
    setSaveMsg('');
    try {
      const r = await fetch('/api/admin/certificate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout, pdfLayout }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        console.log('[CertEditor] Layout saved:', { course, layout, pdfLayout });
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

  // ── Update PDF field ──
  function handlePdfFieldChange(key: PdfFieldKey, field: string, value: string | number) {
    setPdfLayout(prev => {
      const existing = prev[key] ?? (key === 'qrCode' ? { x: 0, y: 0, width: 120, height: 120 } : { x: 0, y: 0, fontSize: 14, color: '#000000' });
      return { ...prev, [key]: { ...existing, [field]: value } };
    });
  }

  // ── Reset ──
  function handleReset() {
    if (confirm('Reset to default layout?')) {
      setLayout(DEFAULT_LAYOUT);
      setSelected(null);
    }
  }

  // ── Properties panel change ──
  function handlePropChange(key: BlockKey, field: keyof ElemPos, value: number) {
    setLayout(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: isNaN(value) ? 0 : value },
    }));
  }

  function snapH(key: BlockKey) {
    setLayout(prev => ({
      ...prev,
      [key]: { ...prev[key], left: Math.round((CANVAS_W - prev[key].width) / 2) },
    }));
  }

  function snapV(key: BlockKey) {
    setLayout(prev => ({
      ...prev,
      [key]: { ...prev[key], top: Math.round((CANVAS_H - prev[key].height) / 2) },
    }));
  }

  // ── Render block ──
  function renderBlock(key: BlockKey) {
    const pos     = layout[key];
    const isSel   = selected === key;

    const contentMap: Record<BlockKey, React.ReactNode> = {
      logo:         <LogoContent />,
      heading:      <HeadingContent />,
      studentBlock: <StudentBlockContent />,
      signature:    <SignatureContent />,
    };

    return (
      <div
        key={key}
        onMouseDown={(e) => startDrag(e, key, false)}
        onClick={(e) => { e.stopPropagation(); setSelected(key); }}
        style={{
          position:  'absolute',
          left:      pos.left,
          top:       pos.top,
          width:     pos.width,
          height:    pos.height,
          cursor:    'move',
          border:    isSel ? '2px dashed #3B82F6' : '2px dashed rgba(99,102,241,0.3)',
          boxSizing: 'border-box',
          overflow:  'hidden',
          background: isSel ? 'rgba(59,130,246,0.04)' : 'transparent',
          userSelect: 'none',
          zIndex:    isSel ? 10 : 5,
        }}
      >
        {/* Label badge */}
        <div style={{
          position: 'absolute', top: 2, left: 2, zIndex: 20,
          background: isSel ? '#3B82F6' : '#6366F1',
          color: '#fff', fontSize: 8, fontWeight: 800,
          padding: '1px 5px', borderRadius: 3,
          letterSpacing: '0.08em', lineHeight: 1.6,
          pointerEvents: 'none',
        }}>
          {BLOCK_LABELS[key]}
        </div>

        {/* Content */}
        <div style={{ pointerEvents: 'none', width: '100%', height: '100%' }}>
          {contentMap[key]}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={(e) => { e.stopPropagation(); startDrag(e, key, true); }}
          style={{
            position:  'absolute',
            bottom:    0,
            right:     0,
            width:     12,
            height:    12,
            background: isSel ? '#3B82F6' : '#6366F1',
            cursor:    'nwse-resize',
            zIndex:    21,
            borderRadius: '2px 0 0 0',
          }}
        />
      </div>
    );
  }

  const BLOCKS: BlockKey[] = ['logo', 'heading', 'studentBlock', 'signature'];

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
          padding: '16px 24px',
          background: '#fff',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex', alignItems: 'center', gap: 16,
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0D2E5A' }}>
              🎨 Certificate Editor
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9CA3AF' }}>
              Drag blocks to reposition. Click a block to edit its exact coordinates.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {saveMsg && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: saveMsg === 'Saved!' ? '#2EAA4A' : '#DC2626',
                padding: '6px 12px', background: saveMsg === 'Saved!' ? '#F0FFF4' : '#FEF2F2',
                borderRadius: 6, border: `1px solid ${saveMsg === 'Saved!' ? '#BBF7D0' : '#FECACA'}`,
              }}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={() => window.open('/training/certificate?regId=preview&course=3sfm', '_blank')}
              style={{
                padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: '#fff', border: '1px solid #D1D5DB', color: '#374151',
              }}
            >
              Preview ↗
            </button>
            <button
              onClick={handleReset}
              style={{
                padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E',
              }}
            >
              Reset to Defaults
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? '#9CA3AF' : '#2EAA4A', border: 'none', color: '#fff',
              }}
            >
              {saving ? 'Saving…' : 'Save Layout'}
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ display: 'flex', flex: 1, gap: 24, padding: 24, overflow: 'auto', minHeight: 0 }}>

          {/* ── Canvas area ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                Template: upload a PDF at{' '}
                <a href="/admin/certificates" style={{ color: '#1B4F8A' }}>/admin/certificates</a>
              </span>
            </div>

            <div
              style={{ flex: 1, display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-start' }}
              onClick={() => setSelected(null)}
            >
              {/* Outer container sized to the scaled canvas */}
              <div style={{
                width:    CANVAS_W * SCALE,
                height:   CANVAS_H * SCALE,
                flexShrink: 0,
                overflow: 'hidden',
                boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
                borderRadius: 4,
              }}>
                {/* The actual certificate canvas, scaled down */}
                <div
                  style={{
                    width:           CANVAS_W,
                    height:          CANVAS_H,
                    transform:       `scale(${SCALE})`,
                    transformOrigin: 'top left',
                    background:      '#fff',
                    position:        'relative',
                    fontFamily:      "'Inter', sans-serif",
                    cursor:          'default',
                  }}
                >
                  {/* PDF template background */}
                  {templateBg ? (
                    <iframe
                      src={templateBg}
                      style={{
                        position:      'absolute',
                        inset:         0,
                        width:         '100%',
                        height:        '100%',
                        border:        'none',
                        pointerEvents: 'none',
                        zIndex:        0,
                      }}
                      title="Certificate template preview"
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0 }}>
                      <div style={{ fontSize: 13, color: '#D1D5DB', textAlign: 'center' }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                        <div>Upload a PDF template to see it here</div>
                        <div style={{ fontSize: 11, marginTop: 4 }}>({course.toUpperCase()} template)</div>
                      </div>
                    </div>
                  )}

                  {/* Gold top stripe — fixed, not draggable */}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, zIndex: 1, background: 'linear-gradient(90deg, #C9A84C 0%, #E8C96E 50%, #C9A84C 100%)' }} />

                  {/* Gold bottom stripe — fixed */}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, zIndex: 1, background: 'linear-gradient(90deg, #C9A84C 0%, #E8C96E 50%, #C9A84C 100%)' }} />

                  {/* PDF layout field markers */}
                  {(Object.keys(pdfLayout) as PdfFieldKey[]).map(key => {
                    const field = pdfLayout[key];
                    if (!field) return null;
                    const isQr = key === 'qrCode';
                    const qr = field as PdfQrField;
                    const tf = field as PdfField;
                    return (
                      <div key={key} style={{
                        position: 'absolute',
                        left:   isQr ? qr.x : tf.x,
                        top:    isQr ? qr.y : tf.y,
                        width:  isQr ? qr.width : 200,
                        height: isQr ? qr.height : (tf.fontSize + 4),
                        border: '1.5px dashed #10B981',
                        background: 'rgba(16,185,129,0.06)',
                        zIndex: 8,
                        pointerEvents: 'none',
                        overflow: 'hidden',
                      }}>
                        <div style={{ position: 'absolute', top: 1, left: 2, fontSize: 7, fontWeight: 800, color: '#10B981', letterSpacing: '0.06em', background: 'rgba(255,255,255,0.8)', padding: '0 3px', borderRadius: 2, lineHeight: 1.6, whiteSpace: 'nowrap' }}>
                          {PDF_FIELD_LABELS[key]}
                        </div>
                      </div>
                    );
                  })}

                  {/* Draggable HTML blocks */}
                  {BLOCKS.map(k => renderBlock(k))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Right panels ── */}
          <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Properties panel */}
          <div style={{
            background: '#fff', borderRadius: 10,
            border: '1px solid #E5E7EB',
            padding: 16,
            boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
          }}>
            {selected ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#6366F1', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
                  {BLOCK_LABELS[selected]}
                </div>

                {(['left', 'top', 'width', 'height'] as (keyof ElemPos)[]).map(field => (
                  <div key={field} style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 3 }}>
                      {field.charAt(0).toUpperCase() + field.slice(1)}
                    </label>
                    <input
                      type="number"
                      value={layout[selected][field]}
                      onChange={e => handlePropChange(selected, field, parseInt(e.target.value, 10))}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '6px 8px', borderRadius: 6,
                        border: '1px solid #D1D5DB', fontSize: 13, color: '#0D2E5A',
                        background: '#FEFCE8', fontWeight: 600,
                        outline: 'none',
                      }}
                    />
                  </div>
                ))}

                <div style={{ borderTop: '1px solid #F3F4F6', marginTop: 12, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    onClick={() => snapH(selected)}
                    style={{
                      padding: '7px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8',
                    }}
                  >
                    ↔ Snap to center (H)
                  </button>
                  <button
                    onClick={() => snapV(selected)}
                    style={{
                      padding: '7px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8',
                    }}
                  >
                    ↕ Snap to center (V)
                  </button>
                </div>

                <div style={{ marginTop: 12, padding: '8px 10px', background: '#F9FAFB', borderRadius: 6, fontSize: 10, color: '#9CA3AF', lineHeight: 1.6 }}>
                  Canvas: {CANVAS_W} × {CANVAS_H}px
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, paddingTop: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🖱️</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No block selected</div>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>Click a block on the canvas to edit its position</div>
              </div>
            )}
          </div>

          {/* PDF Layout panel */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #10B981', padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.05)', maxHeight: 420, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#10B981', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
              PDF Field Positions
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10, lineHeight: 1.5 }}>
              These coordinates are used when generating certificate PDFs. X/Y are from top-left.
            </div>
            {(Object.keys(pdfLayout) as PdfFieldKey[]).map(key => {
              const field = pdfLayout[key];
              if (!field) return null;
              const isQr = key === 'qrCode';
              const qr   = field as PdfQrField;
              const tf   = field as PdfField;
              return (
                <div key={key} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#374151', marginBottom: 6 }}>
                    {PDF_FIELD_LABELS[key]}
                  </div>
                  {isQr ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {(['x', 'y', 'width', 'height'] as const).map(f => (
                        <div key={f}>
                          <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>{f.toUpperCase()}</div>
                          <input type="number" value={qr[f]} onChange={e => handlePdfFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '4px 6px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: '#F0FFF4', outline: 'none' }} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                        {(['x', 'y', 'fontSize'] as const).map(f => (
                          <div key={f}>
                            <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>{f === 'fontSize' ? 'SIZE' : f.toUpperCase()}</div>
                            <input type="number" value={tf[f]} onChange={e => handlePdfFieldChange(key, f, parseInt(e.target.value, 10) || 0)}
                              style={{ width: '100%', boxSizing: 'border-box', padding: '4px 6px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: '#F0FFF4', outline: 'none' }} />
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#9CA3AF', marginBottom: 2 }}>COLOR</div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input type="color" value={tf.color} onChange={e => handlePdfFieldChange(key, 'color', e.target.value)}
                            style={{ width: 32, height: 24, padding: 0, border: '1px solid #D1D5DB', borderRadius: 3, cursor: 'pointer' }} />
                          <input type="text" value={tf.color} onChange={e => handlePdfFieldChange(key, 'color', e.target.value)}
                            style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: '#F0FFF4', outline: 'none', fontFamily: 'monospace' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          </div>{/* end right panels */}
        </div>
      </main>
    </div>
  );
}
