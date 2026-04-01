'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Canvas constants ───────────────────────────────────────────────────────────
const PDF_W = 595;
const PDF_H = 842;
const SCALE = 0.68;
const CW    = Math.round(PDF_W * SCALE); // 404px
const CH    = Math.round(PDF_H * SCALE); // 572px

// ── Sample data ────────────────────────────────────────────────────────────────
const SAMPLE_SESSIONS = [
  { name: 'Introduction to Financial Modeling',  score: 90, status: 'PASSED', attempts: 1 },
  { name: 'Income Statement & Revenue Drivers',  score: 87, status: 'PASSED', attempts: 1 },
  { name: 'Balance Sheet Mechanics',             score: 84, status: 'PASSED', attempts: 2 },
  { name: 'Cash Flow Statement',                 score: 81, status: 'PASSED', attempts: 1 },
  { name: 'Three-Statement Integration',         score: 75, status: 'PASSED', attempts: 2 },
  { name: 'Final Assessment',                    score: 88, status: 'PASSED', attempts: 1 },
];

// ── Settings ───────────────────────────────────────────────────────────────────
interface Settings {
  logoUrl:          string;
  logoX:            number;
  logoY:            number;
  logoWidth:        number;
  headerTitle:      string;
  subtitle:         string;
  instructor:       string;
  websiteUrl:       string;
  headerBgColor:    string;
  headerTextColor:  string;
  tableHeaderColor: string;
  passedColor:      string;
  failedColor:      string;
  fontSizeHeader:   number;
  fontSizeSubtitle: number;
  fontSizeBody:     number;
  fontSizeTable:    number;
  marginTop:        number;
  marginBottom:     number;
  marginLeft:       number;
  marginRight:      number;
  footer1:          string;
  footer2:          string;
  footerFontSize:   number;
  pageSize:         string;
  colNum:           number;
  colSession:       number;
  colScore:         number;
  colStatus:        number;
  colAttempts:      number;
  rowHdrH:          number;
  rowDataH:         number;
  infoColLeft:      number;
  infoRowH:         number;
}

const DEFAULTS: Settings = {
  logoUrl:          '',
  logoX:            499,
  logoY:            18,
  logoWidth:        60,
  headerTitle:      'OFFICIAL ACADEMIC TRANSCRIPT',
  subtitle:         'FMP Training Hub',
  instructor:       'Ahmad Din | Corporate Finance Expert',
  websiteUrl:       'www.financialmodelerpro.com',
  headerBgColor:    '#0D2E5A',
  headerTextColor:  '#FFFFFF',
  tableHeaderColor: '#1B4F8A',
  passedColor:      '#2EAA4A',
  failedColor:      '#DC2626',
  fontSizeHeader:   15,
  fontSizeSubtitle: 9,
  fontSizeBody:     8.5,
  fontSizeTable:    7.5,
  marginTop:        20,
  marginBottom:     20,
  marginLeft:       36,
  marginRight:      36,
  footer1:          'This transcript is an official record issued by Financial Modeler Pro.',
  footer2:          'Verify certificate authenticity at certifier.io',
  footerFontSize:   7.5,
  pageSize:         'A4',
  colNum:           30,
  colSession:       220,
  colScore:         55,
  colStatus:        80,
  colAttempts:      55,
  rowHdrH:          22,
  rowDataH:         17,
  infoColLeft:      145,
  infoRowH:         18,
};

