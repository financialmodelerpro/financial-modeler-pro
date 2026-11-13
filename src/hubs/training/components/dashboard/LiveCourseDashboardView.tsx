'use client';

/**
 * A live course inside the student dashboard (2026-11-10, founder), in the
 * same place 3SFM and BVM open (My Courses). Every session is listed from the
 * start, in order; a recording appears on its own session once uploaded (a
 * session never "moves" anywhere).
 *
 *   top:      Enrol free (not enrolled) or progress (sessions completed / total)
 *   per row:  number, title, "Tue 1 Dec, 7:00 PM KSA (9:00 PM your time)",
 *             status (Upcoming, Live now, Recording available, Locked,
 *             Completed, or Recording coming soon), an expandable "What's in
 *             this session" (Overview, What you will learn, Session flow) with
 *             a link to the full session page, the button, and materials once
 *             the session ends (enrolled, and unlocked like the recording).
 *
 * Data: the course API (courseView.ts), the one status (courseNav.ts), the one
 * unlock rule (recordingAccess.ts, carried as `recordingLock`), the one button
 * (CourseSessionAction), the one content reader (sessionContent.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CourseView } from '@/src/hubs/training/lib/liveCourse/courseView';
import { navStatus, orderSessions, sessionMainAction, sessionLabel } from '@/src/hubs/training/lib/liveCourse/courseNav';
import { courseSessionPath, coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { sessionSections, emptySections } from '@/src/hubs/training/lib/liveCourse/sessionContent';
import { CourseSessionAction } from '@/src/hubs/training/components/sessions/CourseSessionAction';
import { CourseTime } from '@/src/hubs/training/components/sessions/CourseTime';
import { SessionContentSections } from '@/src/hubs/training/components/sessions/SessionContentSections';
import { SessionCertificateButton } from '@/src/hubs/training/components/sessions/SessionCertificateButton';
import { YouTubeSubscribeCta } from '@/src/hubs/training/components/sessions/YouTubeSubscribeCta';
import { sessionCertificateAvailable } from '@/src/hubs/training/lib/liveCourse/sessionCertificate';

const NAVY = '#0D2E5A';
const BLUE = '#1B4F8A';
const GREEN = '#2E7D52';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';

export type DashboardSessionStatus = 'upcoming' | 'live' | 'recording' | 'locked' | 'completed' | 'coming-soon';
export const DASHBOARD_STATUS_LABEL: Record<DashboardSessionStatus, string> = {
  upcoming: 'Upcoming', live: 'Live now', recording: 'Recording available', locked: 'Locked', completed: 'Completed', 'coming-soon': 'Recording coming soon',
};

/** The row status. Pure: completed (the session's rule met) wins, then the recording and its lock. */
export function dashboardSessionStatus(p: { nav: ReturnType<typeof navStatus>; met: boolean; enrolled: boolean; locked: boolean }): DashboardSessionStatus {
  if (p.enrolled && p.met) return 'completed';
  if (p.nav === 'live') return 'live';
  if (p.nav === 'recorded') return p.enrolled && p.locked ? 'locked' : 'recording';
  if (p.nav === 'ended') return 'coming-soon';
  return 'upcoming';
}

const STATUS_STYLE: Record<DashboardSessionStatus, { bg: string; fg: string }> = {
  upcoming: { bg: '#EEF3FA', fg: BLUE }, live: { bg: '#FEE2E2', fg: '#B91C1C' }, recording: { bg: '#E0F2FE', fg: '#075985' },
  locked: { bg: '#FFF7ED', fg: '#9A5B00' }, completed: { bg: '#E7F4EC', fg: GREEN }, 'coming-soon': { bg: '#F1F3F5', fg: SLATE },
};

