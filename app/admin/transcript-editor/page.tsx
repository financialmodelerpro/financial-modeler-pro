'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Scale: A4 preview at 72% ─────────────────────────────────────────────────
const SCALE = 0.72;
const PW = Math.round(595 * SCALE); // 428px
function px(pt: number) { return Math.round(pt * SCALE); }

// ── Sample data ───────────────────────────────────────────────────────────────
const TODAY = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const SAMPLE = {
  name: 'Ahmed Al-Rashidi', id: 'FMP-2024-001', email: 'ahmed@example.com',
  course: 'Building a 3-Statement Financial Model', courseShort: '3SFM',
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
  certId: 'CERT-2024-FMP-001', certIssued: '20 March 2024',
};

// ── Settings ──────────────────────────────────────────────────────────────────
interface Settings {
  // Header
  brandName:          string;
  headerTitle:        string;
  subtitle:           string;
  instructor:         string;
  websiteUrl:         string;
  // Logo
  logoUrl:            string;
  logoWidth:          number;
  logoPosition:       'left' | 'center' | 'right' | 'none';
  // Colors
  headerBgColor:      string;
  tableHeaderColor:   string;
  studentStripBg:     string;
  passedBg:           string;
  passedColor:        string;
  failedBg:           string;
  failedColor:        string;
  // Column headers
  colNum:             string;
  colSession:         string;
  colScore:           string;
  colStatus:          string;
  colAttempts:        string;
  // Banners
  bannerCompleteTitle: string;
  bannerCompleteSub:   string;
  bannerProgressTitle: string;
  bannerProgressSub:   string;
  // Footer
  footer1:            string;
  footer2:            string;
}

const DEFAULTS: Settings = {
  brandName:          'Financial Modeler Pro',
  headerTitle:        'OFFICIAL ACADEMIC TRANSCRIPT',
  subtitle:           'FMP Training Hub',
  instructor:         'Ahmad Din | Corporate Finance Expert',
  websiteUrl:         'www.financialmodelerpro.com',
  logoUrl:            '',
  logoWidth:          32,
  logoPosition:       'right',
  headerBgColor:      '#0D2E5A',
  tableHeaderColor:   '#1B4F8A',
  studentStripBg:     '#EBF3FC',
  passedBg:           '#D1FAE5',
  passedColor:        '#065F46',
  failedBg:           '#FEE2E2',
  failedColor:        '#991B1B',
  colNum:             '#',
  colSession:         'Session Name',
  colScore:           'Score',
  colStatus:          'Status',
  colAttempts:        'Attempts',
  bannerCompleteTitle: '✓ OFFICIAL TRANSCRIPT — Course Complete',
  bannerCompleteSub:   'All requirements fulfilled. Certificate issued as of [date].',
  bannerProgressTitle: '⏳ PROGRESS TRANSCRIPT — Course in Progress',
  bannerProgressSub:   'This transcript reflects current progress as of [date]. A final transcript will be issued upon course completion.',
  footer1:            'This transcript is an official record issued by Financial Modeler Pro.',
  footer2:            'Verify certificate authenticity at certifier.io',
};

const CMS_KEYS: Record<keyof Settings, string> = {
  brandName:          'transcript_brand_name',
  headerTitle:        'transcript_header_title',
  subtitle:           'transcript_subtitle',
  instructor:         'transcript_instructor',
  websiteUrl:         'transcript_website_url',
  logoUrl:            'transcript_logo_url',
  logoWidth:          'transcript_logo_width',
  logoPosition:       'transcript_logo_position',
  headerBgColor:      'transcript_header_bg_color',
  tableHeaderColor:   'transcript_table_header_color',
  studentStripBg:     'transcript_student_strip_bg',
  passedBg:           'transcript_passed_bg',
  passedColor:        'transcript_passed_color',
  failedBg:           'transcript_failed_bg',
  failedColor:        'transcript_failed_color',
  colNum:             'transcript_col_num',
  colSession:         'transcript_col_session',
  colScore:           'transcript_col_score',
  colStatus:          'transcript_col_status',
  colAttempts:        'transcript_col_attempts',
  bannerCompleteTitle: 'transcript_banner_complete_title',
  bannerCompleteSub:   'transcript_banner_complete_sub',
  bannerProgressTitle: 'transcript_banner_progress_title',
  bannerProgressSub:   'transcript_banner_progress_sub',
  footer1:            'transcript_footer_1',
  footer2:            'transcript_footer_2',
};

