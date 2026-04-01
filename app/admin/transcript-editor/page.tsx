'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Scale: A4 preview at 72% ─────────────────────────────────────────────────
const PDF_W = 595;
const SCALE = 0.72;
const PW = Math.round(PDF_W * SCALE); // 428px preview width
function px(pt: number) { return Math.round(pt * SCALE); }

// ── Sample data ───────────────────────────────────────────────────────────────
const TODAY = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const SAMPLE = {
  name: 'Ahmed Al-Rashidi',
  id: 'FMP-2024-001',
  email: 'ahmed@example.com',
  course: 'Building a 3-Statement Financial Model',
  courseShort: '3SFM',
  enrolled: '15 January 2024',
  sessions: [
    { num: '1', name: 'Introduction to Financial Modeling',  score: '88%', attempts: '1 / 3' },
    { num: '2', name: 'Income Statement Modeling',           score: '92%', attempts: '1 / 3' },
    { num: '3', name: 'Balance Sheet Mechanics',             score: '85%', attempts: '2 / 3' },
    { num: '4', name: 'Cash Flow Statement',                 score: '90%', attempts: '1 / 3' },
    { num: '5', name: 'Three-Statement Integration',         score: '78%', attempts: '2 / 3' },
    { num: '6', name: 'Scenario Analysis & Sensitivity',     score: '95%', attempts: '1 / 3' },
  ],
  final: { score: '89%', attempts: '1 / 2' },
  certId: 'CERT-2024-FMP-001',
  certIssued: '20 March 2024',
};

// ── Settings ──────────────────────────────────────────────────────────────────
interface Settings {
  headerTitle:      string;
  subtitle:         string;
  instructor:       string;
  websiteUrl:       string;
  footer1:          string;
  footer2:          string;
  logoUrl:          string;
  logoWidth:        number;
  logoPosition:     'left' | 'center' | 'right' | 'none';
  headerBgColor:    string;
  tableHeaderColor: string;
}

const DEFAULTS: Settings = {
  headerTitle:      'OFFICIAL ACADEMIC TRANSCRIPT',
  subtitle:         'FMP Training Hub',
  instructor:       'Ahmad Din | Corporate Finance Expert',
  websiteUrl:       'www.financialmodelerpro.com',
  footer1:          'This transcript is an official record issued by Financial Modeler Pro.',
  footer2:          'Verify certificate authenticity at certifier.io',
  logoUrl:          '',
  logoWidth:        32,
  logoPosition:     'right',
  headerBgColor:    '#0D2E5A',
  tableHeaderColor: '#1B4F8A',
};

const CMS_KEYS: Record<keyof Settings, string> = {
  headerTitle:      'transcript_header_title',
  subtitle:         'transcript_subtitle',
  instructor:       'transcript_instructor',
  websiteUrl:       'transcript_website_url',
  footer1:          'transcript_footer_1',
  footer2:          'transcript_footer_2',
  logoUrl:          'transcript_logo_url',
  logoWidth:        'transcript_logo_width',
  logoPosition:     'transcript_logo_position',
  headerBgColor:    'transcript_header_bg_color',
  tableHeaderColor: 'transcript_table_header_color',
};