export function LiveCourseDashboardView({ courseCode, onEnrolled }: { courseCode: string; onEnrolled?: () => void }) {
  const [view, setView] = useState<CourseView | null>(null);
  const [error, setError] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    const r = await fetch(`/api/training/live-course/${encodeURIComponent(courseCode)}`);
    if (r.ok) { setView(await r.json() as CourseView); setError(''); } else setError('This course is not available.');
  }, [courseCode]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  async function enrol() {
    setEnrolling(true);
    try {
      const r = await fetch('/api/training/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseCode, from: 'dashboard' }) });
      if (r.ok) { await load(); onEnrolled?.(); } else setError('Enrolment failed. Please try again.');
    } finally { setEnrolling(false); }
  }

  if (error && !view) return <div style={{ padding: 24, color: SLATE }}>{error}</div>;
  if (!view) return <div style={{ padding: 24, color: SLATE }}>Loading…</div>;

  const { course, enrolled, eligibility } = view;
  const met = new Map(eligibility.sessions.map((e) => [e.sessionId, e.met]));
  const sessions = orderSessions(view.sessions);
  const completed = eligibility.sessions.filter((e) => e.met).length;
  const canRegister = course.status === 'published' && course.enrolmentOpen;

  return (
    <div data-testid="live-course-dashboard" style={{ color: '#2A3440' }}>
      <div style={{ background: `linear-gradient(135deg, ${NAVY}, ${BLUE})`, color: '#fff', borderRadius: 14, padding: '20px 22px', marginBottom: 18, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.8, fontWeight: 800 }}>Live course</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 4px' }}>{course.title}</h1>
          {course.tagline && <div style={{ fontSize: 13.5, opacity: 0.9 }}>{course.tagline}</div>}
        </div>
        {enrolled ? (
          <div data-testid="live-course-dashboard-progress" style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{completed}/{sessions.length}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>sessions completed</div>
          </div>
        ) : canRegister ? (
          <button data-testid="live-course-dashboard-enrol" onClick={enrol} disabled={enrolling}
            style={{ background: '#fff', color: NAVY, border: 'none', borderRadius: 10, padding: '12px 24px', fontWeight: 800, fontSize: 15, cursor: enrolling ? 'wait' : 'pointer' }}>
            {enrolling ? 'Enrolling…' : 'Enrol free'}
          </button>
        ) : <span style={{ fontWeight: 700 }}>Enrolment closed</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <Link href={coursePagePath(course.courseCode)} style={{ color: BLUE, fontSize: 13, fontWeight: 700 }}>Full course page →</Link>
      </div>

      <ol data-testid="live-course-dashboard-sessions" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {sessions.map((s) => {
          const nav = navStatus(s, now);
          const lock = s.recordingLock;
          const locked = lock?.unlocked === false;
          const status = dashboardSessionStatus({ nav, met: !!met.get(s.id), enrolled, locked });
          const action = sessionMainAction({ courseCode: course.courseCode, sessionId: s.id, status: nav, enrolled, signedIn: true, canRegister, recordingLocked: locked ? lock?.message : null });
          const sec = sessionSections(s);
          const preview = { ...emptySections(), overview: sec.overview, learnConcepts: sec.learnConcepts, learnHandsOn: sec.learnHandsOn, flow: sec.flow };
          const isOpen = open.has(s.id);
          const st = STATUS_STYLE[status];
          const button = action.kind === 'watch' && action.href
            ? <Link data-testid="dashboard-session-watch" href={action.href} style={{ display: 'inline-flex', padding: '8px 16px', borderRadius: 8, background: BLUE, color: '#fff', fontWeight: 800, fontSize: 13, textDecoration: 'none' }}>▶ Watch recording</Link>
            : action.kind === 'locked'
              ? <span data-testid="dashboard-session-locked" style={{ display: 'inline-block', padding: '8px 14px', borderRadius: 8, background: '#FFF7ED', color: '#9A5B00', fontWeight: 700, fontSize: 13 }}>🔒 {action.label}</span>
              : action.kind === 'recording-soon'
                ? <span style={{ fontSize: 13, color: SLATE }}>Recording coming soon</span>
                : <CourseSessionAction courseCode={course.courseCode} enrolled={enrolled} signedIn canRegister={canRegister} joinUrl={s.joinUrl} joinOpensAt={s.joinOpensAt} joinClosesAt={s.joinClosesAt} scheduledIso={s.scheduled_datetime} studentName={view.student.name} size="sm" />;
          return (
            <li key={s.id} data-testid="dashboard-course-session" data-status={status} style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: status === 'completed' ? GREEN : '#EEF3FA', color: status === 'completed' ? '#fff' : BLUE, display: 'grid', placeItems: 'center', fontWeight: 800 }}>{status === 'completed' ? '✓' : s.course_session_no ?? '•'}</span>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: BLUE }}>{sessionLabel(s)}</div>
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: NAVY, lineHeight: 1.35 }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: SLATE, marginTop: 2 }}><CourseTime iso={s.scheduled_datetime} /></div>
                </div>
                <span data-testid="dashboard-session-status" style={{ fontSize: 11.5, fontWeight: 800, borderRadius: 12, padding: '3px 10px', background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{DASHBOARD_STATUS_LABEL[status]}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, paddingLeft: 44 }}>
                {button}
                {/* The session certificate on every completed session (the one rule, sessionCertificate.ts). */}
                {enrolled && sessionCertificateAvailable(course, eligibility.sessions.find((x) => x.sessionId === s.id)) && (
                  <SessionCertificateButton session={s} studentName={view.student.name} registrationId={view.student.registrationId} courseTitle={course.title}
                    courseCode={course.courseCode} sessionCount={eligibility.sessions.length} via={eligibility.sessions.find((x) => x.sessionId === s.id)?.via ?? null} />
                )}
                <button type="button" data-testid="dashboard-session-toggle" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                  style={{ background: 'none', border: 'none', color: BLUE, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}>
                  {isOpen ? '▾' : '▸'} What&apos;s in this session
                </button>
              </div>
              {enrolled && status === 'completed' && (
                <div style={{ paddingLeft: 44 }}><YouTubeSubscribeCta compact /></div>
              )}
              {isOpen && (
                <div data-testid="dashboard-session-details" style={{ paddingLeft: 44, marginTop: 4 }}>
                  <SessionContentSections sections={preview} />
                  <Link href={courseSessionPath(course.courseCode, s.id)} style={{ display: 'inline-block', marginTop: 12, color: BLUE, fontWeight: 700, fontSize: 13 }}>Open the full session page →</Link>
                </div>
              )}
              {enrolled && s.materialsReleased && s.materials.length > 0 && (
                <div data-testid="dashboard-session-materials" style={{ paddingLeft: 44, marginTop: 10, fontSize: 13 }}>
                  <strong style={{ color: NAVY }}>Materials: </strong>
                  {locked
                    ? <span style={{ color: '#9A5B00' }}>unlock with the recording ({lock?.message})</span>
                    : s.materials.map((m, i) => <span key={m.id}>{i ? ' · ' : ''}{m.url ? <a href={m.url} style={{ color: BLUE, fontWeight: 700 }}>{m.fileName}</a> : m.fileName}</span>)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
