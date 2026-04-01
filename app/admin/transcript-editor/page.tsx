'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── PDF virtual dimensions (mirrors @react-pdf/renderer A4 output) ────────────
const PDF_W  = 595;
const PDF_H  = 842;
const SCALE  = 0.68;    // preview scale factor
const H_PAD  = 36;      // horizontal padding (matches PDF)

// Brand colours (mirror the transcript route)
const C = {
  navy:   '#0D2E5A',
  navy2:  '#1B4F8A',
  green:  '#2EAA4A',
  lBlue:  '#EBF3FC',
  border: '#E5E7EB',
  lGrey:  '#F9FAFB',
  gold:   '#C9A84C',
  goldBg: '#FDF3DC',
  text:   '#111827',
  muted:  '#6B7280',
};

type LogoPos = 'left' | 'center' | 'right' | 'none';

interface Settings {
  headerTitle:  string;
  subtitle:     string;
  footer1:      string;
  footer2:      string;
  instructor:   string;
  websiteUrl:   string;
  logoUrl:      string;
  logoWidth:    number;
  logoPosition: LogoPos;
}

const DEFAULTS: Settings = {
  headerTitle:  'OFFICIAL ACADEMIC TRANSCRIPT',
  subtitle:     'FMP Training Hub',
  footer1:      'This transcript is an official record issued by Financial Modeler Pro.',
  footer2:      'Verify certificate authenticity at certifier.io',
  instructor:   'Ahmad Din | Corporate Finance Expert',
  websiteUrl:   'www.financialmodelerpro.com',
  logoUrl:      '',
  logoWidth:    32,
  logoPosition: 'right',
};

function logoX(pos: LogoPos, w: number): number {
  if (pos === 'left')   return H_PAD;
  if (pos === 'center') return (PDF_W - w) / 2;
  return PDF_W - H_PAD - w; // right (and fallback)
}

function snapPos(x: number, w: number): LogoPos {
  const pts = [
    { p: 'left'   as LogoPos, d: Math.abs(x - H_PAD) },
    { p: 'center' as LogoPos, d: Math.abs(x - (PDF_W - w) / 2) },
    { p: 'right'  as LogoPos, d: Math.abs(x - (PDF_W - H_PAD - w)) },
  ];
  return pts.sort((a, b) => a.d - b.d)[0].p;
}

// Sample session names for the preview table
const SAMPLE_SESSIONS = [
  'Introduction & Framework Overview',
  'Project Overview & Timeline',
  'Capex & Funding Requirement',
  'Plant Capacity & Production Plan',
  'Revenue & Inventory Modeling',
  'COGS & Raw Material Cost Modeling',
  'Operating Expenses',
  'EBITDA & Depreciation',
  'Working Capital Cycle',
  'Income Statement Build',
  'Balance Sheet Build',
  'Cash Flow Statement',
  'Debt Schedule',
  'Fixed Assets Schedule',
  'Financial Ratios',
  'Sensitivity Analysis',
  'Charts & Visualization',
  'Final Review & Integration',
];