// ── Preview component ─────────────────────────────────────────────────────────
function TranscriptPreview({ cfg }: { cfg: Settings }) {
  const hBg = cfg.headerBgColor;
  const thBg = cfg.tableHeaderColor;

  return (
    <div style={{ width: PW, background: '#fff', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: px(9), color: '#111827', position: 'relative', paddingBottom: px(36) }}>

      {/* ── Header ── */}
      <div style={{ background: hBg, padding: `${px(14)}px ${px(36)}px ${px(12)}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          {/* Center logo stacked above brand */}
          {cfg.logoUrl && cfg.logoPosition === 'center' && (
            <div style={{ textAlign: 'center', marginBottom: px(5) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cfg.logoUrl} alt="Logo" style={{ width: px(cfg.logoWidth), height: px(cfg.logoWidth), objectFit: 'contain' }} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: px(2) }}>
            {cfg.logoUrl && cfg.logoPosition === 'left' && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={cfg.logoUrl} alt="Logo" style={{ width: px(cfg.logoWidth), height: px(cfg.logoWidth), marginRight: px(8), objectFit: 'contain' }} />
            )}
            <span style={{ fontSize: px(11), fontWeight: 800, color: '#fff' }}>Financial Modeler Pro</span>
          </div>
          <div style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)', marginBottom: px(1) }}>{cfg.websiteUrl}</div>
          <div style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)', marginBottom: px(6) }}>{cfg.instructor}</div>
          <div style={{ fontSize: px(9), fontWeight: 800, color: '#90CAF9', letterSpacing: '1.2px' }}>{cfg.headerTitle}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {cfg.logoUrl && cfg.logoPosition === 'right' && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={cfg.logoUrl} alt="Logo" style={{ width: px(cfg.logoWidth), height: px(cfg.logoWidth), marginBottom: px(5), objectFit: 'contain' }} />
          )}
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: px(4), padding: `${px(4)}px ${px(8)}px` }}>
            <span style={{ fontSize: px(7.5), fontWeight: 800, color: 'rgba(255,255,255,0.8)' }}>{cfg.subtitle}</span>
          </div>
        </div>
      </div>

      {/* ── Student Info Strip ── */}
      <div style={{ background: '#EBF3FC', padding: `${px(10)}px ${px(36)}px`, display: 'flex', gap: px(12) }}>
        <div style={{ flex: 1 }}>
          {[['Student Name', SAMPLE.name, true], ['Registration ID', SAMPLE.id, false], ['Email', SAMPLE.email, false]].map(([label, val, bold]) => (
            <div key={String(label)} style={{ display: 'flex', marginBottom: px(3) }}>
              <span style={{ fontSize: px(8), fontWeight: 800, color: '#1B4F8A', width: px(100), flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: px(8.5), color: '#111827', fontWeight: bold ? 800 : 400 }}>{val}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {[['Course', SAMPLE.courseShort, true], ['Enrollment Date', SAMPLE.enrolled, false], ['Issue Date', TODAY, false]].map(([label, val, bold]) => (
            <div key={String(label)} style={{ display: 'flex', marginBottom: px(3) }}>
              <span style={{ fontSize: px(8), fontWeight: 800, color: '#1B4F8A', width: px(100), flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: px(8.5), color: '#111827', fontWeight: bold ? 800 : 400 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Status Banner (Complete) ── */}
      <div style={{ background: '#F0FFF4', padding: `${px(6)}px ${px(36)}px`, borderTop: '1px solid #BBF7D0', borderBottom: '1px solid #BBF7D0' }}>
        <div style={{ fontSize: px(9), fontWeight: 800, color: '#166534' }}>✓ OFFICIAL TRANSCRIPT — Course Complete</div>
        <div style={{ fontSize: px(8), color: '#166534', marginTop: px(2) }}>All requirements fulfilled. Certificate issued as of {TODAY}.</div>
      </div>

      {/* ── Section Header ── */}
      <div style={{ padding: `${px(12)}px ${px(36)}px ${px(5)}px`, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: px(10), fontWeight: 800, color: '#0D2E5A', marginRight: px(8), whiteSpace: 'nowrap' }}>{SAMPLE.course}</span>
        <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
      </div>

      {/* ── Session Table ── */}
      <div style={{ padding: `0 ${px(36)}px` }}>
        {/* Table header row */}
        <div style={{ display: 'flex', background: thBg, padding: `${px(5)}px 0`, borderRadius: px(4) }}>
          <div style={{ width: px(28), paddingLeft: px(6) }}><span style={{ fontSize: px(8), fontWeight: 800, color: '#fff' }}>#</span></div>
          <div style={{ flex: 1, paddingLeft: px(6) }}><span style={{ fontSize: px(8), fontWeight: 800, color: '#fff' }}>Session Name</span></div>
          <div style={{ width: px(46), textAlign: 'center' }}><span style={{ fontSize: px(8), fontWeight: 800, color: '#fff' }}>Score</span></div>
          <div style={{ width: px(76), paddingLeft: px(4) }}><span style={{ fontSize: px(8), fontWeight: 800, color: '#fff' }}>Status</span></div>
          <div style={{ width: px(52), textAlign: 'center' }}><span style={{ fontSize: px(8), fontWeight: 800, color: '#fff' }}>Attempts</span></div>
        </div>
        {/* Regular sessions */}
        {SAMPLE.sessions.map((sess, idx) => (
          <div key={sess.num} style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', padding: `${px(4)}px 0`, background: idx % 2 === 1 ? '#F9FAFB' : '#fff' }}>
            <div style={{ width: px(28), paddingLeft: px(6) }}><span style={{ fontSize: px(8), color: '#6B7280' }}>{sess.num}</span></div>
            <div style={{ flex: 1, paddingLeft: px(6) }}><span style={{ fontSize: px(8.5), color: '#111827' }}>{sess.name}</span></div>
            <div style={{ width: px(46), textAlign: 'center' }}><span style={{ fontSize: px(8.5), fontWeight: 800, color: '#111827' }}>{sess.score}</span></div>
            <div style={{ width: px(76), paddingLeft: px(4) }}>
              <span style={{ background: '#D1FAE5', borderRadius: px(3), padding: `${px(2)}px ${px(5)}px`, fontSize: px(7.5), fontWeight: 800, color: '#065F46' }}>PASSED</span>
            </div>
            <div style={{ width: px(52), textAlign: 'center' }}><span style={{ fontSize: px(8.5), color: '#111827' }}>{sess.attempts}</span></div>
          </div>
        ))}
        {/* Final exam row */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', padding: `${px(4)}px 0`, background: '#FDF3DC' }}>
          <div style={{ width: px(28), paddingLeft: px(6) }}><span style={{ fontSize: px(7.5), fontWeight: 800, color: '#C9A84C' }}>FINAL</span></div>
          <div style={{ flex: 1, paddingLeft: px(6) }}>
            <div style={{ fontSize: px(8.5), fontWeight: 800, color: '#111827' }}>Final Comprehensive Exam</div>
            <div style={{ fontSize: px(7), color: '#6B7280', marginTop: px(2) }}>50 questions · Pass mark 70%</div>
          </div>
          <div style={{ width: px(46), textAlign: 'center' }}><span style={{ fontSize: px(8.5), fontWeight: 800, color: '#111827' }}>{SAMPLE.final.score}</span></div>
          <div style={{ width: px(76), paddingLeft: px(4) }}>
            <span style={{ background: '#D1FAE5', borderRadius: px(3), padding: `${px(2)}px ${px(5)}px`, fontSize: px(7.5), fontWeight: 800, color: '#065F46' }}>PASSED</span>
          </div>
          <div style={{ width: px(52), textAlign: 'center' }}><span style={{ fontSize: px(8.5), color: '#111827' }}>{SAMPLE.final.attempts}</span></div>
        </div>
      </div>

      {/* ── Summary Boxes ── */}
      <div style={{ display: 'flex', gap: px(12), padding: `${px(10)}px ${px(36)}px`, paddingBottom: px(50) }}>
        {/* Academic Summary */}
        <div style={{ flex: 1, border: '1.5px solid #1B4F8A', borderRadius: px(6), padding: px(10) }}>
          <div style={{ fontSize: px(8.5), fontWeight: 800, color: '#0D2E5A', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: px(10) }}>Academic Summary — {SAMPLE.courseShort}</div>
          {[['Sessions Completed', '6 of 6'], ['Sessions Passed', '6 of 6'], ['Average Score', '88%'], ['Final Exam Score', SAMPLE.final.score]].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: px(4) }}>
              <span style={{ fontSize: px(8), color: '#6B7280' }}>{l}</span>
              <span style={{ fontSize: px(8), fontWeight: 800, color: '#111827' }}>{v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', paddingTop: px(6), marginTop: px(4) }}>
            <span style={{ fontSize: px(8), color: '#6B7280' }}>Overall Result</span>
            <span style={{ fontSize: px(8), fontWeight: 800, color: '#2EAA4A' }}>PASSED</span>
          </div>
        </div>
        {/* Certification Status */}
        <div style={{ flex: 1, border: '1.5px solid #2EAA4A', borderRadius: px(6), padding: px(10) }}>
          <div style={{ fontSize: px(8.5), fontWeight: 800, color: '#0D2E5A', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: px(10) }}>Certification Status</div>
          {[['Status', 'CERTIFIED', '#2EAA4A'], ['Certificate ID', SAMPLE.certId, '#111827'], ['Issued', SAMPLE.certIssued, '#111827']].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: px(4) }}>
              <span style={{ fontSize: px(8), color: '#6B7280' }}>{l}</span>
              <span style={{ fontSize: px(8), fontWeight: 800, color: c }}>{v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 0 }}>
            <span style={{ fontSize: px(8), color: '#6B7280' }}>Verify at</span>
            <span style={{ fontSize: px(8), color: '#1B4F8A' }}>certifier.io/verify →</span>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ background: hBg, padding: `${px(7)}px ${px(36)}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)' }}>Issue Date: {TODAY}</span>
        <span style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)', textAlign: 'center', flex: 1, margin: `0 ${px(12)}px` }}>{cfg.footer1} {cfg.footer2}</span>
        <span style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)' }}>{cfg.websiteUrl}</span>
      </div>

    </div>
  );
}