const CMS_KEYS: Record<keyof Settings, string> = {
  logoUrl:          'transcript_logo_url',
  logoX:            'transcript_logo_x',
  logoY:            'transcript_logo_y',
  logoWidth:        'transcript_logo_width',
  headerTitle:      'transcript_header_title',
  subtitle:         'transcript_subtitle',
  instructor:       'transcript_instructor',
  websiteUrl:       'transcript_website_url',
  headerBgColor:    'transcript_header_bg_color',
  headerTextColor:  'transcript_header_text_color',
  tableHeaderColor: 'transcript_table_header_color',
  passedColor:      'transcript_passed_color',
  failedColor:      'transcript_failed_color',
  fontSizeHeader:   'transcript_font_size_header',
  fontSizeSubtitle: 'transcript_font_size_subtitle',
  fontSizeBody:     'transcript_font_size_body',
  fontSizeTable:    'transcript_font_size_table',
  marginTop:        'transcript_margin_top',
  marginBottom:     'transcript_margin_bottom',
  marginLeft:       'transcript_margin_left',
  marginRight:      'transcript_margin_right',
  footer1:          'transcript_footer_1',
  footer2:          'transcript_footer_2',
  footerFontSize:   'transcript_footer_font_size',
  pageSize:         'transcript_page_size',
  colNum:           'transcript_col_width_num',
  colSession:       'transcript_col_width_session',
  colScore:         'transcript_col_width_score',
  colStatus:        'transcript_col_width_status',
  colAttempts:      'transcript_col_width_attempts',
  rowHdrH:          'transcript_row_height_header',
  rowDataH:         'transcript_row_height_data',
  infoColLeft:      'transcript_info_col_width_left',
  infoRowH:         'transcript_info_row_height',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function s(v: number) { return Math.round(v * SCALE); } // pdf pts → screen px
function p(v: number) { return v / SCALE; }              // screen px → pdf pts

function Section({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '1px solid #E8F0FB' }}>
      <button onClick={onToggle} style={{ width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 700, color: '#1B3A6B', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {title}
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '4px 16px 14px' }}>{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      {children}
    </div>
  );
}

function Slider({ value, min, max, step = 0.5, onChange }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#1B4F8A' }} />
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value) || min)}
        style={{ width: 48, padding: '3px 5px', fontSize: 11, border: '1px solid #D1D5DB', borderRadius: 4, textAlign: 'center' }} />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: 36, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, padding: 2, cursor: 'pointer' }} />
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        style={{ flex: 1, padding: '4px 7px', fontSize: 11, border: '1px solid #D1D5DB', borderRadius: 4, fontFamily: 'monospace' }} />
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #D1D5DB', borderRadius: 5, boxSizing: 'border-box', fontFamily: "'Inter',sans-serif" }} />
  );
}