// ── Preview ───────────────────────────────────────────────────────────────────
function TranscriptPreview({ cfg }: { cfg: Settings }) {
  const hBg  = cfg.headerBgColor;
  const thBg = cfg.tableHeaderColor;

  return (
    <div style={{ width: PW, background: '#fff', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: px(9), color: '#111827', paddingBottom: px(36) }}>

      {/* Header */}
      <div style={{ background: hBg, padding: `${px(14)}px ${px(36)}px ${px(12)}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          {cfg.logoUrl && cfg.logoPosition === 'center' && (
            <div style={{ textAlign: 'center', marginBottom: px(5) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cfg.logoUrl} alt="Logo" style={{ width: px(cfg.logoWidth), height: px(cfg.logoWidth), objectFit: 'contain' }} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: px(2) }}>
            {cfg.logoUrl && cfg.logoPosition === 'left' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cfg.logoUrl} alt="Logo" style={{ width: px(cfg.logoWidth), height: px(cfg.logoWidth), marginRight: px(8), objectFit: 'contain' }} />
            )}
            <span style={{ fontSize: px(11), fontWeight: 800, color: '#fff' }}>{cfg.brandName}</span>
          </div>
          <div style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)', marginBottom: px(1) }}>{cfg.websiteUrl}</div>
          <div style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)', marginBottom: px(6) }}>{cfg.instructor}</div>
          <div style={{ fontSize: px(9), fontWeight: 800, color: '#90CAF9', letterSpacing: '1.2px' }}>{cfg.headerTitle}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {cfg.logoUrl && cfg.logoPosition === 'right' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cfg.logoUrl} alt="Logo" style={{ width: px(cfg.logoWidth), height: px(cfg.logoWidth), marginBottom: px(5), objectFit: 'contain' }} />
          )}
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: px(4), padding: `${px(4)}px ${px(8)}px` }}>
            <span style={{ fontSize: px(7.5), fontWeight: 800, color: 'rgba(255,255,255,0.8)' }}>{cfg.subtitle}</span>
          </div>
        </div>
      </div>

      {/* Student Info Strip */}
      <div style={{ background: cfg.studentStripBg, padding: `${px(10)}px ${px(36)}px`, display: 'flex', gap: px(12) }}>
        <div style={{ flex: 1 }}>
          {[['Student Name', SAMPLE.name, true], ['Registration ID', SAMPLE.id, false], ['Email', SAMPLE.email, false]].map(([l, v, b]) => (
            <div key={String(l)} style={{ display: 'flex', marginBottom: px(3) }}>
              <span style={{ fontSize: px(8), fontWeight: 800, color: '#1B4F8A', width: px(100), flexShrink: 0 }}>{l}</span>
              <span style={{ fontSize: px(8.5), color: '#111827', fontWeight: b ? 800 : 400 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {[['Course', SAMPLE.courseShort, true], ['Enrollment Date', SAMPLE.enrolled, false], ['Issue Date', TODAY, false]].map(([l, v, b]) => (
            <div key={String(l)} style={{ display: 'flex', marginBottom: px(3) }}>
              <span style={{ fontSize: px(8), fontWeight: 800, color: '#1B4F8A', width: px(100), flexShrink: 0 }}>{l}</span>
              <span style={{ fontSize: px(8.5), color: '#111827', fontWeight: b ? 800 : 400 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status Banner */}
      <div style={{ background: '#F0FFF4', padding: `${px(6)}px ${px(36)}px`, borderTop: '1px solid #BBF7D0', borderBottom: '1px solid #BBF7D0' }}>
        <div style={{ fontSize: px(9), fontWeight: 800, color: '#166534' }}>{cfg.bannerCompleteTitle}</div>
        <div style={{ fontSize: px(8), color: '#166534', marginTop: px(2) }}>{cfg.bannerCompleteSub.replace('[date]', TODAY)}</div>
      </div>

      {/* Section Header */}
      <div style={{ padding: `${px(12)}px ${px(36)}px ${px(5)}px`, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: px(10), fontWeight: 800, color: '#0D2E5A', marginRight: px(8), whiteSpace: 'nowrap' }}>{SAMPLE.course}</span>
        <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
      </div>

      {/* Session Table */}
      <div style={{ padding: `0 ${px(36)}px` }}>
        <div style={{ display: 'flex', background: thBg, padding: `${px(5)}px 0`, borderRadius: px(4) }}>
          {[cfg.colNum, cfg.colSession, cfg.colScore, cfg.colStatus, cfg.colAttempts].map((label, i) => (
            <div key={i} style={{ ...(i === 0 ? { width: px(28), paddingLeft: px(6) } : i === 1 ? { flex: 1, paddingLeft: px(6) } : i === 2 ? { width: px(46), textAlign: 'center' as const } : i === 3 ? { width: px(76), paddingLeft: px(4) } : { width: px(52), textAlign: 'center' as const }) }}>
              <span style={{ fontSize: px(8), fontWeight: 800, color: '#fff' }}>{label}</span>
            </div>
          ))}
        </div>
        {SAMPLE.sessions.map((sess, idx) => (
          <div key={sess.num} style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', padding: `${px(4)}px 0`, background: idx % 2 === 1 ? '#F9FAFB' : '#fff' }}>
            <div style={{ width: px(28), paddingLeft: px(6) }}><span style={{ fontSize: px(8), color: '#6B7280' }}>{sess.num}</span></div>
            <div style={{ flex: 1, paddingLeft: px(6) }}><span style={{ fontSize: px(8.5), color: '#111827' }}>{sess.name}</span></div>
            <div style={{ width: px(46), textAlign: 'center' }}><span style={{ fontSize: px(8.5), fontWeight: 800 }}>{sess.score}</span></div>
            <div style={{ width: px(76), paddingLeft: px(4) }}>
              <span style={{ background: cfg.passedBg, borderRadius: px(3), padding: `${px(2)}px ${px(5)}px`, fontSize: px(7.5), fontWeight: 800, color: cfg.passedColor }}>PASSED</span>
            </div>
            <div style={{ width: px(52), textAlign: 'center' }}><span style={{ fontSize: px(8.5) }}>{sess.attempts}</span></div>
          </div>
        ))}
        {/* Final row */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', padding: `${px(4)}px 0`, background: '#FDF3DC' }}>
          <div style={{ width: px(28), paddingLeft: px(6) }}><span style={{ fontSize: px(7.5), fontWeight: 800, color: '#C9A84C' }}>FINAL</span></div>
          <div style={{ flex: 1, paddingLeft: px(6) }}>
            <div style={{ fontSize: px(8.5), fontWeight: 800 }}>Final Comprehensive Exam</div>
            <div style={{ fontSize: px(7), color: '#6B7280', marginTop: px(2) }}>50 questions · Pass mark 70%</div>
          </div>
          <div style={{ width: px(46), textAlign: 'center' }}><span style={{ fontSize: px(8.5), fontWeight: 800 }}>{SAMPLE.final.score}</span></div>
          <div style={{ width: px(76), paddingLeft: px(4) }}>
            <span style={{ background: cfg.passedBg, borderRadius: px(3), padding: `${px(2)}px ${px(5)}px`, fontSize: px(7.5), fontWeight: 800, color: cfg.passedColor }}>PASSED</span>
          </div>
          <div style={{ width: px(52), textAlign: 'center' }}><span style={{ fontSize: px(8.5) }}>{SAMPLE.final.attempts}</span></div>
        </div>
        {/* Failed badge preview row */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', padding: `${px(4)}px 0`, background: '#fff' }}>
          <div style={{ width: px(28), paddingLeft: px(6) }}><span style={{ fontSize: px(8), color: '#6B7280' }}>—</span></div>
          <div style={{ flex: 1, paddingLeft: px(6) }}><span style={{ fontSize: px(8), color: '#9CA3AF', fontStyle: 'italic' }}>Failed attempt preview</span></div>
          <div style={{ width: px(46), textAlign: 'center' }}><span style={{ fontSize: px(8.5), fontWeight: 800 }}>55%</span></div>
          <div style={{ width: px(76), paddingLeft: px(4) }}>
            <span style={{ background: cfg.failedBg, borderRadius: px(3), padding: `${px(2)}px ${px(5)}px`, fontSize: px(7.5), fontWeight: 800, color: cfg.failedColor }}>FAILED</span>
          </div>
          <div style={{ width: px(52), textAlign: 'center' }}><span style={{ fontSize: px(8.5) }}>3 / 3</span></div>
        </div>
      </div>

      {/* Summary Boxes */}
      <div style={{ display: 'flex', gap: px(12), padding: `${px(10)}px ${px(36)}px`, paddingBottom: px(10) }}>
        <div style={{ flex: 1, border: '1.5px solid #1B4F8A', borderRadius: px(6), padding: px(10) }}>
          <div style={{ fontSize: px(8.5), fontWeight: 800, color: '#0D2E5A', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: px(10) }}>Academic Summary — {SAMPLE.courseShort}</div>
          {[['Sessions Completed','6 of 6'],['Sessions Passed','6 of 6'],['Average Score','88%'],['Final Exam Score','89%']].map(([l,v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: px(4) }}>
              <span style={{ fontSize: px(8), color: '#6B7280' }}>{l}</span>
              <span style={{ fontSize: px(8), fontWeight: 800, color: '#111827' }}>{v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', paddingTop: px(6), marginTop: px(4) }}>
            <span style={{ fontSize: px(8), color: '#6B7280' }}>Overall Result</span>
            <span style={{ fontSize: px(8), fontWeight: 800, color: cfg.passedColor }}>PASSED</span>
          </div>
        </div>
        <div style={{ flex: 1, border: '1.5px solid #2EAA4A', borderRadius: px(6), padding: px(10) }}>
          <div style={{ fontSize: px(8.5), fontWeight: 800, color: '#0D2E5A', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: px(10) }}>Certification Status</div>
          {[['Status','CERTIFIED','#2EAA4A'],['Certificate ID',SAMPLE.certId,'#111827'],['Issued',SAMPLE.certIssued,'#111827']].map(([l,v,c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: px(4) }}>
              <span style={{ fontSize: px(8), color: '#6B7280' }}>{l}</span>
              <span style={{ fontSize: px(8), fontWeight: 800, color: c }}>{v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: px(8), color: '#6B7280' }}>Verify at</span>
            <span style={{ fontSize: px(8), color: '#1B4F8A' }}>certifier.io/verify →</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: hBg, padding: `${px(7)}px ${px(36)}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)' }}>Issue Date: {TODAY}</span>
        <span style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)', textAlign: 'center', flex: 1, margin: `0 ${px(8)}px` }}>{cfg.footer1} {cfg.footer2}</span>
        <span style={{ fontSize: px(7), color: 'rgba(255,255,255,0.55)' }}>{cfg.websiteUrl}</span>
      </div>

    </div>
  );
}

