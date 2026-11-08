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
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import { courseSessionPath, coursePagePath, courseEyebrow } from '@/src/hubs/training/lib/liveCourse/paths';
import { navStatus, prevNext, sessionMainAction, sessionLabel, STATUS_LABEL } from '@/src/hubs/training/lib/liveCourse/courseNav';
import { sessionCertificateAvailable } from '@/src/hubs/training/lib/liveCourse/sessionCertificate';
import { CourseShell } from '@/src/hubs/training/components/sessions/CourseShell';
import { JoinLiveButton } from '@/src/hubs/training/components/sessions/JoinLiveButton';
import { TimeZoneTable } from '@/src/hubs/training/components/sessions/TimeZoneTable';
import { SessionCertificateButton } from '@/src/hubs/training/components/sessions/SessionCertificateButton';
import { SessionProgress } from '../../../live-course/[code]/LiveCourseClient';

const NAVY = '#0D2E5A';
const BLUE = '#1B4F8A';
const GOLD = '#C9A84C';
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
  const action = sessionMainAction({ courseCode: course.courseCode, sessionId, status, enrolled, signedIn, canRegister });
  const { prev, next } = prevNext(sessions, sessionId);
  const e = view?.eligibility.sessions.find((x) => x.sessionId === sessionId);
  const completed = new Set((view?.eligibility.sessions ?? []).filter((x) => x.met).map((x) => x.sessionId));
  const image = s.banner_url || course.cardImageUrl;
  const learn = (s.content_learn ?? []).filter((x) => x && x.trim());

  const block = (title: string, body: React.ReactNode, testid: string) => (
    <section data-testid={testid} style={{ marginTop: 22 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 8px' }}>{title}</h2>
      {body}
    </section>
  );

  const button = (() => {
    const base: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '12px 24px', borderRadius: 10, fontWeight: 800, fontSize: 14.5, textDecoration: 'none' };
    if (action.kind === 'join') return <JoinLiveButton joinUrl={vs?.joinUrl ?? null} joinOpensAt={vs?.joinOpensAt ?? null} joinClosesAt={vs?.joinClosesAt ?? null} />;
    if (action.href) return <Link data-testid="session-main-action" data-action={action.kind} href={action.href} style={{ ...base, background: action.kind === 'watch' ? BLUE : GREEN, color: '#fff' }}>{action.kind === 'watch' ? '▶ ' : ''}{action.label}</Link>;
    return <span data-testid="session-main-action" data-action={action.kind} style={{ ...base, background: '#F1F3F5', color: SLATE }}>{action.label}</span>;
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
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, fontWeight: 800 }}>{courseEyebrow(course.shortTitle)}</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ fontWeight: 800, color: BLUE, fontSize: 14 }}>{sessionLabel(s)}{s.course_session_no != null ? ` of ${sessions.length}` : ''}</span>
            <span data-testid="course-session-status" data-status={status} style={{ fontSize: 11.5, fontWeight: 800, borderRadius: 12, padding: '3px 9px', background: status === 'live' ? '#E7F4EC' : status === 'rescheduled' ? '#FFF4E5' : '#EEF3FA', color: status === 'live' ? GREEN : status === 'rescheduled' ? '#9A5B00' : BLUE }}>{STATUS_LABEL[status]}</span>
          </div>
          <h1 style={{ fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 800, color: NAVY, margin: '6px 0 6px', lineHeight: 1.2 }}>{s.title}</h1>
          <div style={{ fontSize: 14.5, color: SLATE }}>
            {formatSessionTime(s.scheduled_datetime)}
            {s.rescheduled_from && <span style={{ marginLeft: 8, color: '#9A5B00', fontWeight: 700 }}>(rescheduled, was {formatSessionTime(s.rescheduled_from)})</span>}
          </div>
          {s.scheduled_datetime && <TimeZoneTable iso={s.scheduled_datetime} zones={course.timeZones} collapsible />}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '18px 0 4px' }}>
            {button}
            {!enrolled && signedIn === false && canRegister && (
              <a href={`/signin?redirect=${encodeURIComponent(`${coursePagePath(course.courseCode)}?enrol=1`)}`} style={{ color: BLUE, fontSize: 13.5, fontWeight: 700 }}>Already have an account? Sign in to enrol</a>
            )}
            {enrolled && e && <SessionProgress e={e} course={view!.course} />}
          </div>

          {view && enrolled && e && sessionCertificateAvailable(view.course, e) && (
            <div data-testid="course-session-certificate" style={{ marginTop: 16, background: '#E7F4EC', border: '1px solid #B7DFC5', borderRadius: 12, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ color: GREEN }}>🏅 You earned this session&apos;s certificate</strong>
              <SessionCertificateButton session={s} studentName={view.student.name} registrationId={view.student.registrationId} courseTitle={view.course.title} />
            </div>
          )}

          {s.content_overview && block('Overview', <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7 }}>{s.content_overview}</p>, 'course-session-overview')}
          {learn.length > 0 && block('What you will learn', <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 15, lineHeight: 1.6 }}>{learn.map((x, i) => <li key={i}>{x}</li>)}</ul>, 'course-session-learn')}
          {s.content_outcome && block('By the end of this session', <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7 }}>{s.content_outcome}</p>, 'course-session-outcome')}
          {s.content_claude && block('Build with Claude', <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7 }}>{s.content_claude}</p>, 'course-session-claude')}

          {block('Materials', enrolled && vs?.materialsReleased && vs.materials.length > 0 ? (
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
            {prev ? <Link data-testid="course-session-prev" href={courseSessionPath(course.courseCode, prev.id)} style={{ color: BLUE, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>← {sessionLabel(prev)}: {prev.title}</Link> : <Link href={coursePagePath(course.courseCode)} style={{ color: BLUE, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>← Course overview</Link>}
            {next && <Link data-testid="course-session-next" href={courseSessionPath(course.courseCode, next.id)} style={{ color: BLUE, fontWeight: 800, textDecoration: 'none', fontSize: 14, marginLeft: 'auto', textAlign: 'right' }}>{sessionLabel(next)}: {next.title} →</Link>}
          </nav>
        </article>
      </CourseShell>
    </div>
  );
}
