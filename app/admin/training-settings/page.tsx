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

  // ── Flattened session list ─────────────────────────────────────────────────
  // Union of:
  //   (a) every session currently defined in COURSES config, and
  //   (b) every tab_key with at least one certification_watch_history record.
  //
  // This guarantees that new sessions added to COURSES in the future appear
  // automatically — no manual seeding needed. Sessions from (b) that aren't in
  // (a) are flagged `unmapped: true` (e.g. deprecated or not yet configured).
  const allSessions = useMemo(() => {
    const configTks: Record<string, { courseTitle: string; sessionTitle: string }> = {};
    for (const course of Object.values(COURSES)) {
      for (const s of course.sessions) {
        const tk = s.isFinal
          ? `${course.shortTitle.toUpperCase()}_Final`
          : `${course.shortTitle.toUpperCase()}_${s.id}`;
        configTks[tk] = { courseTitle: course.shortTitle, sessionTitle: s.title };
      }
    }
    const merged: { tabKey: string; courseTitle: string; sessionTitle: string; unmapped: boolean }[] = [];
    const seen = new Set<string>();
    for (const tk of Object.keys(configTks)) {
      merged.push({ tabKey: tk, ...configTks[tk], unmapped: false });
      seen.add(tk);
    }
    for (const tk of historyTabKeys) {
      if (seen.has(tk)) continue;
      // Parse "{COURSE}_{ID or Final}"
      const under = tk.indexOf('_');
      const courseTitle = under > 0 ? tk.slice(0, under) : tk;
      const sessionTitle = under > 0 ? tk.slice(under + 1) : '(unknown)';
      merged.push({ tabKey: tk, courseTitle, sessionTitle, unmapped: true });
    }
    return merged;
  }, [historyTabKeys]);

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

              {/* Summary stats — global status + threshold + counts */}
              {(() => {
                const totalSessions = allSessions.length;
                const bypassedCount = allSessions.filter(s => bypassMap[s.tabKey]).length;
                const enforcingCount = enforceEnabled ? totalSessions - bypassedCount : 0;
                return (
                  <div style={{ marginTop: 14, padding: '12px 14px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
                    <SummaryStat label="Global" value={enforceEnabled ? 'ON' : 'OFF'} color={enforceEnabled ? '#059669' : '#DC2626'} />
                    <SummaryStat label="Threshold" value={`${enforceThreshold}%`} color="#1B4F8A" />
                    <SummaryStat label="Enforcing" value={`${enforcingCount} session${enforcingCount === 1 ? '' : 's'}`} color={enforcingCount > 0 ? '#059669' : '#9CA3AF'} />
                    <SummaryStat label="Bypassed" value={`${bypassedCount}`} color={bypassedCount > 0 ? '#F59E0B' : '#9CA3AF'} />
                    <SummaryStat label="Tracked" value={`${totalSessions}`} color="#6B7280" />
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

              {/* Per-session bypass table — merged list of COURSES + tab_keys seen in history */}
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Per-Session Status ({allSessions.length} session{allSessions.length === 1 ? '' : 's'})
                  </div>
                  <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                    Default = enforcing · toggle to bypass a specific session
                  </div>
                </div>
                <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '7px 10px', textAlign: 'left',   fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Course</th>
                        <th style={{ padding: '7px 10px', textAlign: 'left',   fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Session</th>
                        <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Status</th>
                        <th style={{ padding: '7px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Bypass</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allSessions.map(({ tabKey, courseTitle, sessionTitle, unmapped }) => {
                        const bypassed = !!bypassMap[tabKey];
                        const effectivelyEnforcing = enforceEnabled && !bypassed;
                        const statusLabel = !enforceEnabled ? 'Global OFF'
                                         : bypassed          ? 'Bypassed'
                                                             : 'Enforcing (default)';
                        const statusColor = !enforceEnabled ? '#6B7280'
                                         : bypassed          ? '#F59E0B'
                                                             : '#059669';
                        const statusBg    = !enforceEnabled ? '#F3F4F6'
                                         : bypassed          ? '#FEF3C7'
                                                             : '#D1FAE5';
                        return (
                          <tr key={tabKey} style={{ borderBottom: '1px solid #F3F4F6' }}>
                            <td style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6B7280', whiteSpace: 'nowrap' }}>
                              {courseTitle}
                              {unmapped && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 800, background: '#FEE2E2', color: '#991B1B', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.04em' }} title="tab_key seen in watch history but not in COURSES config">UNMAPPED</span>}
                            </td>
                            <td style={{ padding: '6px 10px', fontSize: 11, color: '#374151' }}>{sessionTitle}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: statusBg, color: statusColor, whiteSpace: 'nowrap' }}>
                                {effectivelyEnforcing ? `${enforceThreshold}% · ` : ''}{statusLabel}
                              </span>
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }} title={bypassed ? 'Enforcement bypassed for this session' : 'Enforcement applies by default'}>
                                <input type="checkbox" checked={bypassed} onChange={() => toggleBypass(tabKey)} />
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