// ── Reusable left-panel field components ─────────────────────────────────────
const iStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', color: '#111827', outline: 'none', boxSizing: 'border-box' };
const lStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 };
const fw: React.CSSProperties = { marginBottom: 14 };

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div style={fw}>
      <label style={lStyle}>{label}</label>
      {multiline
        ? <textarea style={{ ...iStyle, resize: 'vertical', minHeight: 52 }} value={value} onChange={e => onChange(e.target.value)} />
        : <input style={iStyle} value={value} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={fw}>
      <label style={lStyle}>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 40, height: 32, border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', padding: 2, flexShrink: 0 }} />
        <input style={{ ...iStyle, flex: 1 }} value={value} onChange={e => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <>
      <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '6px 0 16px' }} />
      <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>{label}</div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TranscriptEditorPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [cfg, setCfg]         = useState<Settings>(DEFAULTS);
  const [saving, setSaving]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast]     = useState('');

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
          (Object.keys(CMS_KEYS) as (keyof Settings)[]).forEach(k => {
            const raw = map[CMS_KEYS[k]];
            if (!raw) return;
            if (k === 'logoWidth') {
              const n = parseInt(raw, 10);
              if (Number.isFinite(n) && n > 0) (next as Record<string, unknown>)[k] = n;
            } else if (k === 'logoPosition') {
              if (['left','center','right','none'].includes(raw)) (next as Record<string, unknown>)[k] = raw;
            } else {
              (next as Record<string, unknown>)[k] = raw;
            }
          });
          return next;
        });
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true); setToast('');
    try {
      await Promise.all(
        (Object.keys(cfg) as (keyof Settings)[]).map(k =>
          fetch('/api/admin/content', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section: 'transcript', key: CMS_KEYS[k], value: String(cfg[k]) }),
          })
        )
      );
      showToast('Saved successfully.');
    } catch {
      showToast('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bucket', 'cms-assets');
      const res  = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.url) set('logoUrl', json.url);
      else showToast(json.error ?? 'Upload failed.');
    } catch {
      showToast('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function set<K extends keyof Settings>(key: K, val: Settings[K]) {
    setCfg(p => ({ ...p, [key]: val }));
  }

  if (status === 'loading' || !session) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#6B7280' }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F3F4F6' }}>
      <CmsAdminNav active="/admin/transcript-editor" />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 }}>Transcript Editor</h1>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>All fields editable. Preview reflects the actual PDF transcript.</p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {toast && <span style={{ fontSize: 12, color: toast.includes('fail') || toast.includes('Failed') ? '#DC2626' : '#2EAA4A', fontWeight: 600 }}>{toast}</span>}
            <button onClick={() => setCfg(DEFAULTS)} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#374151' }}>Reset Defaults</button>
            <a href="/api/training/transcript?regId=FMP-2024-001&email=demo%40example.com" target="_blank" rel="noopener noreferrer"
              style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #1B4F8A', background: '#EFF6FF', fontSize: 13, color: '#1B4F8A', textDecoration: 'none' }}>PDF Preview ↗</a>
            <button onClick={save} disabled={saving}
              style={{ padding: '7px 18px', borderRadius: 7, background: saving ? '#9CA3AF' : '#0D2E5A', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Left panel ── */}
          <div style={{ width: 320, background: '#fff', borderRight: '1px solid #E5E7EB', overflowY: 'auto', padding: '20px' }}>

            <div style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Header</div>
            <Field label="Brand / Company Name" value={cfg.brandName} onChange={v => set('brandName', v)} />
            <Field label="Document Title" value={cfg.headerTitle} onChange={v => set('headerTitle', v)} />
            <Field label="Subtitle (badge text)" value={cfg.subtitle} onChange={v => set('subtitle', v)} />
            <Field label="Instructor / Issuer Line" value={cfg.instructor} onChange={v => set('instructor', v)} />
            <Field label="Website URL" value={cfg.websiteUrl} onChange={v => set('websiteUrl', v)} />

            <SectionDivider label="Logo" />
            <div style={fw}>
              <label style={lStyle}>Logo Image</label>
              {cfg.logoUrl && (
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cfg.logoUrl} alt="Logo" style={{ height: 40, objectFit: 'contain', border: '1px solid #E5E7EB', borderRadius: 4, padding: 4, background: '#F9FAFB' }} />
                  <button onClick={() => set('logoUrl', '')} style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', fontSize: 11, cursor: 'pointer', color: '#DC2626' }}>Remove</button>
                </div>
              )}
              <label style={{ display: 'block', padding: '7px 10px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', fontSize: 12, cursor: 'pointer', textAlign: 'center', color: '#374151', marginBottom: 6 }}>
                {uploading ? 'Uploading…' : '↑ Upload Logo'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]); }} disabled={uploading} />
              </label>
              <input style={iStyle} placeholder="or paste image URL…" value={cfg.logoUrl} onChange={e => set('logoUrl', e.target.value)} />
            </div>
            <div style={fw}>
              <label style={lStyle}>Logo Width: {cfg.logoWidth} pt</label>
              <input type="range" min={16} max={96} value={cfg.logoWidth} onChange={e => set('logoWidth', parseInt(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={fw}>
              <label style={lStyle}>Logo Position</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['left','center','right','none'] as const).map(pos => (
                  <button key={pos} onClick={() => set('logoPosition', pos)}
                    style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: `1px solid ${cfg.logoPosition === pos ? '#0D2E5A' : '#D1D5DB'}`, background: cfg.logoPosition === pos ? '#0D2E5A' : '#fff', color: cfg.logoPosition === pos ? '#fff' : '#374151', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <SectionDivider label="Colors" />
            <ColorField label="Header / Footer Background" value={cfg.headerBgColor} onChange={v => set('headerBgColor', v)} />
            <ColorField label="Table Header Color" value={cfg.tableHeaderColor} onChange={v => set('tableHeaderColor', v)} />
            <ColorField label="Student Info Strip Background" value={cfg.studentStripBg} onChange={v => set('studentStripBg', v)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <ColorField label="Passed Badge Background" value={cfg.passedBg} onChange={v => set('passedBg', v)} />
              <ColorField label="Passed Badge Text" value={cfg.passedColor} onChange={v => set('passedColor', v)} />
              <ColorField label="Failed Badge Background" value={cfg.failedBg} onChange={v => set('failedBg', v)} />
              <ColorField label="Failed Badge Text" value={cfg.failedColor} onChange={v => set('failedColor', v)} />
            </div>

            <SectionDivider label="Table Column Headers" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="# Column" value={cfg.colNum} onChange={v => set('colNum', v)} />
              <Field label="Session Column" value={cfg.colSession} onChange={v => set('colSession', v)} />
              <Field label="Score Column" value={cfg.colScore} onChange={v => set('colScore', v)} />
              <Field label="Status Column" value={cfg.colStatus} onChange={v => set('colStatus', v)} />
              <Field label="Attempts Column" value={cfg.colAttempts} onChange={v => set('colAttempts', v)} />
            </div>

            <SectionDivider label="Status Banners" />
            <Field label="Complete — Title" value={cfg.bannerCompleteTitle} onChange={v => set('bannerCompleteTitle', v)} />
            <Field label="Complete — Subtitle (use [date] for today's date)" value={cfg.bannerCompleteSub} onChange={v => set('bannerCompleteSub', v)} multiline />
            <Field label="In Progress — Title" value={cfg.bannerProgressTitle} onChange={v => set('bannerProgressTitle', v)} />
            <Field label="In Progress — Subtitle (use [date] for today's date)" value={cfg.bannerProgressSub} onChange={v => set('bannerProgressSub', v)} multiline />

            <SectionDivider label="Footer" />
            <Field label="Footer Line 1" value={cfg.footer1} onChange={v => set('footer1', v)} multiline />
            <Field label="Footer Line 2" value={cfg.footer2} onChange={v => set('footer2', v)} />

          </div>

          {/* ── Right: Live Preview ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#E5E7EB', display: 'flex', justifyContent: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, textAlign: 'center', marginBottom: 10 }}>
                Live Preview — sample data · {Math.round(SCALE * 100)}% scale
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
