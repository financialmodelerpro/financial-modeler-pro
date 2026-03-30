'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface SessionRow {
  sessionKey: string; label: string; isFinal: boolean;
  base: number; passed: number; passRate: number;
  avgFeedback: number | null; feedbackCount: number; comments: string[];
}
interface AssessmentData {
  sessions: SessionRow[]; bvmSessions: SessionRow[];
  problemSessions: SessionRow[]; dataAvailable: boolean;
}

function Stars({ v }: { v: number | null }) {
  if (v == null) return <span style={{ color: '#9CA3AF' }}>—</span>;
  return (
    <span title={`${v}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ fontSize: 13, color: i < Math.round(v) ? '#F59E0B' : '#E5E7EB' }}>★</span>
      ))}
      <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 3 }}>{v}</span>
    </span>
  );
}

const rowBg = (rate: number, total: number) => {
  if (total === 0) return '#fff';
  if (rate >= 80) return '#F0FFF4';
  if (rate >= 60) return '#FFFBEB';
  return '#FFF5F5';
};
const rowColor = (rate: number, total: number) => total === 0 ? '#9CA3AF' : rate >= 80 ? '#15803D' : rate >= 60 ? '#92400E' : '#DC2626';

export default function AssessmentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData]       = useState<AssessmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState<SessionRow | null>(null);
  const [tab, setTab]         = useState<'sfm' | 'bvm'>('sfm');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/training-hub/assessments');
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rows = tab === 'sfm' ? (data?.sessions ?? []) : (data?.bvmSessions ?? []);

  const thStyle: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/assessments" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>📋 Assessment Intelligence</h1>
          <p style={{ fontSize: 13, color: '#6B7280' }}>Per-session pass rates, student feedback scores, and problem detection</p>
        </div>

        {/* Problem sessions alert */}
        {!loading && (data?.problemSessions.length ?? 0) > 0 && (
          <div style={{ background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 10, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
                {data!.problemSessions.length} session{data!.problemSessions.length > 1 ? 's' : ''} need attention:
              </span>
              <span style={{ fontSize: 13, color: '#DC2626', marginLeft: 6 }}>
                {data!.problemSessions.map(s => s.label).join(', ')} — pass rate &lt;60%
              </span>
            </div>
          </div>
        )}

        {/* Course tab */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#fff', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid #E8F0FB' }}>
          {(['sfm', 'bvm'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '7px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 500, background: tab === t ? '#1B4F8A' : 'transparent', color: tab === t ? '#fff' : '#6B7280' }}>
              {t === 'sfm' ? '3SFM' : 'BVM'}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#6B7280', fontSize: 14 }}>Loading…</div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1B4F8A' }}>
                  {['Session', 'Pass Rate', 'Passed / Total', 'Feedback Score', 'Responses', 'Status'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={s.sessionKey}
                    onClick={() => setModal(s)}
                    style={{ borderBottom: '1px solid #F3F4F6', background: rowBg(s.passRate, s.base), cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.opacity = '0.85'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.opacity = '1'; }}>
                    <td style={{ padding: '11px 14px', fontWeight: 700, color: '#1B3A6B', fontSize: 13 }}>
                      {s.isFinal ? '🏆 ' : ''}{s.label}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 80, height: 6, borderRadius: 3, background: '#E5E7EB', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, background: s.base === 0 ? '#E5E7EB' : rowColor(s.passRate, s.base), width: `${s.passRate}%` }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: rowColor(s.passRate, s.base) }}>
                          {s.base === 0 ? '—' : `${s.passRate}%`}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: '#374151' }}>
                      {s.base === 0 ? '—' : `${s.passed} / ${s.base}`}
                    </td>
                    <td style={{ padding: '11px 14px' }}><Stars v={s.avgFeedback} /></td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: '#6B7280' }}>{s.feedbackCount}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: s.base === 0 ? '#F3F4F6' : s.passRate >= 80 ? '#F0FFF4' : s.passRate >= 60 ? '#FEF3C7' : '#FEE2E2',
                        color:      s.base === 0 ? '#9CA3AF' : s.passRate >= 80 ? '#15803D' : s.passRate >= 60 ? '#92400E' : '#DC2626' }}>
                        {s.base === 0 ? 'No data' : s.passRate >= 80 ? '✓ Good' : s.passRate >= 60 ? '⚡ Watch' : '⚠️ Problem'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Drill-down modal */}
        {modal && (
          <div onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: '28px 28px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1B3A6B' }}>
                  {modal.isFinal ? '🏆 ' : '📋 '}Session {modal.label} — Details
                </div>
                <button onClick={() => setModal(null)} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>✕</button>
              </div>

              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                {[
                  { label: 'Pass Rate', value: modal.base === 0 ? '—' : `${modal.passRate}%`, color: rowColor(modal.passRate, modal.base) },
                  { label: 'Feedback', value: modal.avgFeedback != null ? `${modal.avgFeedback}/5` : '—', color: '#F59E0B' },
                  { label: 'Responses', value: String(modal.feedbackCount), color: '#1B4F8A' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center', padding: '12px', background: '#F9FAFB', borderRadius: 8 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Completion bar chart */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Pass vs Enrolled</div>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={[{ name: modal.label, passed: modal.passed, notPassed: modal.base - modal.passed }]} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={40} />
                    <Tooltip />
                    <Bar dataKey="passed" name="Passed" stackId="a" fill="#2EAA4A" />
                    <Bar dataKey="notPassed" name="Not Passed" stackId="a" fill="#E5E7EB" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Student comments */}
              {modal.comments.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Student Comments ({modal.comments.length})</div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {modal.comments.map((c, i) => (
                      <div key={i} style={{ background: '#F9FAFB', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
                        &ldquo;{c}&rdquo;
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {modal.comments.length === 0 && (
                <div style={{ textAlign: 'center', padding: '16px 0', color: '#9CA3AF', fontSize: 13 }}>No student comments for this session yet.</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
