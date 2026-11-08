'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TrainingShell } from '@/src/hubs/training/components/TrainingShell';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import type { CourseView } from '@/src/hubs/training/lib/liveCourse/courseView';
import { JoinLiveButton } from '@/src/hubs/training/components/sessions/JoinLiveButton';

const NAVY = '#1B4F8A';
const INK = '#2A3440';
const SLATE = '#5A6675';
const GREEN = '#2E7D52';
const PALE = '#E8EEF7';

export function LiveCourseClient({ courseCode, autoEnrol }: { courseCode: string; autoEnrol: boolean }) {
  const [view, setView] = useState<CourseView | null>(null);
  const [error, setError] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [notice, setNotice] = useState('');
  const autoTried = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/training/live-course/${encodeURIComponent(courseCode)}`);
    if (r.status === 401) { window.location.href = `/signin?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`; return null; }
    if (!r.ok) { setError('This course could not be found.'); return null; }
    const v = await r.json() as CourseView;
    setView(v);
    return v;
  }, [courseCode]);

  const enrol = useCallback(async (from: 'dashboard' | 'public_page') => {
    setEnrolling(true); setNotice('');
    try {
      const r = await fetch('/api/training/enroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseCode, from }),
      });
      const j = await r.json() as { ok?: boolean; emailSent?: boolean; error?: string };
      if (!r.ok || !j.ok) { setNotice(j.error ?? 'Enrolment failed. Please try again.'); return; }
      setNotice(j.emailSent ? 'You are enrolled. A confirmation email with the schedule is on its way.' : 'You are enrolled.');
      await load();
    } finally { setEnrolling(false); }
  }, [courseCode, load]);

  useEffect(() => {
    void (async () => {
      const v = await load();
      // Arrived from the public page's sign-in link: enrol in one step.
      if (v && autoEnrol && !v.enrolled && !autoTried.current) {
        autoTried.current = true;
        await enrol('public_page');
      }
      if (autoEnrol) window.history.replaceState(null, '', window.location.pathname);
    })();
  }, [load, enrol, autoEnrol]);

  return (
    <TrainingShell activeNav="dashboard">
      <div data-testid="live-course-page" style={{ padding: '24px 20px 48px', maxWidth: 980, margin: '0 auto', color: INK }}>
        {error && <div style={{ padding: 16, background: '#FEF2F2', borderRadius: 8, color: '#B91C1C' }}>{error}</div>}
        {!view && !error && <div style={{ color: SLATE }}>Loading…</div>}
        {view && (
          <>
            <div style={{ background: `linear-gradient(135deg, #0D2E5A, ${NAVY})`, color: '#fff', borderRadius: 12, padding: '24px 28px', marginBottom: 20 }}>
              <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.8 }}>Live course</div>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 8px' }}>{view.course.title}</h1>
              <p style={{ margin: 0, opacity: 0.9, fontSize: 14 }}>{view.course.description}</p>
              <div style={{ marginTop: 16 }}>
                {view.enrolled ? (
                  <span data-testid="live-course-enrolled" style={{ display: 'inline-block', background: GREEN, padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>✓ Enrolled</span>
                ) : (
                  <button
                    data-testid="live-course-enrol"
                    onClick={() => enrol('dashboard')}
                    disabled={enrolling}
                    style={{ background: '#fff', color: NAVY, border: 'none', borderRadius: 8, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: enrolling ? 'wait' : 'pointer' }}
                  >{enrolling ? 'Enrolling…' : 'Enrol in this course'}</button>
                )}
              </div>
              {notice && <div data-testid="live-course-notice" style={{ marginTop: 12, fontSize: 13 }}>{notice}</div>}
            </div>

            {view.enrolled && <ProgressSummary view={view} />}

            <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>Sessions</h2>
            {view.sessions.length === 0 && <div style={{ color: SLATE, fontSize: 14 }}>The schedule will appear here as sessions are announced.</div>}
            <div style={{ display: 'grid', gap: 10 }}>
              {view.sessions.map((s) => (
                <div key={s.id} data-testid="live-course-session" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ width: 84, fontWeight: 800, color: NAVY, fontSize: 13 }}>{s.course_session_no != null ? `Session ${s.course_session_no}` : 'Session'}</div>
                  <div style={{ flex: '1 1 260px' }}>
                    <div style={{ fontWeight: 700 }}>{s.title}</div>
                    <div style={{ fontSize: 13, color: SLATE }}>{formatSessionTime(s.scheduled_datetime)}</div>
                  </div>
                  {view.enrolled && s.state !== 'recorded' && (
                    <JoinLiveButton joinUrl={s.joinUrl} joinOpensAt={s.joinOpensAt} joinClosesAt={s.joinClosesAt} size="sm" />
                  )}
                  {view.enrolled && s.youtube_url && (
                    // The session player tracks skip-resistant watch time for the recording route.
                    <a data-testid="watch-recording" href={`/training/live-sessions/${s.id}`} style={{ padding: '8px 14px', borderRadius: 8, border: `1.5px solid ${NAVY}`, color: NAVY, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>▶ Watch recording</a>
                  )}
                  {view.enrolled && <SessionProgress e={view.eligibility.sessions.find((x) => x.sessionId === s.id)} course={view.course} />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </TrainingShell>
  );
}

type SessionElig = CourseView['eligibility']['sessions'][number];

/** One session's status: met live, met by recording, or what is still needed. */
function SessionProgress({ e, course }: { e: SessionElig | undefined; course: CourseView['course'] }) {
  if (!e) return null;
  const chip = (bg: string, fg: string, text: string, testid: string) => (
    <span data-testid={testid} style={{ background: bg, color: fg, borderRadius: 14, padding: '4px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>
  );
  if (e.via === 'live') return chip('#E7F4EC', GREEN, `✓ Attended live (${e.livePct.toFixed(0)}%)`, 'session-met-live');
  if (e.via === 'recording') return chip('#E7F4EC', GREEN, `✓ Recording watched (${e.recordingPct.toFixed(0)}%)`, 'session-met-recording');
  if (!e.held) return chip('#F1F3F5', SLATE, 'Not held yet', 'session-pending');
  const parts: string[] = [];
  if (course.certRoutes.includes('live')) parts.push(`live ${e.livePct.toFixed(0)}% of ${course.attendanceThresholdPct}%`);
  if (course.certRoutes.includes('recording')) parts.push(e.hasRecording ? `recording ${e.recordingPct.toFixed(0)}% of ${course.recordingCompletePct}%` : 'recording not uploaded yet');
  return chip('#FFF4E5', '#9A5B00', parts.join(' · '), 'session-not-met');
}

/** Overall progress and whether the model submission is unlocked. */
function ProgressSummary({ view }: { view: CourseView }) {
  const e = view.eligibility;
  const total = e.sessions.length;
  const pct = total ? Math.round((e.sessionsMet / total) * 100) : 0;
  const routeText = e.routeCompleted === 'live' ? 'Live attendance route complete'
    : e.routeCompleted === 'recording' ? 'Recordings route complete'
    : e.routeCompleted === 'mixed' ? 'All sessions complete (live and recordings)' : null;
  return (
    <div data-testid="live-course-progress" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <strong style={{ color: NAVY }}>Your progress: {e.sessionsMet} of {total} sessions complete</strong>
        {routeText
          ? <span data-testid="route-complete" style={{ color: GREEN, fontWeight: 700, fontSize: 13 }}>✓ {routeText}</span>
          : <span style={{ color: SLATE, fontSize: 13 }}>Attend at least {view.course.attendanceThresholdPct}% of each session live, or watch its recording in full.</span>}
      </div>
      <div style={{ height: 8, background: PALE, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: GREEN }} />
      </div>
      <div data-testid={e.submissionUnlocked ? 'submission-unlocked' : 'submission-locked'} style={{ marginTop: 10, fontSize: 13, color: e.submissionUnlocked ? GREEN : SLATE }}>
        {e.submissionUnlocked ? 'Model submission is unlocked.' : 'Model submission unlocks once every session is complete.'}
      </div>
    </div>
  );
}
