'use client';

import { useState, useEffect } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/hooks/useRequireAdmin';

interface CourseSession {
  tabKey: string; course: string; num: number; sessionName: string;
  isFinal: boolean; formId: string; formUrl: string; youtubeUrl: string;
  hasForm: boolean; hasVideo: boolean;
}

type EditMap = Record<string, string>; // tabKey → draft youtubeUrl

export default function CourseDetailsAdminPage() {
  const { loading: authLoading } = useRequireAdmin();
  const [sessions, setSessions]  = useState<CourseSession[]>([]);
  const [loading, setLoading]    = useState(true);
  const [lastSync, setLastSync]  = useState<Date | null>(null);
  const [edits, setEdits]        = useState<EditMap>({});
  const [saving, setSaving]      = useState<Record<string, boolean>>({});
  const [toast, setToast]        = useState<{ msg: string; ok: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'3sfm' | 'bvm'>('3sfm');

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchSessions = async (bust = false) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/training/course-details${bust ? '?bust=1' : ''}`);
      const data = await res.json() as { sessions: CourseSession[] };
      setSessions(data.sessions ?? []);
      setLastSync(new Date());
      // Seed edits with current YouTube URLs so inputs are pre-filled
      const seed: EditMap = {};
      for (const s of data.sessions ?? []) seed[s.tabKey] = s.youtubeUrl ?? '';
      setEdits(seed);
    } catch {
      showToast('Failed to load from Apps Script', false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (!authLoading) fetchSessions(); }, [authLoading]);

  const save = async (tabKey: string) => {
    setSaving(p => ({ ...p, [tabKey]: true }));
    try {
      const res = await fetch('/api/training/course-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabKey, youtubeUrl: edits[tabKey] ?? '' }),
      });
      const data = await res.json() as { ok: boolean };
      if (data.ok) {
        showToast('YouTube URL saved');
        // Refresh so the saved value reflects in the table
        fetchSessions(true);
      } else {
        showToast('Save failed', false);
      }
    } catch {
      showToast('Save failed', false);
    } finally {
      setSaving(p => ({ ...p, [tabKey]: false }));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied to clipboard'),
      () => showToast('Copy failed', false),
    );
  };

  const filtered = sessions.filter(s =>
    activeTab === '3sfm' ? s.course?.toUpperCase() === '3SFM' : s.course?.toUpperCase() === 'BVM'
  );

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '6px 10px', fontSize: 12,
    border: '1px solid #D1D5DB', borderRadius: 6,
    fontFamily: 'Inter, sans-serif', background: '#FFFBEB',
    color: '#1B3A6B', outline: 'none', minWidth: 0,
  };

  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/course-details" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>🔗 Course Links</h1>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 0 }}>
              Manage YouTube videos and assessment links for each session. Form URLs are auto-synced from Apps Script.
            </p>
            {lastSync && (
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                Last synced: {lastSync.toLocaleTimeString()}
              </p>
            )}
          </div>
          <button
            onClick={() => fetchSessions(true)}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700,
              background: '#1B4F8A', color: '#fff', border: 'none', cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap',
            }}
          >
            {loading ? '⟳ Syncing…' : '⟳ Sync from Apps Script'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {(['3sfm', 'bvm'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 22px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                border: 'none', cursor: 'pointer',
                background: activeTab === tab ? '#1B4F8A' : '#E8F0FB',
                color:      activeTab === tab ? '#fff'    : '#1B4F8A',
              }}
            >
              {tab === '3sfm' ? '3SFM — 3-Statement FM' : 'BVM — Business Valuation'}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 280px 180px 90px', gap: 0, background: '#1B4F8A', padding: '10px 16px' }}>
            {['#', 'Session Name', 'YouTube URL', 'Form URL', 'Action'].map(h => (
              <div key={h} style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              Loading from Apps Script…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              No sessions found. Click <strong>Sync from Apps Script</strong> to load.
            </div>
          ) : (
            filtered.map((s, idx) => {
              const draft  = edits[s.tabKey] ?? s.youtubeUrl ?? '';
              const dirty  = draft !== (s.youtubeUrl ?? '');
              const isSaving = !!saving[s.tabKey];

              return (
                <div
                  key={s.tabKey}
                  style={{
                    display: 'grid', gridTemplateColumns: '52px 1fr 280px 180px 90px', gap: 0,
                    padding: '12px 16px', alignItems: 'center',
                    borderTop: idx === 0 ? 'none' : '1px solid #F3F4F6',
                    background: s.isFinal ? '#FFFBEB' : idx % 2 === 0 ? '#fff' : '#FAFAFA',
                  }}
                >
                  {/* # */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: s.isFinal ? '#B45309' : '#9CA3AF' }}>
                    {s.isFinal ? '★' : s.num}
                  </div>

                  {/* Session name */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: s.isFinal ? 700 : 500, color: '#0D2E5A' }}>
                      {s.sessionName}
                    </div>
                    {s.isFinal && (
                      <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>Final Exam</div>
                    )}
                  </div>

                  {/* YouTube URL input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 12 }}>
                    <input
                      value={draft}
                      onChange={e => setEdits(p => ({ ...p, [s.tabKey]: e.target.value }))}
                      placeholder="https://youtu.be/..."
                      style={inputStyle}
                    />
                    {draft && (
                      <a href={draft} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#6B7280', flexShrink: 0 }}>↗</a>
                    )}
                  </div>

                  {/* Form URL */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {s.formUrl ? (
                      <>
                        <button
                          onClick={() => copyToClipboard(s.formUrl)}
                          title="Copy form URL"
                          style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, background: '#E8F0FB', color: '#1B4F8A', border: 'none', cursor: 'pointer' }}
                        >
                          Copy
                        </button>
                        <a href={s.formUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, background: '#F0FFF4', color: '#15803D', border: 'none', textDecoration: 'none' }}>
                          Open
                        </a>
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: '#D1D5DB' }}>No form yet</span>
                    )}
                  </div>

                  {/* Save button */}
                  <div>
                    <button
                      onClick={() => save(s.tabKey)}
                      disabled={!dirty || isSaving}
                      style={{
                        padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none',
                        background: dirty ? '#1B4F8A' : '#F3F4F6',
                        color:      dirty ? '#fff'    : '#9CA3AF',
                        cursor: dirty ? 'pointer' : 'default',
                        opacity: isSaving ? 0.6 : 1,
                      }}
                    >
                      {isSaving ? '…' : dirty ? 'Save' : 'Saved'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 16, padding: '12px 16px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 12, color: '#1E40AF' }}>
          💡 Form URLs are read from the Apps Script Form Registry sheet and are read-only. YouTube URLs can be edited here and are saved back to the sheet via Apps Script.
        </div>
      </main>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.ok ? '#1A7A30' : '#DC2626', color: '#fff',
          padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}
