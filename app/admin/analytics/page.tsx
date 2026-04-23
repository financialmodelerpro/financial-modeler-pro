'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts';

/* ── Types ────────────────────────────────────────────────────────────── */

interface FunnelRow {
  index: number; session_id: string; title: string; is_final: boolean; tab_key: string;
  enrolled: number; watched: number; attempted: number; passed: number;
  pass_rate_vs_enrolled: number; watch_rate: number; drop_off_from_prev: number;
}
interface CourseRow {
  code: '3SFM' | 'BVM'; enrolled: number; started: number; completed: number;
  certified: number; avg_score: number; completion_rate: number;
  sessions_total: number; regular_count: number;
}
interface LiveRow {
  id: string; title: string; session_type: string; scheduled_datetime: string | null;
  registered: number; attended: number; attendance_rate: number;
  watched: number; watched_completed: number; watch_rate: number;
}
interface AnalyticsData {
  updated_at: string;
  range: '7' | '30' | '90' | 'all';
  overview: {
    total_students: number; active_7d: number; active_30d: number;
    total_enrolled: number; total_certified: number; certification_rate: number;
    sfm_enrolled: number; bvm_enrolled: number;
  };
  growth:   { date: string; daily: number; cumulative: number }[];
  courses:  CourseRow[];
  funnel_3sfm: FunnelRow[];
  funnel_bvm:  FunnelRow[];
  biggest_dropoff: (FunnelRow & { course: '3SFM' | 'BVM' }) | null;
  live_sessions: LiveRow[];
}

/* ── Styling primitives ───────────────────────────────────────────────── */

const NAVY   = '#1B3A6B';
const BLUE   = '#1B4F8A';
const TEAL   = '#0891B2';
const GREEN  = '#2EAA4A';
const AMBER  = '#F59E0B';
const RED    = '#DC2626';
const GOLD   = '#C9A84C';

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #E8F0FB',
  borderRadius: 12, padding: '22px 26px', boxSizing: 'border-box',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 800, color: NAVY, marginBottom: 4,
};
const sectionSub: React.CSSProperties = {
  fontSize: 12, color: '#6B7280', marginBottom: 18, lineHeight: 1.5,
};

