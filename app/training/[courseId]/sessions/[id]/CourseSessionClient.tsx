'use client';

/**
 * A live course session's page (2026-11-08), in the course shell (left
 * sidebar). Public facts come from the server; a signed-in student's
 * enrolment, join link, materials and progress come from the course API
 * (the same view the overview reads). The main button, the status and
 * previous / next follow liveCourse/courseNav.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { LiveCourseSettings, CourseSession } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import type { CourseView } from '@/src/hubs/training/lib/liveCourse/courseView';
import { courseTimeLabel } from '@/src/hubs/training/lib/liveCourse/time';
import { courseSessionPath, coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { navStatus, prevNext, sessionMainAction, sessionLabel, STATUS_LABEL } from '@/src/hubs/training/lib/liveCourse/courseNav';
import { sessionCertificateAvailable } from '@/src/hubs/training/lib/liveCourse/sessionCertificate';
import { CourseShell } from '@/src/hubs/training/components/sessions/CourseShell';
import { CourseSessionAction } from '@/src/hubs/training/components/sessions/CourseSessionAction';
import { TimeZoneTable } from '@/src/hubs/training/components/sessions/TimeZoneTable';
import { SessionCertificateButton } from '@/src/hubs/training/components/sessions/SessionCertificateButton';
import { YouTubeSubscribeCta } from '@/src/hubs/training/components/sessions/YouTubeSubscribeCta';
import { RECORDINGS_COUNT_LINE } from '@/src/hubs/training/lib/liveCourse/pageSections';
import { SessionProgress } from '../../../live-course/[code]/LiveCourseClient';
import { SessionContentSections } from '@/src/hubs/training/components/sessions/SessionContentSections';
import { sessionSections } from '@/src/hubs/training/lib/liveCourse/sessionContent';
import { CourseTime } from '@/src/hubs/training/components/sessions/CourseTime';

const NAVY = '#0D2E5A';
const BLUE = '#1B4F8A';
const SLATE = '#5A6675';
const INK = '#2A3440';
const GREEN = '#2E7D52';
const PALE = '#E8EEF7';

export function CourseSessionClient({ course, sessions, sessionId, signedIn, canRegister, now }: {
  course: LiveCourseSettings;
  sessions: CourseSession[];
  sessionId: string;
  signedIn: boolean;
  canRegister: boolean;
  now: number;
}) {
  const [view, setView] = useState<CourseView | null>(null);
  const load = useCallback(async () => {
    if (!signedIn) return;
    const r = await fetch(`/api/training/live-course/${encodeURIComponent(course.courseCode)}`);
    if (r.ok) setView(await r.json() as CourseView);
  }, [course.courseCode, signedIn]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);

  const s = sessions.find((x) => x.id === sessionId)!;
  const vs = view?.sessions.find((x) => x.id === sessionId);
  const enrolled = !!view?.enrolled;
  const status = navStatus(s, now);
  const action = sessionMainAction({ courseCode: course.courseCode, sessionId, status, enrolled, signedIn, canRegister, recordingLocked: vs?.recordingLock?.unlocked === false ? vs.recordingLock.message : null });
  const { prev, next } = prevNext(sessions, sessionId);
  const e = view?.eligibility.sessions.find((x) => x.sessionId === sessionId);
  const completed = new Set((view?.eligibility.sessions ?? []).filter((x) => x.met).map((x) => x.sessionId));
  const image = s.banner_url || course.cardImageUrl;
  // THE content reader: the lists (mig 253), or the older fields mapped in.
  const sections = sessionSections(s);

  const block = (title: string, body: React.ReactNode, testid: string) => (
    <section data-testid={testid} style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>{title}</h2>
      {body}
    </section>
  );

  const button = (() => {
    const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '12px 24px', borderRadius: 10, fontWeight: 800, fontSize: 14.5, textDecoration: 'none' };
    // Enrolled, before or during the session: Join live in its window, else Enrolled + date + Add to calendar.
    if (action.kind === 'join') return <CourseSessionAction courseCode={course.courseCode} enrolled signedIn={signedIn} joinUrl={vs?.joinUrl ?? null} joinOpensAt={vs?.joinOpensAt ?? null} joinClosesAt={vs?.joinClosesAt ?? null} scheduledIso={s.scheduled_datetime} studentName={view?.student.name ?? null} />;
    if (action.href) return <Link data-testid="session-main-action" data-action={action.kind} href={action.href} style={{ ...base, background: action.kind === 'watch' ? BLUE : GREEN, color: '#fff' }}>{action.kind === 'watch' ? '▶ ' : ''}{action.label}</Link>;
    return <span data-testid="session-main-action" data-action={action.kind} style={{ ...base, background: action.kind === 'locked' ? '#FFF7ED' : '#F1F3F5', color: action.kind === 'locked' ? '#9A5B00' : SLATE }}>{action.kind === 'locked' ? '🔒 ' : ''}{action.label}</span>;
  })();

  return (
    <div data-testid="course-session-page" style={{ padding: '24px 16px 48px', maxWidth: 1240, margin: '0 auto', color: INK }}>
      <CourseShell courseCode={course.courseCode} courseTitle={course.title} sessions={sessions} current={sessionId} completed={completed} now={now}>
        <article style={{ maxWidth: 860 }}>
          {image && (
            <div style={{ aspectRatio: '16 / 9', background: '#E8EEF7', borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-testid="course-session-image" src={image} alt={s.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </div>
          )}
          {/* Order (founder, 2026-11-10): image, number and status, title, time, button, content. */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: BLUE, fontSize: 14 }}>{sessionLabel(s)}{s.course_session_no != null ? ` of ${sessions.length}` : ''}</span>
            <span data-testid="course-session-status" data-status={status} style={{ fontSize: 11.5, fontWeight: 800, borderRadius: 12, padding: '3px 9px', background: status === 'live' ? '#E7F4EC' : status === 'rescheduled' ? '#FFF4E5' : '#EEF3FA', color: status === 'live' ? GREEN : status === 'rescheduled' ? '#9A5B00' : BLUE }}>{STATUS_LABEL[status]}</span>
          </div>
          {/* Smaller than a page title: the image already shows it. */}
          <h1 data-testid="course-session-title" style={{ fontSize: 'clamp(18px,2.2vw,22px)', fontWeight: 800, color: NAVY, margin: '6px 0 4px', lineHeight: 1.3 }}>{s.title}</h1>
          <div style={{ fontSize: 14.5, color: SLATE }}>
            <CourseTime iso={s.scheduled_datetime} />
            {s.rescheduled_from && <span style={{ marginLeft: 8, color: '#9A5B00', fontWeight: 700 }}>(rescheduled, was {courseTimeLabel(s.rescheduled_from)})</span>}
          </div>
          {s.scheduled_datetime && <TimeZoneTable iso={s.scheduled_datetime} zones={course.timeZones} collapsible />}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '18px 0 4px' }}>
            {button}
            {!enrolled && signedIn === false && canRegister && (
              <a href={`/signin?redirect=${encodeURIComponent(`${coursePagePath(course.courseCode)}?enrol=1`)}`} style={{ color: BLUE, fontSize: 13.5, fontWeight: 700 }}>Already have an account? Sign in to enrol</a>
            )}
            {enrolled && e && <SessionProgress e={e} course={view!.course} />}
          </div>
          {!enrolled && canRegister && course.certRoutes.includes('recording') && (
            <div data-testid="session-recordings-note" style={{ fontSize: 13, fontWeight: 600, color: SLATE, marginTop: 6 }}>{RECORDINGS_COUNT_LINE}</div>
          )}

          {view && enrolled && e && sessionCertificateAvailable(view.course, e) && (
            <div data-testid="course-session-certificate" style={{ marginTop: 16, background: '#E7F4EC', border: '1px solid #B7DFC5', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ color: GREEN }}>🏅 You earned this session&apos;s certificate</strong>
              <SessionCertificateButton session={s} studentName={view.student.name} registrationId={view.student.registrationId} courseTitle={view.course.title}
                courseCode={course.courseCode} sessionCount={sessions.length} via={e.via} />
              <div style={{ flexBasis: '100%' }}><YouTubeSubscribeCta compact /></div>
            </div>
          )}

          <SessionContentSections sections={sections} />

          {block('Materials', enrolled && vs?.recordingLock?.unlocked === false && vs.materialsReleased ? (
            <p data-testid="course-session-materials-locked" style={{ margin: 0, fontSize: 14, color: '#9A5B00' }}>🔒 {vs.recordingLock.message}: the materials unlock with the recording.</p>
          ) : enrolled && vs?.materialsReleased && vs.materials.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {vs.materials.map((m) => (
                <li key={m.id}>{m.url ? <a href={m.url} style={{ color: BLUE, fontWeight: 700 }}>⬇ {m.fileName}</a> : <span>{m.fileName}</span>}</li>
              ))}
            </ul>
          ) : (
            <p data-testid="course-session-materials-later" style={{ margin: 0, fontSize: 14, color: SLATE }}>
              {enrolled ? 'Materials will be available after the session.' : 'Materials are available to enrolled students after the session.'}
            </p>
          ), 'course-session-materials')}

          <nav data-testid="course-session-prevnext" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 32, paddingTop: 18, borderTop: `1px solid ${PALE}`, flexWrap: 'wrap' }}>
            {prev ? <Link prefetch data-testid="course-session-prev" href={courseSessionPath(course.courseCode, prev.id)} style={{ color: BLUE, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>← {sessionLabel(prev)}: {prev.title}</Link> : <Link prefetch data-testid="course-session-overview-link" href={coursePagePath(course.courseCode)} style={{ color: BLUE, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>← Course overview</Link>}
            {next && <Link prefetch data-testid="course-session-next" href={courseSessionPath(course.courseCode, next.id)} style={{ color: BLUE, fontWeight: 800, textDecoration: 'none', fontSize: 14, marginLeft: 'auto', textAlign: 'right' }}>{sessionLabel(next)}: {next.title} →</Link>}
          </nav>
        </article>
      </CourseShell>
    </div>
  );
}