export default function TranscriptEditorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [settings,      setSettings]      = useState<Settings>(DEFAULTS);
  const [dirty,         setDirty]         = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [toast,         setToast]         = useState('');

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragX,      setDragX]      = useState(0);
  const dragStartRef = useRef<{ mouseX: number; initLogoX: number } | null>(null);
  const previewRef   = useRef<HTMLDivElement>(null);

  // Auth guard
  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (status === 'authenticated' && (session?.user as any)?.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  // Load settings
  useEffect(() => {
    fetch('/api/admin/content?section=transcript')
      .then(r => r.json())
      .then((cms: { rows?: { key: string; value: string }[] }) => {
        const rows = Array.isArray(cms.rows) ? cms.rows : [];
        const map: Record<string, string> = {};
        rows.forEach(r => { map[r.key] = r.value; });
        const rawW = parseInt(map['transcript_logo_width'] ?? '', 10);
        const rawP = map['transcript_logo_position'] ?? '';
        setSettings({
          headerTitle:  map['transcript_header_title']  || DEFAULTS.headerTitle,
          subtitle:     map['transcript_subtitle']       || DEFAULTS.subtitle,
          footer1:      map['transcript_footer_1']       || DEFAULTS.footer1,
          footer2:      map['transcript_footer_2']       || DEFAULTS.footer2,
          instructor:   map['transcript_instructor']     || DEFAULTS.instructor,
          websiteUrl:   map['transcript_website_url']    || DEFAULTS.websiteUrl,
          logoUrl:      map['transcript_logo_url']       || '',
          logoWidth:    Number.isFinite(rawW) && rawW > 0 ? rawW : DEFAULTS.logoWidth,
          logoPosition: (['left', 'center', 'right', 'none'] as const).includes(rawP as LogoPos)
            ? rawP as LogoPos : DEFAULTS.logoPosition,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function upd<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  async function saveAll() {
    setSaving(true);
    const pairs: [string, string][] = [
      ['transcript_header_title',  settings.headerTitle],
      ['transcript_subtitle',      settings.subtitle],
      ['transcript_footer_1',      settings.footer1],
      ['transcript_footer_2',      settings.footer2],
      ['transcript_instructor',    settings.instructor],
      ['transcript_website_url',   settings.websiteUrl],
      ['transcript_logo_url',      settings.logoUrl],
      ['transcript_logo_width',    String(settings.logoWidth)],
      ['transcript_logo_position', settings.logoPosition],
    ];
    try {
      await Promise.all(pairs.map(([key, value]) =>
        fetch('/api/admin/content', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ section: 'transcript', key, value }),
        }),
      ));
      showToast('All settings saved ✓');
      setDirty(false);
    } catch {
      showToast('Save failed');
    }
    setSaving(false);
  }

  async function uploadLogo(file: File) {
    setLogoUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('bucket', 'cms-assets');
      form.append('folder', 'transcript-logos');
      const res = await fetch('/api/admin/media', { method: 'POST', body: form });
      if (!res.ok) { showToast('Upload failed'); return; }
      const { url } = await res.json() as { url: string };
      upd('logoUrl', url);
      showToast('Logo uploaded — click Save All to apply');
    } catch {
      showToast('Upload failed');
    }
    setLogoUploading(false);
  }

  // ── Logo drag ─────────────────────────────────────────────────────────────────
  function handleLogoDragStart(e: React.MouseEvent) {
    e.preventDefault();
    const initX = isDragging ? dragX : logoX(settings.logoPosition, settings.logoWidth);
    dragStartRef.current = { mouseX: e.clientX, initLogoX: initX };
    setDragX(initX);
    setIsDragging(true);
  }

  useEffect(() => {
    if (!isDragging) return;
    const w = settings.logoWidth;
    function onMouseMove(e: MouseEvent) {
      if (!dragStartRef.current) return;
      const dx = (e.clientX - dragStartRef.current.mouseX) / SCALE;
      const nx = dragStartRef.current.initLogoX + dx;
      setDragX(Math.max(H_PAD, Math.min(PDF_W - H_PAD - w, nx)));
    }
    function onMouseUp() {
      const snapped = snapPos(dragX, w);
      setSettings(prev => ({ ...prev, logoPosition: snapped }));
      setDirty(true);
      setIsDragging(false);
      dragStartRef.current = null;
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, dragX, settings.logoWidth]);

  const currentLogoX = isDragging ? dragX : (settings.logoPosition !== 'none' ? logoX(settings.logoPosition, settings.logoWidth) : 0);
  const logoTop = 14; // fixed vertical position within header

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 12,
    border: '1px solid #D1D5DB', borderRadius: 6,
    background: '#FFFBEB', fontFamily: 'Inter,sans-serif',
    outline: 'none', boxSizing: 'border-box', color: '#1B3A6B',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: '#6B7280',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    marginBottom: 4, display: 'block',
  };

  // Approximate header height (for spacing)
  const HEADER_H = Math.max(70, settings.logoWidth + logoTop + 12);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/transcript-editor" />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100vh' }}>

        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B' }}>📄 Transcript Editor</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
              Edit all transcript settings and drag the logo in the preview to reposition it · Applies to all student transcripts
            </div>
          </div>
          <button onClick={() => { setSettings(DEFAULTS); setDirty(true); }}
            style={{ padding: '8px 14px', background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Reset Defaults
          </button>
          <button onClick={saveAll} disabled={saving || !dirty}
            style={{ padding: '8px 22px', background: dirty ? '#1B4F8A' : '#F3F4F6', color: dirty ? '#fff' : '#9CA3AF', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : dirty ? '💾 Save All' : '✓ Saved'}
          </button>
        </div>

        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280', fontSize: 14 }}>
            Loading settings…
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

            {/* ── Settings panel ────────────────────────────────────────── */}
            <div style={{ width: 320, flexShrink: 0, background: '#fff', borderRight: '1px solid #E5E7EB', overflowY: 'auto', padding: '20px 18px' }}>

              {/* Logo */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#1B3A6B', marginBottom: 12, paddingBottom: 7, borderBottom: '1.5px solid #E5E7EB' }}>
                  🖼 Logo
                </div>

                {settings.logoUrl ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={settings.logoUrl} alt="Logo"
                      style={{ height: 40, maxWidth: 130, objectFit: 'contain', background: C.navy, padding: 4, borderRadius: 4 }} />
                    <button onClick={() => upd('logoUrl', '')}
                      style={{ fontSize: 11, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10, fontStyle: 'italic' }}>
                    No logo set — branding logo used as fallback
                  </div>
                )}

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: logoUploading ? '#F3F4F6' : '#1B4F8A', color: logoUploading ? '#9CA3AF' : '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: logoUploading ? 'default' : 'pointer', marginBottom: 14 }}>
                  {logoUploading ? 'Uploading…' : '📁 Upload Logo'}
                  <input type="file" accept="image/*" disabled={logoUploading} style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
                </label>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Size in PDF</label>
                  <select value={settings.logoWidth} onChange={e => upd('logoWidth', parseInt(e.target.value))}
                    style={{ ...fieldStyle, background: '#fff', cursor: 'pointer' }}>
                    <option value={24}>Small — 24pt</option>
                    <option value={32}>Medium — 32pt (default)</option>
                    <option value={48}>Large — 48pt</option>
                    <option value={64}>X-Large — 64pt</option>
                  </select>
                </div>

                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>
                    Position{' '}
                    <span style={{ fontWeight: 400, textTransform: 'none', color: '#9CA3AF' }}>
                      — or drag in preview →
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {(['left', 'center', 'right', 'none'] as const).map(p => (
                      <button key={p} onClick={() => upd('logoPosition', p)}
                        style={{ flex: 1, padding: '6px 4px', borderRadius: 5, border: `1.5px solid ${settings.logoPosition === p ? C.navy2 : '#D1D5DB'}`, background: settings.logoPosition === p ? C.navy2 : '#fff', color: settings.logoPosition === p ? '#fff' : '#6B7280', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Text fields */}
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1B3A6B', marginBottom: 12, paddingBottom: 7, borderBottom: '1.5px solid #E5E7EB' }}>
                ✏️ Text Content
              </div>

              {([
                { key: 'headerTitle' as keyof Settings, label: 'Header Title',    placeholder: DEFAULTS.headerTitle },
                { key: 'subtitle'    as keyof Settings, label: 'Subtitle Badge',  placeholder: DEFAULTS.subtitle },
                { key: 'instructor'  as keyof Settings, label: 'Instructor',      placeholder: DEFAULTS.instructor },
                { key: 'websiteUrl'  as keyof Settings, label: 'Website URL',     placeholder: DEFAULTS.websiteUrl },
                { key: 'footer1'     as keyof Settings, label: 'Footer Line 1',   placeholder: DEFAULTS.footer1 },
                { key: 'footer2'     as keyof Settings, label: 'Footer Line 2',   placeholder: DEFAULTS.footer2 },
              ]).map(({ key, label, placeholder }) => (
                <div key={key} style={{ marginBottom: 13 }}>
                  <label style={labelStyle}>{label}</label>
                  <input value={settings[key] as string} placeholder={placeholder}
                    onChange={e => upd(key, e.target.value)} style={fieldStyle} />
                </div>
              ))}

              <div style={{ marginTop: 6, background: '#EFF6FF', borderRadius: 7, padding: '10px 12px', fontSize: 11, color: '#1E40AF', lineHeight: 1.5 }}>
                💡 Drag the logo in the preview panel to reposition it. Changes are live in the preview — click <strong>Save All</strong> to apply to generated PDFs.
              </div>
            </div>

            {/* ── Live preview panel ────────────────────────────────────── */}
            <div style={{
              flex: 1, overflowY: 'auto', overflowX: 'auto',
              background: '#D8DDE8',
              display: 'flex', justifyContent: 'center',
              padding: '28px 32px',
              userSelect: isDragging ? 'none' : undefined,
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', marginBottom: 10, fontWeight: 600, letterSpacing: '0.03em' }}>
                  A4 PREVIEW — {Math.round(SCALE * 100)}% scale
                  {isDragging && <span style={{ color: C.navy2, marginLeft: 8 }}>· Dragging logo…</span>}
                  {settings.logoPosition !== 'none' && settings.logoUrl && (
                    <span style={{ color: C.muted, marginLeft: 8 }}>· Logo: <strong style={{ color: C.navy }}>{settings.logoPosition}</strong></span>
                  )}
                </div>

                {/* A4 page at PDF_W × PDF_H */}
                <div ref={previewRef} style={{
                  width: PDF_W, height: PDF_H,
                  transform: `scale(${SCALE})`,
                  transformOrigin: 'top left',
                  background: '#fff',
                  boxShadow: '0 6px 40px rgba(0,0,0,0.25)',
                  position: 'relative',
                  cursor: isDragging ? 'grabbing' : 'default',
                  fontFamily: 'Helvetica,Arial,sans-serif',
                  overflow: 'hidden',
                }}>

                  {/* ── Header ──────────────────────────────────── */}
                  <div style={{
                    background: C.navy,
                    paddingLeft: H_PAD, paddingRight: H_PAD,
                    paddingTop: 14, paddingBottom: 12,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    position: 'relative',
                    minHeight: HEADER_H,
                    boxSizing: 'border-box',
                  }}>
                    {/* Left text block */}
                    <div style={{ flex: 1, paddingRight: 16 }}>
                      {/* Center: logo placeholder pushes text down */}
                      {settings.logoPosition === 'center' && settings.logoUrl && (
                        <div style={{ height: settings.logoWidth + 8 }} />
                      )}
                      <div style={{
                        display: 'flex', alignItems: 'center', marginBottom: 2,
                        // Left: indent brand name to make room for the logo
                        paddingLeft: settings.logoPosition === 'left' && settings.logoUrl ? settings.logoWidth + 10 : 0,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fff' }}>Financial Modeler Pro</span>
                      </div>
                      <div style={{
                        fontSize: 7, color: 'rgba(255,255,255,0.55)', marginBottom: 1,
                        paddingLeft: settings.logoPosition === 'left' && settings.logoUrl ? settings.logoWidth + 10 : 0,
                      }}>
                        {settings.websiteUrl || DEFAULTS.websiteUrl}
                      </div>
                      <div style={{
                        fontSize: 7, color: 'rgba(255,255,255,0.55)',
                        paddingLeft: settings.logoPosition === 'left' && settings.logoUrl ? settings.logoWidth + 10 : 0,
                      }}>
                        {settings.instructor || DEFAULTS.instructor}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 'bold', color: '#90CAF9', letterSpacing: 1.2, marginTop: 6 }}>
                        {settings.headerTitle || DEFAULTS.headerTitle}
                      </div>
                    </div>

                    {/* Right: subtitle badge (+ space for logo if position=right) */}
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      {settings.logoPosition === 'right' && settings.logoUrl && (
                        <div style={{ height: settings.logoWidth + 6 }} />
                      )}
                      <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 8px' }}>
                        <span style={{ fontSize: 7.5, fontWeight: 'bold', color: 'rgba(255,255,255,0.8)' }}>
                          {settings.subtitle || DEFAULTS.subtitle}
                        </span>
                      </div>
                    </div>

                    {/* Draggable logo (absolute overlay) */}
                    {settings.logoPosition !== 'none' && (
                      settings.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={settings.logoUrl}
                          alt="Logo"
                          draggable={false}
                          onMouseDown={handleLogoDragStart}
                          style={{
                            position: 'absolute',
                            left: currentLogoX,
                            top: logoTop,
                            width: settings.logoWidth,
                            height: settings.logoWidth,
                            objectFit: 'contain',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex: 10,
                            borderRadius: 2,
                            border: isDragging ? '2px dashed rgba(255,255,255,0.55)' : '2px dashed transparent',
                            transition: isDragging ? 'none' : 'left 0.2s ease',
                          }}
                        />
                      ) : (
                        /* Logo placeholder when no logo is set */
                        <div style={{
                          position: 'absolute',
                          left: logoX(settings.logoPosition, 32),
                          top: logoTop,
                          width: 32, height: 32,
                          background: 'rgba(255,255,255,0.07)',
                          border: '1.5px dashed rgba(255,255,255,0.2)',
                          borderRadius: 3,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)' }}>logo</span>
                        </div>
                      )
                    )}
                  </div>

                  {/* ── Student info strip ──────────────────────── */}
                  <div style={{
                    background: C.lBlue,
                    paddingLeft: H_PAD, paddingRight: H_PAD,
                    paddingTop: 10, paddingBottom: 10,
                    display: 'flex', gap: 16,
                  }}>
                    {[
                      [['Student Name', 'Ahmed Al-Rashidi'], ['Registration ID', 'FMP-2024-001'], ['Email', 'ahmed@example.com']],
                      [['Course', '3-Statement Financial Modeling (3SFM)'], ['Enrollment Date', '1 January 2024'], ['Issue Date', '1 April 2026']],
                    ].map((col, ci) => (
                      <div key={ci} style={{ flex: 1 }}>
                        {col.map(([lbl, val]) => (
                          <div key={lbl} style={{ display: 'flex', marginBottom: 3 }}>
                            <span style={{ fontSize: 8, fontWeight: 'bold', color: C.navy2, width: 100, flexShrink: 0 }}>{lbl}</span>
                            <span style={{ fontSize: 8.5, color: C.text, fontWeight: lbl === 'Student Name' ? 'bold' : 'normal' }}>{val}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* ── Status banner ───────────────────────────── */}
                  <div style={{
                    background: '#F0FFF4', paddingLeft: H_PAD, paddingRight: H_PAD,
                    paddingTop: 6, paddingBottom: 6,
                    borderTop: '1px solid #BBF7D0', borderBottom: '1px solid #BBF7D0',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 'bold', color: '#166534' }}>✓ OFFICIAL TRANSCRIPT — Course Complete</div>
                    <div style={{ fontSize: 8, color: '#166534', marginTop: 2 }}>
                      All requirements fulfilled. Certificate issued as of 1 April 2026.
                    </div>
                  </div>

                  {/* ── Section heading ─────────────────────────── */}
                  <div style={{ paddingLeft: H_PAD, paddingRight: H_PAD, paddingTop: 12, paddingBottom: 5, display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 'bold', color: C.navy, marginRight: 8 }}>
                      3-Statement Financial Modeling (3SFM)
                    </span>
                    <div style={{ flex: 1, height: 1, background: C.border }} />
                  </div>

                  {/* ── Session table ────────────────────────────── */}
                  <div style={{ paddingLeft: H_PAD, paddingRight: H_PAD }}>
                    {/* Header row */}
                    <div style={{ background: C.navy2, display: 'flex', borderRadius: 4, paddingTop: 5, paddingBottom: 5 }}>
                      {[['28px','#'],['flex','Session Name'],['46px','Score'],['76px','Status'],['52px','Attempts']].map(([w, h]) => (
                        <div key={h} style={{ width: w === 'flex' ? undefined : w, flex: w === 'flex' ? 1 : undefined, paddingLeft: 6, paddingRight: 4 }}>
                          <span style={{ fontSize: 8, fontWeight: 'bold', color: '#fff' }}>{h}</span>
                        </div>
                      ))}
                    </div>
                    {/* Data rows */}
                    {SAMPLE_SESSIONS.map((name, i) => (
                      <div key={i} style={{
                        display: 'flex', borderBottom: `1px solid ${C.border}`,
                        paddingTop: 4, paddingBottom: 4,
                        background: i % 2 === 1 ? C.lGrey : '#fff',
                      }}>
                        <div style={{ width: 28, paddingLeft: 6 }}>
                          <span style={{ fontSize: 8, color: C.muted }}>S{i + 1}</span>
                        </div>
                        <div style={{ flex: 1, paddingLeft: 6 }}>
                          <span style={{ fontSize: 8.5, color: C.text }}>Session {i + 1}: {name}</span>
                        </div>
                        <div style={{ width: 46, paddingLeft: 4, textAlign: 'center' }}>
                          <span style={{ fontSize: 8.5, fontWeight: 'bold', color: C.text }}>{78 + (i % 7) * 3}%</span>
                        </div>
                        <div style={{ width: 76, paddingLeft: 4 }}>
                          <span style={{ fontSize: 7.5, fontWeight: 'bold', background: '#D1FAE5', borderRadius: 3, padding: '2px 5px', color: '#065F46' }}>PASSED</span>
                        </div>
                        <div style={{ width: 52, paddingLeft: 6, textAlign: 'center' }}>
                          <span style={{ fontSize: 8.5, color: C.text }}>1 / 3</span>
                        </div>
                      </div>
                    ))}
                    {/* Final exam */}
                    <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, paddingTop: 4, paddingBottom: 4, background: C.goldBg }}>
                      <div style={{ width: 28, paddingLeft: 6 }}>
                        <span style={{ fontSize: 7.5, fontWeight: 'bold', color: C.gold }}>FINAL</span>
                      </div>
                      <div style={{ flex: 1, paddingLeft: 6 }}>
                        <div style={{ fontSize: 8.5, fontWeight: 'bold', color: C.text }}>Final Examination</div>
                        <div style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>50 questions · Pass mark 70%</div>
                      </div>
                      <div style={{ width: 46, paddingLeft: 4, textAlign: 'center' }}>
                        <span style={{ fontSize: 8.5, fontWeight: 'bold', color: C.text }}>84%</span>
                      </div>
                      <div style={{ width: 76, paddingLeft: 4 }}>
                        <span style={{ fontSize: 7.5, fontWeight: 'bold', background: '#D1FAE5', borderRadius: 3, padding: '2px 5px', color: '#065F46' }}>PASSED</span>
                      </div>
                      <div style={{ width: 52, paddingLeft: 6, textAlign: 'center' }}>
                        <span style={{ fontSize: 8.5, color: C.text }}>1 / 3</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Summary boxes ────────────────────────────── */}
                  <div style={{ display: 'flex', paddingLeft: H_PAD, paddingRight: H_PAD, paddingTop: 10, gap: 12 }}>
                    <div style={{ flex: 1, border: `1.5px solid ${C.navy2}`, borderRadius: 6, padding: 10 }}>
                      <div style={{ fontSize: 8.5, fontWeight: 'bold', color: C.navy, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>Academic Summary — 3SFM</div>
                      {[['Sessions Completed', '18 of 18'], ['Sessions Passed', '18 of 18'], ['Average Score', '86%'], ['Final Exam Score', '84%'], ['Overall Result', 'PASSED']].map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 8, color: C.muted }}>{l}</span>
                          <span style={{ fontSize: 8, fontWeight: 'bold', color: v === 'PASSED' ? C.green : C.text }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ flex: 1, border: `1.5px solid ${C.green}`, borderRadius: 6, padding: 10 }}>
                      <div style={{ fontSize: 8.5, fontWeight: 'bold', color: C.navy, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>Certification Status</div>
                      {[['Status', 'CERTIFIED'], ['Certificate ID', 'CERT-2024-3SFM-001'], ['Issued', '15 March 2024'], ['Verify at', 'certifier.io/verify →']].map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 8, color: C.muted }}>{l}</span>
                          <span style={{ fontSize: 8, fontWeight: 'bold', color: l === 'Status' ? C.green : C.navy2 }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Footer (absolute bottom) ─────────────────── */}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: C.navy,
                    paddingLeft: H_PAD, paddingRight: H_PAD,
                    paddingTop: 7, paddingBottom: 7,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.55)' }}>Issue Date: 1 April 2026</span>
                    <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.55)', textAlign: 'center', flex: 1, margin: '0 8px' }}>
                      {settings.footer1 || DEFAULTS.footer1}{'  '}{settings.footer2 || DEFAULTS.footer2}
                    </span>
                    <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.55)' }}>{settings.websiteUrl || DEFAULTS.websiteUrl}</span>
                  </div>

                </div>

                {/* Wrapper div height to match scaled content */}
                <div style={{ height: PDF_H * SCALE, marginTop: -(PDF_H - PDF_H * SCALE) }} />
              </div>
            </div>

          </div>
        )}
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
