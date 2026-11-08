'use client';

/**
 * Admin > Live Training (2026-11-08): one area for live courses and one-off
 * live sessions. Replaces the separate Live Sessions and Live Courses pages
 * (their old URLs redirect here).
 *   Courses          every live course, its status, sessions, enrolments, next session
 *   Single sessions  one-off sessions, through the one shared session editor
 */
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import { LiveSessionsManager } from './LiveSessionsManager';
import { StatusBadge } from './StatusBadge';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';

interface CourseRow {
  courseCode: string; title: string; status: 'draft' | 'published' | 'archived'; enrolmentOpen: boolean;
  sessionCount: number; enrolledCount: number; nextSessionAt: string | null;
}

const btn: React.CSSProperties = { padding: '8px 16px', borderRadius: 6, border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { ...btn, background: NAVY, color: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', background: NAVY, color: '#fff', fontSize: 12, fontWeight: 700 };
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: `1px solid ${PALE}`, fontSize: 13 };

function LiveTrainingInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<'courses' | 'sessions'>(params.get('tab') === 'sessions' ? 'sessions' : 'courses');
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const load = useCallback(() => {
    fetch('/api/admin/live-course').then((r) => r.json()).then((j: { courses?: CourseRow[] }) => setCourses(j.courses ?? [])).catch(() => setCourses([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const switchTab = (t: 'courses' | 'sessions') => {
    setTab(t);
    router.replace(t === 'sessions' ? '/admin/training-hub/live-training?tab=sessions' : '/admin/training-hub/live-training');
  };

  async function create() {
    setError('');
    const r = await fetch('/api/admin/live-course', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseCode: newCode, title: newTitle }) });
    const j = await r.json() as { courseCode?: string; error?: string };
    if (!r.ok) { setError(j.error ?? 'Could not create the course.'); return; }
    router.push(`/admin/training-hub/live-training/${j.courseCode}`);
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/live-training" />
      <main data-testid="admin-live-training" style={{ flex: 1, padding: 36, overflowY: 'auto', color: '#2A3440' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0D2E5A', margin: '0 0 4px' }}>Live Training</h1>
        <p style={{ color: SLATE, fontSize: 13, margin: '0 0 18px' }}>Live courses (several sessions, attendance, certificate) and single live sessions.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `2px solid ${PALE}` }}>
          {(['courses', 'sessions'] as const).map((t) => (
            <button key={t} data-testid={`live-training-tab-${t}`} onClick={() => switchTab(t)} style={{ padding: '10px 18px', border: 'none', borderBottom: tab === t ? `3px solid ${NAVY}` : '3px solid transparent', background: 'none', color: tab === t ? NAVY : SLATE, fontWeight: 800, fontSize: 14, cursor: 'pointer', marginBottom: -2 }}>
              {t === 'courses' ? 'Courses' : 'Single sessions'}
            </button>
          ))}
        </div>

        {tab === 'sessions' && <LiveSessionsManager embedded />}

        {tab === 'courses' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button data-testid="new-course" style={btnPrimary} onClick={() => setCreating((c) => !c)}>+ New course</button>
            </div>
            {creating && (
              <div style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: 16, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>Code<br />
                  <input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="REFM2" maxLength={12} style={{ padding: 8, borderRadius: 6, border: '1px solid #CBD5E1', width: 120 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 700, color: NAVY, flex: 1, minWidth: 260 }}>Title<br />
                  <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Course title" style={{ padding: 8, borderRadius: 6, border: '1px solid #CBD5E1', width: '100%' }} />
                </label>
                <button style={btnPrimary} onClick={create} disabled={!newCode || !newTitle}>Create as draft</button>
                {error && <div style={{ color: '#B91C1C', fontSize: 13, width: '100%' }}>{error}</div>}
                <div style={{ fontSize: 11.5, color: SLATE, width: '100%' }}>The code is permanent (it names the certificate ID and template files). A new course starts as a draft, hidden from the public.</div>
              </div>
            )}
            {!courses && <div style={{ color: SLATE }}>Loading…</div>}
            {courses && (
              <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
                <thead><tr><th style={th}>Course</th><th style={th}>Status</th><th style={th}>Sessions</th><th style={th}>Enrolled</th><th style={th}>Next session</th><th style={th}></th></tr></thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.courseCode} data-testid="admin-course-row">
                      <td style={td}><strong>{c.title}</strong><div style={{ color: SLATE, fontSize: 11.5 }}>{c.courseCode}</div></td>
                      <td style={td}><StatusBadge status={c.status} enrolmentOpen={c.enrolmentOpen} /></td>
                      <td style={td}>{c.sessionCount}</td>
                      <td style={td}>{c.enrolledCount}</td>
                      <td style={td}>{c.nextSessionAt ? formatSessionTime(c.nextSessionAt) : <span style={{ color: SLATE }}>none scheduled</span>}</td>
                      <td style={td}><Link href={`/admin/training-hub/live-training/${c.courseCode}`} style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>Open</Link></td>
                    </tr>
                  ))}
                  {courses.length === 0 && <tr><td style={{ ...td, color: SLATE }} colSpan={6}>No live courses yet.</td></tr>}
                </tbody>
              </table>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function LiveTrainingPage() {
  return <Suspense fallback={null}><LiveTrainingInner /></Suspense>;
}
