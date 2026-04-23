'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, Legend,
} from 'recharts';

interface AnalyticsData {
  overview: { total: number; activeWeek: number; completionRate: number; certified: number; sfmEnrolled: number; bvmEnrolled: number };
  trends: { week: string; sfm: number; bvm: number; total: number }[];
  sessionCompletion: { session: string; pct: number; passed: number; total: number }[];
  geo: { location: string; count: number }[];
  funnel: { label: string; count: number; pct: number }[];
  dataAvailable: boolean;
}

function StatCard({ label, value, sub, color = '#1B3A6B' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '20px 24px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const RANGES = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: '365' },
];

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData]     = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange]   = useState('90');
  const [sortCol, setSortCol] = useState<'session' | 'pct'>('session');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/training-hub/analytics?range=${range}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sessionRows = [...(data?.sessionCompletion ?? [])].sort((a, b) => {
    if (sortCol === 'pct') return sortAsc ? a.pct - b.pct : b.pct - a.pct;
    return sortAsc ? a.session.localeCompare(b.session) : b.session.localeCompare(a.session);
  });

  const barColor = (pct: number) => pct >= 70 ? '#2EAA4A' : pct >= 50 ? '#F59E0B' : '#DC2626';

  const thStyle: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/analytics" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>📈 Training Analytics</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>Registration trends, session completion rates, and student performance</p>
          </div>
          <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 8, padding: 4 }}>
            {RANGES.map(r => (
              <button key={r.value} onClick={() => setRange(r.value)}
                style={{ padding: '6px 12px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: range === r.value ? 700 : 500, background: range === r.value ? '#1B4F8A' : 'transparent', color: range === r.value ? '#fff' : '#6B7280' }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: '#6B7280', fontSize: 14 }}>Loading analytics…</div>
        ) : (
          <>
            {/* SECTION A - Overview Stats */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
              <StatCard label="Total Students" value={data?.overview.total ?? 0} sub={`3SFM: ${data?.overview.sfmEnrolled ?? 0} · BVM: ${data?.overview.bvmEnrolled ?? 0}`} />
              <StatCard label="Active This Week" value={data?.overview.activeWeek ?? 0} color="#2EAA4A" />
              <StatCard label="Completion Rate" value={`${data?.overview.completionRate ?? 0}%`} color="#1B4F8A" sub={`${data?.overview.certified ?? 0} students certified`} />
            </div>

            {/* SECTION B - Registration Trends */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 16 }}>Registration Trends</div>
              {(data?.trends.length ?? 0) === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontSize: 13 }}>No registration data in selected range</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data!.trends} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="sfm" stroke="#1B4F8A" strokeWidth={2} dot={false} name="3SFM" />
                    <Line type="monotone" dataKey="bvm" stroke="#2EAA4A" strokeWidth={2} dot={false} name="BVM" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* SECTION C - Session Completion */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>3SFM Session Completion Rates</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>% of enrolled students who passed each session. Green &gt;70%, Yellow 50–70%, Red &lt;50%.</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.sessionCompletion ?? []} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="session" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="pct" name="Pass Rate">
                    {(data?.sessionCompletion ?? []).map((entry, i) => (
                      <Cell key={i} fill={barColor(entry.pct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* SECTION D - Assessment Performance Table */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '20px 24px 12px', fontSize: 15, fontWeight: 700, color: '#1B3A6B' }}>Assessment Performance</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#1B4F8A' }}>
                    <th style={thStyle} onClick={() => { setSortCol('session'); setSortAsc(sortCol !== 'session' ? true : !sortAsc); }}>
                      Session {sortCol === 'session' ? (sortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th style={thStyle} onClick={() => { setSortCol('pct'); setSortAsc(sortCol !== 'pct' ? true : !sortAsc); }}>
                      Pass Rate {sortCol === 'pct' ? (sortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th style={thStyle}>Passed</th>
                    <th style={thStyle}>Total Enrolled</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionRows.map((s, i) => (
                    <tr key={s.session} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFF' }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{s.session}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 80, height: 6, borderRadius: 3, background: '#E5E7EB', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 3, background: barColor(s.pct), width: `${s.pct}%` }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: barColor(s.pct) }}>{s.pct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#374151' }}>{s.passed}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#374151' }}>{s.total}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                          background: s.total === 0 ? '#F3F4F6' : s.pct >= 70 ? '#F0FFF4' : s.pct >= 50 ? '#FEF3C7' : '#FEE2E2',
                          color:      s.total === 0 ? '#9CA3AF' : s.pct >= 70 ? '#15803D' : s.pct >= 50 ? '#92400E' : '#DC2626' }}>
                          {s.total === 0 ? 'No data' : s.pct >= 70 ? 'Good' : s.pct >= 50 ? 'Watch' : 'Problem'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* SECTION E + F - Geo + Funnel in 2 columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

              {/* Geo */}
              <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 12 }}>Geographic Breakdown</div>
                {(data?.geo.length ?? 0) === 0 ? (
                  <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No location data yet. Students set this in their profile.</div>
                ) : (
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {(data?.geo ?? []).map((g, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F3F4F6' }}>
                        <span style={{ fontSize: 13, color: '#374151' }}>{g.location}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', background: '#EFF6FF', padding: '2px 8px', borderRadius: 20 }}>{g.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Dropout funnel */}
              <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 12 }}>3SFM Dropout Funnel</div>
                {(data?.funnel ?? []).map((step, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>{step.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: step.pct >= 50 ? '#1B4F8A' : '#DC2626' }}>
                        {step.count} ({step.pct}%)
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: '#E5E7EB', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 4, background: step.pct >= 50 ? '#1B4F8A' : '#DC2626', width: `${step.pct}%`, transition: 'width 0.6s' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
