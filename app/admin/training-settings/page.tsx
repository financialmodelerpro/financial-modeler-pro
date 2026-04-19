'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { COURSES } from '@/src/config/courses';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13,
  border: '1px solid #D1D5DB', borderRadius: 6,
  fontFamily: 'Inter,sans-serif', outline: 'none',
  background: '#FFFBEB', boxSizing: 'border-box', color: '#1B3A6B',
};


interface LiveSessionRow {
  id: string;
  title: string;
  session_type: string;
  scheduled_datetime: string | null;
  is_published: boolean;
  has_assessment?: boolean | null;
}

type SessionKind = '3SFM' | 'BVM' | 'LIVE_UPCOMING' | 'LIVE_RECORDED' | 'LIVE_OTHER' | 'UNMAPPED';

interface SessionRow {
  tabKey: string;
  kind: SessionKind;
  courseLabel: string;     // left-column label
  sessionTitle: string;    // main title
  hasAssessment?: boolean;
  scheduledAt?: string | null;
  isPublished?: boolean;
  unmapped?: boolean;
}

export default function TrainingSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [url, setUrl]           = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [toast, setToast]       = useState('');

  // Watch enforcement settings
  const [enforceEnabled, setEnforceEnabled] = useState(true);
  const [enforceThreshold, setEnforceThreshold] = useState(70);
  const [bypassMap, setBypassMap] = useState<Record<string, boolean>>({});
  const [enforceSaving, setEnforceSaving] = useState(false);
  const [historyTabKeys, setHistoryTabKeys] = useState<string[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSessionRow[]>([]);
  const [perKeyStats, setPerKeyStats] = useState<Record<string, { completed: number; in_progress: number; avgPct: number; rows: number }>>({});

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter]   = useState<'all' | '3SFM' | 'BVM' | 'live' | 'live_upcoming' | 'live_recorded'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enforcing' | 'bypassed'>('all');
  const [sortBy, setSortBy] = useState<'type' | 'title' | 'engagement' | 'date'>('type');

  // ── Flattened session list ─────────────────────────────────────────────────
  // Union of every known tracker source so the admin sees every session:
  //   (a) every session currently defined in COURSES config (3SFM + BVM)
  //   (b) every live_sessions row (upcoming / live / recorded — published or not)
  //   (c) every certification tab_key with watch history that isn't in (a) —
  //       flagged `unmapped` (deprecated or not yet in config)
  //
  // New sessions added later — to COURSES or to live_sessions — appear here
  // automatically on the next page load, no manual seeding required.
  const allSessions = useMemo<SessionRow[]>(() => {
    const rows: SessionRow[] = [];
    const seen = new Set<string>();

    // (a) COURSES config
    for (const course of Object.values(COURSES)) {
      const short = course.shortTitle.toUpperCase();
      const kind: SessionKind = short === 'BVM' ? 'BVM' : '3SFM';
      for (const s of course.sessions) {
        const tk = s.isFinal ? `${short}_Final` : `${short}_${s.id}`;
        rows.push({
          tabKey: tk,
          kind,
          courseLabel: course.shortTitle,
          sessionTitle: s.title,
        });
        seen.add(tk);
      }
    }

    // (b) Live sessions
    for (const ls of liveSessions) {
      const tk = `LIVE_${ls.id}`;
      const isRecorded = ls.session_type === 'recorded';
      const kind: SessionKind = isRecorded ? 'LIVE_RECORDED' : ls.session_type === 'upcoming' || ls.session_type === 'live' ? 'LIVE_UPCOMING' : 'LIVE_OTHER';
      rows.push({
        tabKey: tk,
        kind,
        courseLabel: isRecorded ? 'Live · Recorded' : 'Live · Upcoming',
        sessionTitle: ls.title,
        hasAssessment: !!ls.has_assessment,
        scheduledAt: ls.scheduled_datetime,
        isPublished: ls.is_published,
      });
      seen.add(tk);
    }

    // (c) Unmapped cert-course history
    for (const tk of historyTabKeys) {
      if (seen.has(tk)) continue;
      const under = tk.indexOf('_');
      const courseLabel = under > 0 ? tk.slice(0, under) : tk;
      const sessionTitle = under > 0 ? tk.slice(under + 1) : '(unknown)';
      rows.push({
        tabKey: tk,
        kind: 'UNMAPPED',
        courseLabel,
        sessionTitle,
        unmapped: true,
      });
    }

    return rows;
  }, [historyTabKeys, liveSessions]);

  const visibleSessions = useMemo<SessionRow[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = allSessions.filter(r => {
      if (q) {
        const hay = `${r.courseLabel} ${r.sessionTitle} ${r.tabKey}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (typeFilter !== 'all') {
        if (typeFilter === '3SFM' && r.kind !== '3SFM') return false;
        if (typeFilter === 'BVM' && r.kind !== 'BVM') return false;
        if (typeFilter === 'live' && !r.kind.startsWith('LIVE_')) return false;
        if (typeFilter === 'live_upcoming' && r.kind !== 'LIVE_UPCOMING') return false;
        if (typeFilter === 'live_recorded' && r.kind !== 'LIVE_RECORDED') return false;
      }
      if (statusFilter === 'enforcing' && bypassMap[r.tabKey]) return false;
      if (statusFilter === 'bypassed' && !bypassMap[r.tabKey]) return false;
      return true;
    });

    const typeOrder: Record<SessionKind, number> = {
      '3SFM': 0, 'BVM': 1, 'LIVE_UPCOMING': 2, 'LIVE_RECORDED': 3, 'LIVE_OTHER': 4, 'UNMAPPED': 5,
    };

    filtered.sort((a, b) => {
      if (sortBy === 'title') return a.sessionTitle.localeCompare(b.sessionTitle);
      if (sortBy === 'engagement') {
        const ea = (perKeyStats[a.tabKey]?.completed ?? 0) + (perKeyStats[a.tabKey]?.in_progress ?? 0);
        const eb = (perKeyStats[b.tabKey]?.completed ?? 0) + (perKeyStats[b.tabKey]?.in_progress ?? 0);
        return eb - ea;
      }
      if (sortBy === 'date') {
        const da = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
        const db = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
        return db - da;
      }
      // default: by type, then original order
      const dk = typeOrder[a.kind] - typeOrder[b.kind];
      if (dk !== 0) return dk;
      return 0;
    });

    return filtered;
  }, [allSessions, searchQuery, typeFilter, statusFilter, sortBy, bypassMap, perKeyStats]);

  const counts = useMemo(() => {
    const c = { total: allSessions.length, sfm: 0, bvm: 0, liveUpcoming: 0, liveRecorded: 0, liveOther: 0, unmapped: 0 };
    for (const r of allSessions) {
      if (r.kind === '3SFM') c.sfm++;
      else if (r.kind === 'BVM') c.bvm++;
      else if (r.kind === 'LIVE_UPCOMING') c.liveUpcoming++;
      else if (r.kind === 'LIVE_RECORDED') c.liveRecorded++;
      else if (r.kind === 'LIVE_OTHER') c.liveOther++;
      else if (r.kind === 'UNMAPPED') c.unmapped++;
    }
    return c;
  }, [allSessions]);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as any).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/training-settings').then(r => r.json()).catch(() => ({ settings: {} })),
      fetch('/api/admin/watch-enforcement-stats').then(r => r.json()).catch(() => ({ historyTabKeys: [] })),
    ]).then(([ts, stats]) => {
      const s = ts.settings ?? {};
      const u = s.apps_script_url ?? '';
      setUrl(u);
      setSavedUrl(u);
      setEnforceEnabled(s.watch_enforcement_enabled !== 'false');
      setEnforceThreshold(Math.max(0, Math.min(100, parseInt(s.watch_enforcement_threshold || '70', 10) || 70)));
      const bm: Record<string, boolean> = {};
      for (const k of Object.keys(s)) {
        if (k.startsWith('watch_enforcement_bypass_')) {
          const tk = k.slice('watch_enforcement_bypass_'.length);
          bm[tk] = s[k] === 'true';
        }
      }
      setBypassMap(bm);
      setHistoryTabKeys(Array.isArray(stats.historyTabKeys) ? stats.historyTabKeys : []);
      setPerKeyStats(stats.perKeyStats ?? {});
      setLiveSessions(Array.isArray(stats.liveSessions) ? stats.liveSessions : []);
      setLoading(false);
    });
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/admin/training-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps_script_url: url.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedUrl(url.trim());
      setTestResult(null);
      showToast('Settings saved');
    } else {
      showToast('Save failed');
    }
  };

  const testConnection = async () => {
    const testUrl = url.trim() || savedUrl;
    if (!testUrl) { showToast('Enter a URL first'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const probe = new URL(testUrl);
      probe.searchParams.set('action', 'ping');
      const res = await fetch(`/api/training/proxy-ping?url=${encodeURIComponent(probe.toString())}`, {
        signal: AbortSignal.timeout(8000),
      });
      setTestResult(res.ok ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
    }
    setTesting(false);
  };

  const dirty = url.trim() !== savedUrl;

  const saveEnforcement = async () => {
    setEnforceSaving(true);
    const payload: Record<string, string> = {
      watch_enforcement_enabled:   enforceEnabled ? 'true' : 'false',
      watch_enforcement_threshold: String(enforceThreshold),
    };
    for (const [tk, on] of Object.entries(bypassMap)) {
      payload[`watch_enforcement_bypass_${tk}`] = on ? 'true' : 'false';
    }
    const res = await fetch('/api/admin/training-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setEnforceSaving(false);
    showToast(res.ok ? 'Watch enforcement saved' : 'Save failed');
  };

  const toggleBypass = (tk: string) => setBypassMap(prev => ({ ...prev, [tk]: !prev[tk] }));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>⚙️ Training Settings</h1>
          <p style={{ fontSize: 13, color: '#6B7280' }}>
            Configure the Google Apps Script Web App URL that powers student registration, progress tracking, and certificates.
          </p>
        </div>

        {loading ? (
          <div style={{ color: '#6B7280', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {/* Apps Script URL Card */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>
                Google Apps Script Web App URL
              </div>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
                Deploy your Apps Script project as a Web App and paste the URL below. This replaces the <code style={{ background: '#F3F4F6', padding: '1px 5px', borderRadius: 3 }}>APPS_SCRIPT_URL</code> environment variable - no Vercel re-deploy needed.
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Web App URL</div>
                  <input
                    value={url}
                    onChange={e => { setUrl(e.target.value); setTestResult(null); }}
                    placeholder="https://script.google.com/macros/s/AKfy.../exec"
                    style={inputStyle}
                  />
                </div>
                <button
                  onClick={testConnection}
                  disabled={testing}
                  style={{ padding: '9px 16px', background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: testing ? 0.7 : 1 }}
                >
                  {testing ? 'Testing…' : '🔌 Test'}
                </button>
                <button
                  onClick={save}
                  disabled={saving || !dirty}
                  style={{ padding: '9px 20px', background: dirty ? '#1B4F8A' : '#F3F4F6', color: dirty ? '#fff' : '#9CA3AF', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', whiteSpace: 'nowrap', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>

              {/* Connection status */}
              {testResult && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  {testResult === 'ok' ? (
                    <>
                      <span style={{ color: '#1A7A30', fontSize: 16 }}>✅</span>
                      <span style={{ color: '#1A7A30', fontWeight: 600 }}>Connection successful - Apps Script is reachable.</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: '#DC2626', fontSize: 16 }}>❌</span>
                      <span style={{ color: '#DC2626', fontWeight: 600 }}>Connection failed - check the URL or deployment permissions.</span>
                    </>
                  )}
                </div>
              )}

              {/* Current saved URL display */}
              {savedUrl && (
                <div style={{ marginTop: 12, fontSize: 11, color: '#6B7280' }}>
                  <strong>Currently saved:</strong> <span style={{ wordBreak: 'break-all' }}>{savedUrl}</span>
                </div>
              )}
              {!savedUrl && (
                <div style={{ marginTop: 12, fontSize: 11, color: '#F59E0B', fontWeight: 600 }}>
                  ⚠️ No URL saved - training registration and progress features are disabled.
                </div>
              )}
            </div>

            {/* Transcript Editor shortcut */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780, display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ fontSize: 36 }}>📄</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>Transcript Settings &amp; Editor</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>
                  Customise header text, footer, logo, and layout - with a live A4 preview where you can drag the logo to reposition it.
                </div>
              </div>
              <a href="/admin/transcript-editor"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', background: '#1B4F8A', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                Open Transcript Editor →
              </a>
            </div>

            {/* Watch Enforcement Card */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B' }}>🎬 Video Watch Enforcement</div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>Require students to watch ≥ threshold% before <strong>Mark Complete</strong>. Applies to all sessions by default (current and future). Admins always bypass.</div>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: enforceEnabled ? '#D1FAE5' : '#FEE2E2', padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: enforceEnabled ? '#065F46' : '#991B1B' }}>
                  <input type="checkbox" checked={enforceEnabled} onChange={e => setEnforceEnabled(e.target.checked)} />
                  {enforceEnabled ? 'Enforcing' : 'Disabled'}
                </label>
              </div>

              {/* Summary stats — global status + threshold + per-type counts */}
              {(() => {
                const totalSessions = allSessions.length;
                const bypassedCount = allSessions.filter(s => bypassMap[s.tabKey]).length;
                const enforcingCount = enforceEnabled ? totalSessions - bypassedCount : 0;
                return (
                  <div style={{ marginTop: 14, padding: '12px 14px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
                    <SummaryStat label="Global" value={enforceEnabled ? 'ON' : 'OFF'} color={enforceEnabled ? '#059669' : '#DC2626'} />
                    <SummaryStat label="Threshold" value={`${enforceThreshold}%`} color="#1B4F8A" />
                    <SummaryStat label="Total" value={`${totalSessions}`} color="#1B3A6B" />
                    <SummaryStat label="3SFM" value={`${counts.sfm}`} color="#1B4F8A" />
                    <SummaryStat label="BVM" value={`${counts.bvm}`} color="#6D28D9" />
                    <SummaryStat label="Live Upcoming" value={`${counts.liveUpcoming}`} color="#EA580C" />
                    <SummaryStat label="Live Recorded" value={`${counts.liveRecorded}`} color="#0F766E" />
                    <SummaryStat label="Enforcing" value={`${enforcingCount}`} color={enforcingCount > 0 ? '#059669' : '#9CA3AF'} />
                    <SummaryStat label="Bypassed" value={`${bypassedCount}`} color={bypassedCount > 0 ? '#F59E0B' : '#9CA3AF'} />
                  </div>
                );
              })()}

              {/* Threshold */}
              <div style={{ marginTop: 14, padding: 14, background: '#F9FAFB', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Threshold</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#1B4F8A', fontVariantNumeric: 'tabular-nums' }}>{enforceThreshold}%</span>
                </div>
                <input
                  type="range"
                  min={50} max={100} step={5}
                  value={enforceThreshold}
                  onChange={e => setEnforceThreshold(Number(e.target.value))}
                  disabled={!enforceEnabled}
                  style={{ width: '100%', accentColor: '#1B4F8A' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
                  <span>50%</span><span>70% (recommended)</span><span>100%</span>
                </div>
              </div>

              {/* Per-session bypass table — merged list of COURSES + live sessions + unmapped history */}
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Per-Session Status · Showing {visibleSessions.length} of {allSessions.length}
                  </div>
                  <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                    Default = enforcing · toggle to bypass a specific session
                  </div>
                </div>

                {/* Search + filters */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by title, course or tab key…"
                    style={{ padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, color: '#1B3A6B', outline: 'none', fontFamily: 'Inter,sans-serif' }}
                  />
                  <select
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
                    style={{ padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, color: '#1B3A6B', background: '#fff', cursor: 'pointer' }}
                  >
                    <option value="all">All Types</option>
                    <option value="3SFM">3SFM</option>
                    <option value="BVM">BVM</option>
                    <option value="live">Live (all)</option>
                    <option value="live_upcoming">Live · Upcoming</option>
                    <option value="live_recorded">Live · Recorded</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                    style={{ padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, color: '#1B3A6B', background: '#fff', cursor: 'pointer' }}
                  >
                    <option value="all">All Status</option>
                    <option value="enforcing">Enforcing</option>
                    <option value="bypassed">Bypassed</option>
                  </select>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as typeof sortBy)}
                    style={{ padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, color: '#1B3A6B', background: '#fff', cursor: 'pointer' }}
                  >
                    <option value="type">Sort: By Type</option>
                    <option value="title">Sort: Title A–Z</option>
                    <option value="engagement">Sort: Most Watched</option>
                    <option value="date">Sort: Date (live)</option>
                  </select>
                </div>

                {/* Bulk actions on the filtered view */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: '#9CA3AF', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 700 }}>Bulk</span>
                  <button
                    onClick={() => {
                      const next = { ...bypassMap };
                      for (const r of visibleSessions) next[r.tabKey] = true;
                      setBypassMap(next);
                    }}
                    disabled={visibleSessions.length === 0}
                    style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: '#fff', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 6, cursor: visibleSessions.length === 0 ? 'not-allowed' : 'pointer', opacity: visibleSessions.length === 0 ? 0.5 : 1 }}
                  >
                    Bypass all ({visibleSessions.length})
                  </button>
                  <button
                    onClick={() => {
                      const next = { ...bypassMap };
                      for (const r of visibleSessions) next[r.tabKey] = false;
                      setBypassMap(next);
                    }}
                    disabled={visibleSessions.length === 0}
                    style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: '#fff', color: '#065F46', border: '1px solid #BBF7D0', borderRadius: 6, cursor: visibleSessions.length === 0 ? 'not-allowed' : 'pointer', opacity: visibleSessions.length === 0 ? 0.5 : 1 }}
                  >
                    Enforce all ({visibleSessions.length})
                  </button>
                  {(searchQuery || typeFilter !== 'all' || statusFilter !== 'all') && (
                    <button
                      onClick={() => { setSearchQuery(''); setTypeFilter('all'); setStatusFilter('all'); }}
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: 'transparent', color: '#6B7280', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>

                <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left',   fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Type</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left',   fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Session</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Watch Stats</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Status</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Bypass</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSessions.length === 0 ? (
                        <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>No sessions match the current filters.</td></tr>
                      ) : visibleSessions.map(row => {
                        const bypassed = !!bypassMap[row.tabKey];
                        const effectivelyEnforcing = enforceEnabled && !bypassed;
                        const statusLabel = !enforceEnabled ? 'Global OFF' : bypassed ? 'Bypassed' : 'Enforcing';
                        const statusColor = !enforceEnabled ? '#6B7280' : bypassed ? '#F59E0B' : '#059669';
                        const statusBg    = !enforceEnabled ? '#F3F4F6' : bypassed ? '#FEF3C7' : '#D1FAE5';
                        const stat = perKeyStats[row.tabKey];
                        return (
                          <tr key={row.tabKey} style={{ borderBottom: '1px solid #F3F4F6' }}>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                              <TypeBadge kind={row.kind} />
                              {row.hasAssessment && (
                                <span title="Has assessment" style={{ marginLeft: 6 }}>🎯</span>
                              )}
                              {row.isPublished === false && (
                                <span title="Unpublished" style={{ marginLeft: 6, fontSize: 8, fontWeight: 800, padding: '2px 5px', background: '#F3F4F6', color: '#6B7280', borderRadius: 3, letterSpacing: '0.04em' }}>DRAFT</span>
                              )}
                              {row.unmapped && (
                                <span title="tab_key seen in watch history but not in COURSES config" style={{ marginLeft: 6, fontSize: 8, fontWeight: 800, padding: '2px 5px', background: '#FEE2E2', color: '#991B1B', borderRadius: 3, letterSpacing: '0.04em' }}>UNMAPPED</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ fontSize: 12, color: '#1B3A6B', fontWeight: 600 }}>{row.sessionTitle}</div>
                              <div style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'monospace', marginTop: 2 }}>
                                {row.tabKey}
                                {row.scheduledAt && ` · ${new Date(row.scheduledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
                              </div>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {stat ? (
                                <span style={{ fontSize: 11, color: '#374151' }}>
                                  <span style={{ color: '#059669', fontWeight: 700 }}>{stat.completed}</span>
                                  <span style={{ color: '#9CA3AF' }}> · </span>
                                  <span style={{ color: '#F59E0B', fontWeight: 700 }}>{stat.in_progress}</span>
                                  <span style={{ color: '#9CA3AF' }}> · </span>
                                  <span style={{ color: '#1B4F8A', fontWeight: 700 }}>{stat.avgPct}%</span>
                                </span>
                              ) : (
                                <span style={{ fontSize: 10, color: '#9CA3AF' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: statusBg, color: statusColor, whiteSpace: 'nowrap' }}>
                                {effectivelyEnforcing ? `${enforceThreshold}% · ` : ''}{statusLabel}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }} title={bypassed ? 'Bypassed for this session' : 'Enforcement applies by default'}>
                                <input type="checkbox" checked={bypassed} onChange={() => toggleBypass(row.tabKey)} />
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={saveEnforcement}
                  disabled={enforceSaving}
                  style={{ padding: '9px 22px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: enforceSaving ? 0.7 : 1 }}
                >
                  {enforceSaving ? 'Saving…' : 'Save Enforcement Settings'}
                </button>
              </div>
            </div>

            {/* How-to guide */}
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: '20px 24px', maxWidth: 780 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1E40AF', marginBottom: 12 }}>📋 How to deploy your Apps Script</div>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#1E3A5F', lineHeight: 2 }}>
                <li>Open <strong>Google Drive</strong> and create or open your Apps Script project.</li>
                <li>In the script editor, click <strong>Deploy → New deployment</strong>.</li>
                <li>Select type: <strong>Web app</strong>.</li>
                <li>Set <em>Execute as</em>: <strong>Me</strong>, and <em>Who has access</em>: <strong>Anyone</strong>.</li>
                <li>Click <strong>Deploy</strong> and copy the Web App URL.</li>
                <li>Paste the URL above and click <strong>Save</strong>.</li>
                <li>Click <strong>🔌 Test</strong> to verify the connection.</li>
              </ol>
              <div style={{ marginTop: 12, fontSize: 12, color: '#1E40AF', background: '#DBEAFE', borderRadius: 6, padding: '8px 12px' }}>
                💡 <strong>Tip:</strong> If you redeploy the script, the URL changes. Always update it here after a new deployment. Using "Manage deployments" to update an existing deployment keeps the same URL.
              </div>
            </div>
          </>
        )}

      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function TypeBadge({ kind }: { kind: SessionKind }) {
  const cfg: Record<SessionKind, { label: string; bg: string; color: string }> = {
    '3SFM':          { label: '3SFM',      bg: '#DBEAFE', color: '#1B4F8A' },
    'BVM':           { label: 'BVM',       bg: '#EDE9FE', color: '#6D28D9' },
    'LIVE_UPCOMING': { label: 'LIVE · UP', bg: '#FFEDD5', color: '#C2410C' },
    'LIVE_RECORDED': { label: 'LIVE · REC',bg: '#CCFBF1', color: '#0F766E' },
    'LIVE_OTHER':    { label: 'LIVE',      bg: '#F3F4F6', color: '#4B5563' },
    'UNMAPPED':      { label: 'UNMAPPED',  bg: '#FEE2E2', color: '#991B1B' },
  };
  const c = cfg[kind];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 9, fontWeight: 800,
      padding: '3px 8px', borderRadius: 4,
      background: c.bg, color: c.color,
      letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>
      {c.label}
    </span>
  );
}