function StatCard(props: { label: string; value: string | number; sub?: string; color?: string }) {
  const { label, value, sub, color = NAVY } = props;
  return (
    <div style={{ ...card, padding: '18px 22px', minWidth: 160 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

const RANGES: { label: string; value: '7' | '30' | '90' | 'all' }[] = [
  { label: 'Last 7 days',  value: '7'  },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time',     value: 'all' },
];

function fmtTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function fmtDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  } catch { return iso; }
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function AnalyticsDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange]     = useState<'7' | '30' | '90' | 'all'>('30');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/analytics?range=${range}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json() as AnalyticsData;
        setData(j);
      }
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }, [range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Course comparison bar data
  const courseComparison = useMemo(() => {
    return (data?.courses ?? []).map(c => ({
      course:    c.code,
      enrolled:  c.enrolled,
      started:   c.started,
      completed: c.completed,
      certified: c.certified,
    }));
  }, [data]);

  // Funnel rows sorted so we show the early sessions first (natural reading order)
  const funnel3 = data?.funnel_3sfm ?? [];
  const funnelB = data?.funnel_bvm  ?? [];

  if (status === 'loading' || loading || !data) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
        <CmsAdminNav active="/admin/analytics" />
        <main style={{ flex: 1, padding: 40 }}>
          <div style={{ textAlign: 'center', padding: 80, color: '#6B7280', fontSize: 14 }}>Loading analytics…</div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/analytics" />
      <main className="fmp-analytics-main" style={{ flex: 1, padding: 'clamp(18px, 4vw, 40px)', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, color: NAVY, margin: 0, marginBottom: 4 }}>
              📊 Platform Analytics
            </h1>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
              Students, completion funnels, certificates and live-session engagement across both courses.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 8, padding: 4 }}>
              {RANGES.map(r => (
                <button key={r.value} onClick={() => setRange(r.value)}
                  style={{ padding: '6px 12px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: range === r.value ? 700 : 500, background: range === r.value ? BLUE : 'transparent', color: range === r.value ? '#fff' : '#6B7280' }}>
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={fetchData}
              disabled={refreshing}
              style={{
                padding: '8px 16px', borderRadius: 8, border: `1px solid ${BLUE}`,
                background: refreshing ? '#F3F4F6' : '#fff', color: BLUE,
                fontSize: 12, fontWeight: 700, cursor: refreshing ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
              title="Pull fresh numbers from Supabase"
            >
              {refreshing ? '⏳ Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 24 }}>
          Last updated: {fmtTs(data.updated_at)} · Data refreshes on every open.
        </div>

        {/* ── KPI cards ───────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 28 }}>
          <StatCard
            label="Total Students"
            value={data.overview.total_students.toLocaleString()}
            sub={`3SFM: ${data.overview.sfm_enrolled} · BVM: ${data.overview.bvm_enrolled}`}
          />
          <StatCard label="Active · 7 days"  value={data.overview.active_7d.toLocaleString()}  color={GREEN} sub="Assessment or video activity" />
          <StatCard label="Active · 30 days" value={data.overview.active_30d.toLocaleString()} color={TEAL}  sub="Assessment or video activity" />
          <StatCard
            label="Certificates Issued"
            value={data.overview.total_certified.toLocaleString()}
            color={GOLD}
            sub={`${data.overview.certification_rate}% of enrolled`}
          />
        </div>

        {/* ── Growth trend ────────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 22 }}>
          <div style={sectionTitle}>Signup Trend</div>
          <div style={sectionSub}>Daily new registrations (blue bars) with cumulative student total (gold line).</div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.growth} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="daily" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={BLUE} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={BLUE} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={fmtDateShort} minTickGap={20} />
              <YAxis yAxisId="daily" tick={{ fontSize: 11, fill: '#9CA3AF' }} allowDecimals={false} />
              <YAxis yAxisId="cumu"  tick={{ fontSize: 11, fill: '#9CA3AF' }} allowDecimals={false} orientation="right" />
              <Tooltip labelFormatter={(v) => fmtDateShort(String(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="daily" type="monotone" dataKey="daily"      stroke={BLUE} fill="url(#daily)" name="New signups" strokeWidth={2} />
              <Area yAxisId="cumu"  type="monotone" dataKey="cumulative" stroke={GOLD} fill="none"        name="Cumulative total" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ── Course comparison ───────────────────────────────────────── */}
        <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginBottom: 22 }}>
          {(data.courses ?? []).map(c => (
            <div key={c.code} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: c.code === '3SFM' ? BLUE : GREEN, letterSpacing: '0.08em' }}>{c.code}</div>
                  <div style={sectionTitle}>
                    {c.code === '3SFM' ? '3-Statement Financial Modeling' : 'Business Valuation Modeling'}
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: c.completion_rate >= 40 ? GREEN : c.completion_rate >= 20 ? AMBER : RED }}>
                  {c.completion_rate}%
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13 }}>
                <div><div style={{ color: '#9CA3AF', fontSize: 11 }}>Enrolled</div><div style={{ fontWeight: 700, color: NAVY }}>{c.enrolled.toLocaleString()}</div></div>
                <div><div style={{ color: '#9CA3AF', fontSize: 11 }}>Started</div><div style={{ fontWeight: 700, color: NAVY }}>{c.started.toLocaleString()}</div></div>
                <div><div style={{ color: '#9CA3AF', fontSize: 11 }}>Completed</div><div style={{ fontWeight: 700, color: NAVY }}>{c.completed.toLocaleString()}</div></div>
                <div><div style={{ color: '#9CA3AF', fontSize: 11 }}>Certified</div><div style={{ fontWeight: 700, color: NAVY }}>{c.certified.toLocaleString()}</div></div>
                <div><div style={{ color: '#9CA3AF', fontSize: 11 }}>Avg score</div><div style={{ fontWeight: 700, color: NAVY }}>{c.avg_score || '-'}</div></div>
                <div><div style={{ color: '#9CA3AF', fontSize: 11 }}>Sessions</div><div style={{ fontWeight: 700, color: NAVY }}>{c.sessions_total}</div></div>
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: '#6B7280' }}>
                Completion rate = certified / enrolled. Started = at least one session passed.
              </div>
            </div>
          ))}
        </div>

        {/* Head-to-head chart */}
        <div style={{ ...card, marginBottom: 22 }}>
          <div style={sectionTitle}>Course Progression (head-to-head)</div>
          <div style={sectionSub}>Enrolled vs students who started vs completed the course vs earned the certificate.</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={courseComparison} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
              <XAxis dataKey="course" tick={{ fontSize: 12, fill: '#6B7280', fontWeight: 600 }} />
              <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="enrolled"  name="Enrolled"  fill="#9CA3AF" />
              <Bar dataKey="started"   name="Started"   fill={BLUE} />
              <Bar dataKey="completed" name="Completed" fill={GREEN} />
              <Bar dataKey="certified" name="Certified" fill={GOLD} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── Biggest drop-off callout ────────────────────────────────── */}
        {data.biggest_dropoff && (
          <div style={{ ...card, marginBottom: 22, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#92400E', letterSpacing: '0.08em', marginBottom: 4 }}>
              BIGGEST DROP-OFF POINT
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
              {data.biggest_dropoff.course} · {data.biggest_dropoff.title}
            </div>
            <div style={{ fontSize: 13, color: '#78350F' }}>
              <strong>{data.biggest_dropoff.drop_off_from_prev}</strong> students stopped between the previous session and this one.
              Only <strong>{data.biggest_dropoff.passed}</strong> of <strong>{data.biggest_dropoff.enrolled}</strong> enrolled ({data.biggest_dropoff.pass_rate_vs_enrolled}%) have passed here.
            </div>
          </div>
        )}

        {/* ── Funnels per course ──────────────────────────────────────── */}
        {[
          { code: '3SFM' as const, rows: funnel3, bg: '#EFF6FF', accent: BLUE  },
          { code: 'BVM'  as const, rows: funnelB,  bg: '#F0FDF4', accent: GREEN },
        ].map(block => (
          <div key={block.code} style={{ ...card, marginBottom: 22, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 26px 8px' }}>
              <div style={{ ...sectionTitle, color: block.accent }}>{block.code} Session Funnel</div>
              <div style={sectionSub}>
                Registered → Watched → Attempted → Passed for every session. Drop-off column is the
                count of students lost vs the previous stage.
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr style={{ background: BLUE }}>
                    {['#', 'Session', 'Enrolled', 'Watched', 'Attempted', 'Passed', 'Pass %', 'Drop-off'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No data for this course yet.</td></tr>
                  ) : block.rows.map((r, i) => {
                    const dropColor = r.drop_off_from_prev >= 5 ? RED : r.drop_off_from_prev >= 2 ? AMBER : '#9CA3AF';
                    const passColor = r.pass_rate_vs_enrolled >= 50 ? GREEN : r.pass_rate_vs_enrolled >= 25 ? AMBER : RED;
                    return (
                      <tr key={r.tab_key} style={{ borderTop: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFF' }}>
                        <td style={{ padding: '10px 12px', fontSize: 11, color: '#9CA3AF' }}>{r.index}{r.is_final ? ' 🏁' : ''}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: NAVY, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151' }}>{r.enrolled}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151' }}>{r.watched}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151' }}>{r.attempted}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151', fontWeight: 700 }}>{r.passed}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 70, height: 6, borderRadius: 3, background: '#E5E7EB', overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, background: passColor, width: `${Math.min(100, r.pass_rate_vs_enrolled)}%` }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: passColor, whiteSpace: 'nowrap' }}>{r.pass_rate_vs_enrolled}%</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, color: dropColor, whiteSpace: 'nowrap' }}>
                          {r.drop_off_from_prev > 0 ? `-${r.drop_off_from_prev}` : r.drop_off_from_prev < 0 ? `+${Math.abs(r.drop_off_from_prev)}` : '0'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* ── Live sessions ───────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 32, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 26px 8px' }}>
            <div style={sectionTitle}>Live Session Engagement</div>
            <div style={sectionSub}>
              Registrations vs attendance (admin-marked) vs recording watch. Attendance rate is
              attended/registered; watch rate counts any watch history row against registered count.
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ background: BLUE }}>
                  {['Session', 'Type', 'Registered', 'Attended', 'Attendance %', 'Watched', 'Completed watches', 'Watch %'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.live_sessions.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No live sessions yet.</td></tr>
                ) : data.live_sessions.map((s, i) => {
                  const attendColor = s.attendance_rate >= 70 ? GREEN : s.attendance_rate >= 40 ? AMBER : RED;
                  return (
                    <tr key={s.id} style={{ borderTop: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFF' }}>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: NAVY, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: '#6B7280', textTransform: 'capitalize' }}>{s.session_type}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151' }}>{s.registered}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151' }}>{s.attended}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {s.registered === 0 ? <span style={{ color: '#9CA3AF', fontSize: 11 }}>-</span> : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 60, height: 6, borderRadius: 3, background: '#E5E7EB', overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, background: attendColor, width: `${Math.min(100, s.attendance_rate)}%` }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: attendColor, whiteSpace: 'nowrap' }}>{s.attendance_rate}%</span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151' }}>{s.watched}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151' }}>{s.watched_completed}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, color: '#374151' }}>{s.watch_rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <style>{`
          @media (max-width: 640px) {
            .fmp-analytics-main h1 { font-size: 20px !important; }
          }
        `}</style>
      </main>
    </div>
  );
}
