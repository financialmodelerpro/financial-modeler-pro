'use client';

/**
 * Per-student certification progress for a live course: each session met
 * live (L), by recording (R), or not yet, and whether submission is unlocked.
 * Reads the same eligibility rule the student page and the submission gate use.
 */
import { useEffect, useState } from 'react';
import type { Eligibility } from '@/src/hubs/training/lib/liveCourse/eligibility';

interface Row { email: string; name: string; registrationId: string; eligibility: Eligibility }
interface Data { sessions: { id: string; no: number | null; title: string }[]; students: Row[] }

const NAVY = '#1B4F8A';
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', background: NAVY, color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #E8EEF7', fontSize: 12.5 };

export function LiveCourseProgressTab({ courseCode }: { courseCode: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    setData(null);
    fetch(`/api/admin/live-course/${courseCode}/progress`).then((r) => r.json()).then(setData).catch(() => {});
  }, [courseCode]);
  if (!data) return <div style={{ color: '#5A6675' }}>Loading…</div>;
  const rows = data.students.filter((s) => !q || `${s.name} ${s.email} ${s.registrationId}`.toLowerCase().includes(q.toLowerCase()));
  const unlocked = data.students.filter((s) => s.eligibility.submissionUnlocked).length;
  return (
    <div data-testid="admin-live-course-progress">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <input placeholder="Search name, email or ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #CBD5E1', width: 280 }} />
        <span style={{ fontSize: 13, color: '#5A6675' }}>{data.students.length} enrolled · {unlocked} eligible to submit · L = live, R = recording</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', background: '#fff', minWidth: '100%' }}>
          <thead><tr>
            <th style={th}>Student</th>
            {data.sessions.map((s) => <th key={s.id} style={th} title={s.title}>S{s.no ?? '?'}</th>)}
            <th style={th}>Route</th><th style={th}>Submission</th>
          </tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.email}>
                <td style={td}><strong>{s.name || s.email}</strong><div style={{ color: '#5A6675', fontSize: 11 }}>{s.email} · {s.registrationId}</div></td>
                {s.eligibility.sessions.map((e) => (
                  <td key={e.sessionId} style={{ ...td, textAlign: 'center', fontWeight: 700, color: e.met ? '#2E7D52' : e.held ? '#B91C1C' : '#9CA3AF' }}
                      title={`Live ${e.livePct.toFixed(1)}% · Recording ${e.recordingPct.toFixed(1)}%`}>
                    {e.via === 'live' ? 'L' : e.via === 'recording' ? 'R' : e.held ? `${Math.round(Math.max(e.livePct, e.recordingPct))}%` : '·'}
                  </td>
                ))}
                <td style={td}>{s.eligibility.routeCompleted ?? '-'}</td>
                <td style={{ ...td, color: s.eligibility.submissionUnlocked ? '#2E7D52' : '#5A6675', fontWeight: 700 }}>{s.eligibility.submissionUnlocked ? 'Unlocked' : 'Locked'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td style={td} colSpan={data.sessions.length + 3}>No students.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