// ── Shared input styles ───────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6,
  border: '1px solid #D1D5DB', background: '#F9FAFB', color: '#111827',
  outline: 'none', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4,
};
const fieldWrap: React.CSSProperties = { marginBottom: 14 };

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TranscriptEditorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [cfg, setCfg]       = useState<Settings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState('');
  const [uploading, setUploading] = useState(false);

  // Redirect if not admin
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/admin/login');
  }, [status, router]);

  // Load from Supabase
  useEffect(() => {
    fetch('/api/admin/content?section=transcript')
      .then(r => r.json())
      .then((data: { key: string; value: string }[]) => {
        if (!Array.isArray(data) || !data.length) return;
        const map: Record<string, string> = {};
        for (const row of data) map[row.key] = row.value;
        setCfg(prev => {
          const next = { ...prev };
          const rawW = parseInt(map[CMS_KEYS.logoWidth] ?? '', 10);
          const rawP = map[CMS_KEYS.logoPosition] ?? '';
          if (map[CMS_KEYS.headerTitle])      next.headerTitle      = map[CMS_KEYS.headerTitle];
          if (map[CMS_KEYS.subtitle])         next.subtitle         = map[CMS_KEYS.subtitle];
          if (map[CMS_KEYS.instructor])       next.instructor       = map[CMS_KEYS.instructor];
          if (map[CMS_KEYS.websiteUrl])       next.websiteUrl       = map[CMS_KEYS.websiteUrl];
          if (map[CMS_KEYS.footer1])          next.footer1          = map[CMS_KEYS.footer1];
          if (map[CMS_KEYS.footer2])          next.footer2          = map[CMS_KEYS.footer2];
          if (map[CMS_KEYS.logoUrl])          next.logoUrl          = map[CMS_KEYS.logoUrl];
          if (map[CMS_KEYS.headerBgColor])    next.headerBgColor    = map[CMS_KEYS.headerBgColor];
          if (map[CMS_KEYS.tableHeaderColor]) next.tableHeaderColor = map[CMS_KEYS.tableHeaderColor];
          if (Number.isFinite(rawW) && rawW > 0) next.logoWidth = rawW;
          if (['left','center','right','none'].includes(rawP)) next.logoPosition = rawP as Settings['logoPosition'];
          return next;
        });
      })
      .catch(() => {/* use defaults */});
  }, []);

  async function save() {
    setSaving(true);
    setToast('');
    try {
      const entries = (Object.keys(cfg) as (keyof Settings)[]).map(k => ({
        section: 'transcript',
        key: CMS_KEYS[k],
        value: String(cfg[k]),
      }));
      await Promise.all(entries.map(e =>
        fetch('/api/admin/content', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(e),
        })
      ));
      setToast('Saved successfully.');
    } catch {
      setToast('Save failed. Please try again.');
    } finally {
      setSaving(false);
      setTimeout(() => setToast(''), 3000);
    }
  }

  function reset() {
    setCfg(DEFAULTS);
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/media/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.url) setCfg(p => ({ ...p, logoUrl: json.url }));
      else setToast('Upload failed.');
    } catch {
      setToast('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function set<K extends keyof Settings>(key: K, val: Settings[K]) {
    setCfg(p => ({ ...p, [key]: val }));
  }

  if (status === 'loading' || !session) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F9FAFB', color: '#6B7280' }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F3F4F6' }}>
      <CmsAdminNav active="/admin/transcript-editor" />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 }}>Transcript Editor</h1>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>Edit branding and text. Preview reflects the actual PDF transcript.</p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {toast && <span style={{ fontSize: 12, color: toast.includes('fail') ? '#DC2626' : '#2EAA4A', fontWeight: 600 }}>{toast}</span>}
            <button onClick={reset} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#374151' }}>
              Reset Defaults
            </button>
            <a href="/api/training/transcript?regId=FMP-2024-001&email=demo%40example.com" target="_blank" rel="noopener noreferrer"
              style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #1B4F8A', background: '#EFF6FF', fontSize: 13, cursor: 'pointer', color: '#1B4F8A', textDecoration: 'none' }}>
              PDF Preview ↗
            </a>
            <button onClick={save} disabled={saving}
              style={{ padding: '7px 18px', borderRadius: 7, background: saving ? '#9CA3AF' : '#0D2E5A', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Two-panel body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Left: Settings panel ── */}
          <div style={{ width: 320, background: '#fff', borderRight: '1px solid #E5E7EB', overflowY: 'auto', padding: '20px 20px' }}>

            {/* Header / Branding */}
            <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Header</div>

            <div style={fieldWrap}>
              <label style={labelStyle}>Document Title</label>
              <input style={inputStyle} value={cfg.headerTitle} onChange={e => set('headerTitle', e.target.value)} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Subtitle (badge)</label>
              <input style={inputStyle} value={cfg.subtitle} onChange={e => set('subtitle', e.target.value)} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Instructor / Issuer Line</label>
              <input style={inputStyle} value={cfg.instructor} onChange={e => set('instructor', e.target.value)} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Website URL</label>
              <input style={inputStyle} value={cfg.websiteUrl} onChange={e => set('websiteUrl', e.target.value)} />
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '18px 0' }} />

            {/* Logo */}
            <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Logo</div>

            <div style={fieldWrap}>
              <label style={labelStyle}>Logo Image</label>
              {cfg.logoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={cfg.logoUrl} alt="Logo" style={{ height: 40, objectFit: 'contain', marginBottom: 8, display: 'block', border: '1px solid #E5E7EB', borderRadius: 4, padding: 4, background: '#F9FAFB' }} />
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <label style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', fontSize: 12, cursor: 'pointer', textAlign: 'center', color: '#374151' }}>
                  {uploading ? 'Uploading…' : 'Upload Logo'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]); }} />
                </label>
                {cfg.logoUrl && (
                  <button onClick={() => set('logoUrl', '')} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', fontSize: 12, cursor: 'pointer', color: '#DC2626' }}>
                    Remove
                  </button>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <input style={inputStyle} placeholder="or paste image URL…" value={cfg.logoUrl} onChange={e => set('logoUrl', e.target.value)} />
              </div>
            </div>

            <div style={fieldWrap}>
              <label style={labelStyle}>Logo Width (PDF points, 20–80)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="range" min={20} max={80} value={cfg.logoWidth} onChange={e => set('logoWidth', parseInt(e.target.value))} style={{ flex: 1 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#374151', width: 32, textAlign: 'right' }}>{cfg.logoWidth}</span>
              </div>
            </div>

            <div style={fieldWrap}>
              <label style={labelStyle}>Logo Position</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['left', 'center', 'right', 'none'] as const).map(pos => (
                  <button key={pos} onClick={() => set('logoPosition', pos)}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: `1px solid ${cfg.logoPosition === pos ? '#0D2E5A' : '#D1D5DB'}`, background: cfg.logoPosition === pos ? '#0D2E5A' : '#fff', color: cfg.logoPosition === pos ? '#fff' : '#374151', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '18px 0' }} />

            {/* Colors */}
            <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Colors</div>

            <div style={fieldWrap}>
              <label style={labelStyle}>Header / Footer Background</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={cfg.headerBgColor} onChange={e => set('headerBgColor', e.target.value)} style={{ width: 40, height: 32, border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                <input style={{ ...inputStyle, flex: 1 }} value={cfg.headerBgColor} onChange={e => set('headerBgColor', e.target.value)} />
              </div>
            </div>

            <div style={fieldWrap}>
              <label style={labelStyle}>Table Header Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={cfg.tableHeaderColor} onChange={e => set('tableHeaderColor', e.target.value)} style={{ width: 40, height: 32, border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                <input style={{ ...inputStyle, flex: 1 }} value={cfg.tableHeaderColor} onChange={e => set('tableHeaderColor', e.target.value)} />
              </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '18px 0' }} />

            {/* Footer */}
            <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Footer</div>

            <div style={fieldWrap}>
              <label style={labelStyle}>Footer Line 1</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 52 }} value={cfg.footer1} onChange={e => set('footer1', e.target.value)} />
            </div>
            <div style={fieldWrap}>
              <label style={labelStyle}>Footer Line 2</label>
              <input style={inputStyle} value={cfg.footer2} onChange={e => set('footer2', e.target.value)} />
            </div>

          </div>

          {/* ── Right: Live Preview ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#E5E7EB', display: 'flex', justifyContent: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textAlign: 'center', marginBottom: 10 }}>
                Live Preview — sample data shown · {Math.round(SCALE * 100)}% scale
              </div>
              <div style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.15)', borderRadius: 4, overflow: 'hidden' }}>
                <TranscriptPreview cfg={cfg} />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