// ── Inline editable text on canvas ────────────────────────────────────────────
function EditableText({
  value, onChange, editing, onStartEdit, onEndEdit,
  style, inputStyle, multiline = false,
}: {
  value: string; onChange: (v: string) => void;
  editing: boolean; onStartEdit: () => void; onEndEdit: () => void;
  style?: React.CSSProperties; inputStyle?: React.CSSProperties;
  multiline?: boolean;
}) {
  if (editing) {
    const common: React.CSSProperties = {
      background: 'rgba(255,255,255,0.15)',
      border: '1.5px solid rgba(255,255,255,0.6)',
      borderRadius: 3,
      outline: 'none',
      color: 'inherit',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      fontWeight: 'inherit',
      letterSpacing: 'inherit',
      textAlign: 'inherit' as React.CSSProperties['textAlign'],
      width: '100%',
      padding: '1px 3px',
      boxSizing: 'border-box' as const,
      ...inputStyle,
    };
    if (multiline) {
      return <textarea value={value} onChange={e => onChange(e.target.value)} onBlur={onEndEdit}
        autoFocus rows={2} style={{ ...common, resize: 'none', lineHeight: 'inherit' }} />;
    }
    return <input type="text" value={value} onChange={e => onChange(e.target.value)}
      onBlur={onEndEdit} onKeyDown={e => e.key === 'Enter' && onEndEdit()} autoFocus style={common} />;
  }
  return (
    <div onClick={onStartEdit} title="Click to edit" style={{ cursor: 'text', ...style }}>
      {value || <span style={{ opacity: 0.4 }}>Click to edit…</span>}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function TranscriptEditorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [s_,   setS]    = useState<Settings>(DEFAULTS);
  const [open,  setOpen] = useState({ logo: true, typography: false, colors: false, page: false, footer: false });
  const [editF, setEditF] = useState<string | null>(null);
  const [selEl, setSelEl] = useState<'logo' | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast,  setToast]  = useState('');
  const [uploading, setUploading] = useState(false);

  // Drag/resize refs (avoid state churn during mouse move)
  const logoDragRef   = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);
  const logoResizeRef = useRef<{ startX: number; initW: number } | null>(null);
  const colDragRef    = useRef<{ col: 'colNum'|'colSession'|'colScore'|'colStatus'|'colAttempts'; startX: number; initW: number; nextCol: keyof Settings; initNext: number } | null>(null);
  const canvasRef     = useRef<HTMLDivElement>(null);
  const fileRef       = useRef<HTMLInputElement>(null);

  // shorthand update
  const upd = useCallback((patch: Partial<Settings>) => setS(prev => ({ ...prev, ...patch })), []);
  const tog  = useCallback((k: keyof typeof open) => setOpen(prev => ({ ...prev, [k]: !prev[k] })), []);

  // auth guard
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  // load from supabase
  useEffect(() => {
    fetch('/api/admin/content?section=transcript')
      .then(r => r.json())
      .then((cms: { rows?: { key: string; value: string }[] }) => {
        const map: Record<string, string> = {};
        (cms.rows ?? []).forEach(r => { map[r.key] = r.value; });
        const patch: Partial<Settings> = {};
        (Object.entries(CMS_KEYS) as [keyof Settings, string][]).forEach(([sk, ck]) => {
          if (map[ck] !== undefined) {
            const def = DEFAULTS[sk];
            (patch as Record<string, unknown>)[sk] = typeof def === 'number' ? parseFloat(map[ck]) || def : map[ck];
          }
        });
        if (Object.keys(patch).length) upd(patch);
      })
      .catch(() => {});
  }, [upd]);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); }, []);

  // ── Save all ────────────────────────────────────────────────────────────────
  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      await Promise.all(
        (Object.entries(CMS_KEYS) as [keyof Settings, string][]).map(([sk, ck]) =>
          fetch('/api/admin/content', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section: 'transcript', key: ck, value: String(s_[sk]) }),
          })
        )
      );
      showToast('All settings saved');
    } catch {
      showToast('Save failed');
    }
    setSaving(false);
  }, [s_, showToast]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const resetDefaults = useCallback(() => {
    if (!confirm('Reset all settings to defaults?')) return;
    setS(DEFAULTS);
    showToast('Reset to defaults — click Save to persist');
  }, [showToast]);

  // ── Logo upload ─────────────────────────────────────────────────────────────
  const uploadLogo = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('bucket', 'cms-assets');
      form.append('folder', 'transcript-logos');
      const res  = await fetch('/api/admin/media', { method: 'POST', body: form });
      const data = await res.json() as { url?: string };
      if (data.url) upd({ logoUrl: data.url });
      showToast('Logo uploaded');
    } catch { showToast('Upload failed'); }
    setUploading(false);
  }, [upd, showToast]);

  // ── Logo drag ───────────────────────────────────────────────────────────────
  const onLogoDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    logoDragRef.current = { startX: e.clientX, startY: e.clientY, initX: s_.logoX, initY: s_.logoY };
    setSelEl('logo');

    const onMove = (ev: MouseEvent) => {
      if (!logoDragRef.current) return;
      const dx = ev.clientX - logoDragRef.current.startX;
      const dy = ev.clientY - logoDragRef.current.startY;
      setS(prev => ({
        ...prev,
        logoX: Math.max(0, Math.min(PDF_W - prev.logoWidth, logoDragRef.current!.initX + p(dx))),
        logoY: Math.max(0, Math.min(100, logoDragRef.current!.initY + p(dy))),
      }));
    };
    const onUp = () => {
      logoDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [s_.logoX, s_.logoY]);

  // ── Logo resize ─────────────────────────────────────────────────────────────
  const onLogoResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    logoResizeRef.current = { startX: e.clientX, initW: s_.logoWidth };

    const onMove = (ev: MouseEvent) => {
      if (!logoResizeRef.current) return;
      const dx = ev.clientX - logoResizeRef.current.startX;
      setS(prev => ({ ...prev, logoWidth: Math.max(30, Math.min(180, logoResizeRef.current!.initW + p(dx))) }));
    };
    const onUp = () => {
      logoResizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [s_.logoWidth]);

  // ── Column resize ───────────────────────────────────────────────────────────
  type ColKey = 'colNum' | 'colSession' | 'colScore' | 'colStatus' | 'colAttempts';
  const COL_PAIRS: [ColKey, ColKey][] = [
    ['colNum', 'colSession'], ['colSession', 'colScore'],
    ['colScore', 'colStatus'], ['colStatus', 'colAttempts'],
  ];

  const onColDividerDown = useCallback((leftCol: ColKey, rightCol: ColKey) => (e: React.MouseEvent) => {
    e.preventDefault();
    colDragRef.current = {
      col: leftCol, startX: e.clientX,
      initW: s_[leftCol] as number,
      nextCol: rightCol, initNext: s_[rightCol] as number,
    };
    const onMove = (ev: MouseEvent) => {
      if (!colDragRef.current) return;
      const dx = p(ev.clientX - colDragRef.current.startX);
      setS(prev => {
        const newLeft  = Math.max(20, colDragRef.current!.initW   + dx);
        const newRight = Math.max(20, colDragRef.current!.initNext - dx);
        return { ...prev, [colDragRef.current!.col]: newLeft, [colDragRef.current!.nextCol]: newRight };
      });
    };
    const onUp = () => {
      colDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [s_]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const tableW = PDF_W - s_.marginLeft - s_.marginRight;
  const colWidths = [s_.colNum, s_.colSession, s_.colScore, s_.colStatus, s_.colAttempts];
  const colTotal  = colWidths.reduce((a, b) => a + b, 0);
  const colPct    = colWidths.map(w => (w / colTotal) * 100);
  const infoRightW = (PDF_W - s_.marginLeft - s_.marginRight) - s_.infoColLeft;

  // ── Info rows ───────────────────────────────────────────────────────────────
  const INFO_ROWS = [
    ['Student Name',     'Ahmed Al-Rashidi'],
    ['Registration ID',  'FMP-2024-001'],
    ['Email Address',    'ahmed@example.com'],
    ['Course',           '3-Statement Financial Modeling (3SFM)'],
    ['Enrollment Date',  '1 January 2024'],
    ['Issue Date',       '1 April 2026'],
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  if (status === 'loading' || status === 'unauthenticated') return null;

  const headerH = 110; // PDF pts

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', background: '#fff', borderBottom: '1px solid #E8F0FB', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 800, color: '#1B3A6B', margin: 0 }}>Transcript Editor</h1>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0 }}>Click text on the preview to edit · Drag logo · Drag column dividers to resize</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={resetDefaults} style={{ padding: '7px 14px', background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Reset
          </button>
          <a href="/api/training/transcript?regId=FMP-2024-001&email=ahmed@example.com&course=3sfm" target="_blank" rel="noopener noreferrer"
            style={{ padding: '7px 14px', background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }}>
            ↓ PDF Preview
          </a>
          <button onClick={saveAll} disabled={saving}
            style={{ padding: '7px 20px', background: saving ? '#86EFAC' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save All'}
          </button>
        </div>

        {/* Editor body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── Left panel ─────────────────────────────────────────────────── */}
          <div style={{ width: 300, background: '#fff', borderRight: '1px solid #E8F0FB', overflowY: 'auto', flexShrink: 0 }}>

            {/* LOGO */}
            <Section title="Logo" open={open.logo} onToggle={() => tog('logo')}>
              <Row label="Upload">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    style={{ flex: 1, padding: '6px 10px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    {uploading ? 'Uploading…' : '↑ Upload Logo'}
                  </button>
                  {s_.logoUrl && (
                    <button onClick={() => upd({ logoUrl: '' })}
                      style={{ padding: '6px 10px', background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Remove
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
              </Row>
              {s_.logoUrl && (
                <>
                  <Row label={`Width: ${Math.round(s_.logoWidth)}pt`}>
                    <Slider value={s_.logoWidth} min={30} max={180} onChange={v => upd({ logoWidth: v })} />
                  </Row>
                  <Row label="Position presets">
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[
                        { label: 'Left',   x: s_.marginLeft },
                        { label: 'Center', x: (PDF_W - s_.logoWidth) / 2 },
                        { label: 'Right',  x: PDF_W - s_.marginRight - s_.logoWidth },
                      ].map(({ label, x }) => (
                        <button key={label} onClick={() => upd({ logoX: x })}
                          style={{ flex: 1, padding: '5px 6px', fontSize: 10, fontWeight: 700, background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </Row>
                </>
              )}
            </Section>

            {/* TYPOGRAPHY */}
            <Section title="Typography" open={open.typography} onToggle={() => tog('typography')}>
              <Row label={`Header title: ${s_.fontSizeHeader}pt`}>
                <Slider value={s_.fontSizeHeader} min={10} max={24} onChange={v => upd({ fontSizeHeader: v })} />
              </Row>
              <Row label={`Subtitle: ${s_.fontSizeSubtitle}pt`}>
                <Slider value={s_.fontSizeSubtitle} min={6} max={16} onChange={v => upd({ fontSizeSubtitle: v })} />
              </Row>
              <Row label={`Body text: ${s_.fontSizeBody}pt`}>
                <Slider value={s_.fontSizeBody} min={6} max={14} onChange={v => upd({ fontSizeBody: v })} />
              </Row>
              <Row label={`Table text: ${s_.fontSizeTable}pt`}>
                <Slider value={s_.fontSizeTable} min={5} max={12} onChange={v => upd({ fontSizeTable: v })} />
              </Row>
              <Row label={`Footer text: ${s_.footerFontSize}pt`}>
                <Slider value={s_.footerFontSize} min={5} max={12} onChange={v => upd({ footerFontSize: v })} />
              </Row>
            </Section>

            {/* COLORS */}
            <Section title="Colors" open={open.colors} onToggle={() => tog('colors')}>
              <Row label="Header background"><ColorPicker value={s_.headerBgColor}    onChange={v => upd({ headerBgColor: v })} /></Row>
              <Row label="Header text">      <ColorPicker value={s_.headerTextColor}  onChange={v => upd({ headerTextColor: v })} /></Row>
              <Row label="Table header">     <ColorPicker value={s_.tableHeaderColor} onChange={v => upd({ tableHeaderColor: v })} /></Row>
              <Row label="Passed badge">     <ColorPicker value={s_.passedColor}      onChange={v => upd({ passedColor: v })} /></Row>
              <Row label="Failed badge">     <ColorPicker value={s_.failedColor}      onChange={v => upd({ failedColor: v })} /></Row>
            </Section>

            {/* PAGE & MARGINS */}
            <Section title="Page & Margins" open={open.page} onToggle={() => tog('page')}>
              <Row label="Page size">
                <div style={{ display: 'flex', gap: 6 }}>
                  {['A4', 'Letter'].map(sz => (
                    <button key={sz} onClick={() => upd({ pageSize: sz })}
                      style={{ flex: 1, padding: '5px', fontSize: 11, fontWeight: 700, background: s_.pageSize === sz ? '#1B4F8A' : '#F3F4F6', color: s_.pageSize === sz ? '#fff' : '#374151', border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer' }}>
                      {sz}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label={`Margin top: ${Math.round(s_.marginTop)}pt`}>
                <Slider value={s_.marginTop} min={10} max={60} step={1} onChange={v => upd({ marginTop: v })} />
              </Row>
              <Row label={`Margin bottom: ${Math.round(s_.marginBottom)}pt`}>
                <Slider value={s_.marginBottom} min={10} max={60} step={1} onChange={v => upd({ marginBottom: v })} />
              </Row>
              <Row label={`Margin left: ${Math.round(s_.marginLeft)}pt`}>
                <Slider value={s_.marginLeft} min={10} max={80} step={1} onChange={v => upd({ marginLeft: v })} />
              </Row>
              <Row label={`Margin right: ${Math.round(s_.marginRight)}pt`}>
                <Slider value={s_.marginRight} min={10} max={80} step={1} onChange={v => upd({ marginRight: v })} />
              </Row>
              <Row label={`Table header row: ${Math.round(s_.rowHdrH)}pt`}>
                <Slider value={s_.rowHdrH} min={14} max={36} step={1} onChange={v => upd({ rowHdrH: v })} />
              </Row>
              <Row label={`Table data row: ${Math.round(s_.rowDataH)}pt`}>
                <Slider value={s_.rowDataH} min={12} max={30} step={1} onChange={v => upd({ rowDataH: v })} />
              </Row>
              <Row label={`Info row height: ${Math.round(s_.infoRowH)}pt`}>
                <Slider value={s_.infoRowH} min={12} max={28} step={1} onChange={v => upd({ infoRowH: v })} />
              </Row>
            </Section>

            {/* FOOTER */}
            <Section title="Footer" open={open.footer} onToggle={() => tog('footer')}>
              <Row label="Footer line 1"><TextInput value={s_.footer1} onChange={v => upd({ footer1: v })} /></Row>
              <Row label="Footer line 2"><TextInput value={s_.footer2} onChange={v => upd({ footer2: v })} /></Row>
            </Section>

          </div>

          {/* ── Right panel: canvas ─────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#E8EDEF', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 24px 48px' }}>

            {/* Scale indicator */}
            <div style={{ alignSelf: 'flex-start', marginBottom: 10, fontSize: 11, color: '#6B7280', fontWeight: 600 }}>
              {s_.pageSize} Preview — {Math.round(SCALE * 100)}% scale · Click text to edit · Drag logo · Drag column dividers
            </div>

            {/* Canvas */}
            <div
              ref={canvasRef}
              onClick={() => { setSelEl(null); if (editF) setEditF(null); }}
              style={{ width: CW, minHeight: CH, background: '#fff', boxShadow: '0 4px 32px rgba(0,0,0,0.18)', position: 'relative', flexShrink: 0, userSelect: 'none' }}
            >
              {/* ── HEADER ─────────────────────────────────────────────────── */}
              <div style={{ background: s_.headerBgColor, padding: `${s(s_.marginTop)}px ${s(s_.marginRight)}px ${s(14)}px ${s(s_.marginLeft)}px`, position: 'relative', minHeight: s(headerH) }}>

                {/* Logo (draggable + resizable) */}
                {s_.logoUrl && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: s(s_.logoX), top: s(s_.logoY),
                      width: s(s_.logoWidth),
                      cursor: 'grab',
                      outline: selEl === 'logo' ? '2px solid #3B82F6' : 'none',
                      outlineOffset: 2,
                      zIndex: 10,
                    }}
                    onMouseDown={onLogoDragStart}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s_.logoUrl} alt="logo" style={{ width: '100%', height: 'auto', display: 'block', pointerEvents: 'none' }} />
                    {/* Resize handle */}
                    <div
                      onMouseDown={onLogoResizeStart}
                      style={{ position: 'absolute', bottom: -4, right: -4, width: 10, height: 10, background: '#3B82F6', borderRadius: 2, cursor: 'se-resize', zIndex: 11 }}
                    />
                  </div>
                )}

                {/* Header title — editable */}
                <div style={{ color: s_.headerTextColor, textAlign: 'center', fontSize: s(s_.fontSizeHeader), fontWeight: 800, letterSpacing: '0.06em', marginBottom: s(6) }}>
                  <EditableText
                    value={s_.headerTitle} onChange={v => upd({ headerTitle: v })}
                    editing={editF === 'headerTitle'} onStartEdit={() => setEditF('headerTitle')} onEndEdit={() => setEditF(null)}
                    style={{ color: s_.headerTextColor }} inputStyle={{ color: s_.headerTextColor }}
                  />
                </div>

                {/* Subtitle badge */}
                <div style={{ textAlign: 'center', marginBottom: s(8) }}>
                  <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: `${s(3)}px ${s(14)}px`, fontSize: s(s_.fontSizeSubtitle), color: s_.headerTextColor, letterSpacing: '0.05em' }}>
                    <EditableText
                      value={s_.subtitle} onChange={v => upd({ subtitle: v })}
                      editing={editF === 'subtitle'} onStartEdit={() => setEditF('subtitle')} onEndEdit={() => setEditF(null)}
                      style={{ color: s_.headerTextColor }} inputStyle={{ color: s_.headerTextColor }}
                    />
                  </div>
                </div>

                {/* Instructor */}
                <div style={{ textAlign: 'center', fontSize: s(s_.fontSizeBody - 0.5), color: `${s_.headerTextColor}CC`, marginBottom: s(4) }}>
                  <EditableText
                    value={s_.instructor} onChange={v => upd({ instructor: v })}
                    editing={editF === 'instructor'} onStartEdit={() => setEditF('instructor')} onEndEdit={() => setEditF(null)}
                    style={{ color: `${s_.headerTextColor}CC` }} inputStyle={{ color: s_.headerTextColor }}
                  />
                </div>

                {/* Website */}
                <div style={{ textAlign: 'center', fontSize: s(s_.fontSizeBody - 1), color: `${s_.headerTextColor}80` }}>
                  <EditableText
                    value={s_.websiteUrl} onChange={v => upd({ websiteUrl: v })}
                    editing={editF === 'websiteUrl'} onStartEdit={() => setEditF('websiteUrl')} onEndEdit={() => setEditF(null)}
                    style={{ color: `${s_.headerTextColor}80` }} inputStyle={{ color: s_.headerTextColor }}
                  />
                </div>
              </div>

              {/* ── STUDENT INFO TABLE ──────────────────────────────────────── */}
              <div style={{ background: '#EBF3FC', padding: `${s(10)}px ${s(s_.marginLeft)}px` }}>
                <div style={{ display: 'flex', fontSize: s(s_.fontSizeBody), color: '#111827', flexWrap: 'wrap', gap: `${s(2)}px 0` }}>
                  {INFO_ROWS.map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', width: '100%', minHeight: s(s_.infoRowH) }}>
                      <div style={{ width: s(s_.infoColLeft), fontWeight: 700, color: '#1B4F8A', flexShrink: 0, fontSize: s(s_.fontSizeBody - 0.5) }}>
                        {label}
                      </div>
                      <div style={{ flex: 1, color: '#374151' }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── STATUS BANNER ───────────────────────────────────────────── */}
              <div style={{ background: s_.passedColor, padding: `${s(5)}px ${s(s_.marginLeft)}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: s(s_.fontSizeBody), fontWeight: 700, color: '#fff' }}>Course Status</span>
                <span style={{ fontSize: s(s_.fontSizeBody), fontWeight: 800, color: '#fff', letterSpacing: '0.05em' }}>✓ COURSE COMPLETE</span>
              </div>

              {/* ── SESSIONS TABLE ──────────────────────────────────────────── */}
              <div style={{ padding: `${s(10)}px ${s(s_.marginLeft)}px ${s(8)}px` }}>
                <div style={{ fontSize: s(s_.fontSizeBody - 0.5), fontWeight: 700, color: '#1B3A6B', marginBottom: s(5), textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Session Results
                </div>

                {/* Table header with resizable columns */}
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', background: s_.tableHeaderColor, minHeight: s(s_.rowHdrH), alignItems: 'center', borderRadius: `${s(3)}px ${s(3)}px 0 0` }}>
                    {['#', 'Session Name', 'Score', 'Status', 'Attempts'].map((h, ci) => (
                      <div key={h} style={{ width: `${colPct[ci]}%`, padding: `0 ${s(4)}px`, fontSize: s(s_.fontSizeTable - 0.5), fontWeight: 700, color: '#fff', letterSpacing: '0.04em', textTransform: 'uppercase', position: 'relative', flexShrink: 0 }}>
                        {h}
                        {/* Column divider handle (except after last) */}
                        {ci < 4 && (
                          <div
                            onMouseDown={e => { e.stopPropagation(); onColDividerDown(COL_PAIRS[ci][0], COL_PAIRS[ci][1])(e); }}
                            style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', background: 'rgba(255,255,255,0.25)', zIndex: 5, borderRadius: 2 }}
                            title="Drag to resize column"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Table rows */}
                  {SAMPLE_SESSIONS.map((sess, ri) => (
                    <div key={ri} style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', background: ri % 2 === 0 ? '#fff' : '#F9FAFB', minHeight: s(s_.rowDataH), alignItems: 'center' }}>
                      <div style={{ width: `${colPct[0]}%`, padding: `0 ${s(4)}px`, fontSize: s(s_.fontSizeTable), color: '#374151', flexShrink: 0 }}>{ri + 1}</div>
                      <div style={{ width: `${colPct[1]}%`, padding: `0 ${s(4)}px`, fontSize: s(s_.fontSizeTable), color: '#111827', flexShrink: 0 }}>{sess.name}</div>
                      <div style={{ width: `${colPct[2]}%`, padding: `0 ${s(4)}px`, fontSize: s(s_.fontSizeTable), color: '#374151', flexShrink: 0 }}>{sess.score}%</div>
                      <div style={{ width: `${colPct[3]}%`, padding: `0 ${s(4)}px`, fontSize: s(s_.fontSizeTable - 0.5), flexShrink: 0 }}>
                        <span style={{ background: s_.passedColor + '22', color: s_.passedColor, fontWeight: 700, padding: `${s(1.5)}px ${s(5)}px`, borderRadius: s(10), fontSize: s(s_.fontSizeTable - 1) }}>
                          {sess.status}
                        </span>
                      </div>
                      <div style={{ width: `${colPct[4]}%`, padding: `0 ${s(4)}px`, fontSize: s(s_.fontSizeTable), color: '#374151', flexShrink: 0 }}>{sess.attempts}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── SUMMARY BOXES ───────────────────────────────────────────── */}
              <div style={{ display: 'flex', gap: s(10), padding: `${s(6)}px ${s(s_.marginLeft)}px` }}>
                {/* Academic summary */}
                <div style={{ flex: 1, background: '#F0F7FF', border: '1px solid #BFDBFE', borderRadius: s(6), padding: `${s(8)}px ${s(10)}px` }}>
                  <div style={{ fontSize: s(s_.fontSizeBody - 0.5), fontWeight: 700, color: '#1B4F8A', marginBottom: s(5), textTransform: 'uppercase', letterSpacing: '0.04em' }}>Academic Summary</div>
                  {[
                    ['Sessions Completed', `${SAMPLE_SESSIONS.length} / ${SAMPLE_SESSIONS.length}`],
                    ['Average Score', `${Math.round(SAMPLE_SESSIONS.reduce((a, b) => a + b.score, 0) / SAMPLE_SESSIONS.length)}%`],
                    ['Overall Result', 'PASSED'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: s(s_.fontSizeTable), marginBottom: s(3), color: '#374151' }}>
                      <span>{k}</span>
                      <span style={{ fontWeight: 700, color: k === 'Overall Result' ? s_.passedColor : '#111827' }}>{v}</span>
                    </div>
                  ))}
                </div>
                {/* Certification status */}
                <div style={{ flex: 1, background: '#F0FFF4', border: '1px solid #A7F3D0', borderRadius: s(6), padding: `${s(8)}px ${s(10)}px` }}>
                  <div style={{ fontSize: s(s_.fontSizeBody - 0.5), fontWeight: 700, color: '#1A7A30', marginBottom: s(5), textTransform: 'uppercase', letterSpacing: '0.04em' }}>Certification Status</div>
                  {[
                    ['Certificate', 'Issued'],
                    ['Issue Date', '1 April 2026'],
                    ['Verify At', 'certifier.io'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: s(s_.fontSizeTable), marginBottom: s(3), color: '#374151' }}>
                      <span>{k}</span>
                      <span style={{ fontWeight: 700, color: '#1A7A30' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── FOOTER ─────────────────────────────────────────────────── */}
              <div style={{ background: s_.headerBgColor, padding: `${s(10)}px ${s(s_.marginLeft)}px`, marginTop: s(6) }}>
                <div style={{ textAlign: 'center', fontSize: s(s_.footerFontSize), color: `${s_.headerTextColor}CC`, marginBottom: s(3) }}>
                  <EditableText
                    value={s_.footer1} onChange={v => upd({ footer1: v })}
                    editing={editF === 'footer1'} onStartEdit={() => setEditF('footer1')} onEndEdit={() => setEditF(null)}
                    style={{ color: `${s_.headerTextColor}CC` }} inputStyle={{ color: s_.headerTextColor }}
                  />
                </div>
                <div style={{ textAlign: 'center', fontSize: s(s_.footerFontSize - 0.5), color: `${s_.headerTextColor}80` }}>
                  <EditableText
                    value={s_.footer2} onChange={v => upd({ footer2: v })}
                    editing={editF === 'footer2'} onStartEdit={() => setEditF('footer2')} onEndEdit={() => setEditF(null)}
                    style={{ color: `${s_.headerTextColor}80` }} inputStyle={{ color: s_.headerTextColor }}
                  />
                </div>
                <div style={{ textAlign: 'center', fontSize: s(s_.footerFontSize - 1), color: `${s_.headerTextColor}55`, marginTop: s(6) }}>
                  {s_.websiteUrl} · Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>

            </div>{/* /canvas */}
          </div>{/* /right panel */}
        </div>{/* /editor body */}
      </div>{/* /main content */}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
