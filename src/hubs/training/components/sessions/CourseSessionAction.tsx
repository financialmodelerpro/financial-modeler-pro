'use client';

/**
 * THE button for a live-course session (2026-11-10, founder). A course
 * session has NO registration of its own: enrolling in the course registers
 * the student for every session, including ones added or rescheduled later.
 *
 *   not enrolled              "Enrol in course" (signed in: the course page,
 *                             which enrols on arrival; signed out: account +
 *                             enrolment in one step), or "Enrolment closed"
 *   enrolled, join window     "Join live" (THE Join button, with the name note)
 *   enrolled, otherwise       "Enrolled" with the date and "Add to calendar"
 *                             (the course calendar file, all sessions)
 *
 * Used by the dashboard cards, Live Sessions, the course session page and the
 * session player page. Single sessions keep their own registration.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { joinStateAt } from '@/src/hubs/training/lib/liveCourse/joinWindow';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { JoinLiveButton } from './JoinLiveButton';
import { CourseTime } from './CourseTime';

export interface CourseSessionActionProps {
  courseCode: string;
  enrolled: boolean;
  signedIn: boolean;
  /** False when the course is closed to new students. */
  canRegister?: boolean;
  /** The logged join route (null until a meeting link exists, or when not enrolled). */
  joinUrl: string | null;
  joinOpensAt: string | null;
  joinClosesAt: string | null;
  scheduledIso: string | null;
  studentName?: string | null;
  size?: 'sm' | 'md';
}

/** "Enrol in course" target: the course page enrols a signed-in student; a visitor registers with the course. */
export function enrolHref(courseCode: string, signedIn: boolean): string {
  return signedIn ? `${coursePagePath(courseCode)}?enrol=1` : `/register?course=${encodeURIComponent(courseCode)}`;
}

export function courseCalendarHref(courseCode: string): string {
  return `/api/training/live-course/${encodeURIComponent(courseCode)}/calendar`;
}

export function CourseSessionAction(p: CourseSessionActionProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t); }, []);
  const pad = p.size === 'sm' ? '8px 14px' : '11px 22px';
  const font = p.size === 'sm' ? 12.5 : 14;

  if (!p.enrolled) {
    if (p.canRegister === false) {
      return <span data-testid="course-session-action" data-action="closed" style={{ display: 'inline-block', padding: pad, borderRadius: 8, background: '#F1F3F5', color: '#5A6675', fontWeight: 700, fontSize: font }}>Enrolment closed</span>;
    }
    return (
      <Link data-testid="course-session-action" data-action="enrol" href={enrolHref(p.courseCode, p.signedIn)}
        style={{ display: 'inline-flex', alignItems: 'center', padding: pad, borderRadius: 8, background: '#2E7D52', color: '#fff', fontWeight: 800, fontSize: font, textDecoration: 'none' }}>
        Enrol in course
      </Link>
    );
  }

  const window = p.joinOpensAt && p.joinClosesAt ? { opensAt: p.joinOpensAt, closesAt: p.joinClosesAt, startsAt: p.joinOpensAt } : null;
  if (p.joinUrl && joinStateAt(now, window) === 'open') {
    return <JoinLiveButton joinUrl={p.joinUrl} joinOpensAt={p.joinOpensAt} joinClosesAt={p.joinClosesAt} studentName={p.studentName} size={p.size} />;
  }
  return (
    <span data-testid="course-session-action" data-action="enrolled" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: font }}>
      <span style={{ display: 'inline-block', padding: pad, borderRadius: 8, background: '#E7F4EC', color: '#2E7D52', fontWeight: 800 }}>✓ Enrolled</span>
      {p.scheduledIso && <span style={{ color: '#2A3440' }}><CourseTime iso={p.scheduledIso} /></span>}
      <a data-testid="course-session-calendar" href={courseCalendarHref(p.courseCode)} style={{ color: '#1B4F8A', fontWeight: 700, textDecoration: 'none' }}>📅 Add to calendar</a>
    </span>
  );
}
