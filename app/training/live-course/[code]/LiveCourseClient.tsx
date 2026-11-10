'use client';

/**
 * The live course page. ONE page for everyone, laid out as the course's
 * landing page (CourseLanding + the sections in liveCourse/pageSections.ts):
 *   - a visitor (signed out): hero, side card, curriculum, skills, who it is
 *     for, certification, tools, instructor, testimonials, FAQ, call to action,
 *     for a published course or with an admin preview link;
 *   - a signed-in student: the same, plus Enrol, Join live, progress,
 *     recordings, materials, the model submission and the certificate.
 * The server page (page.tsx) decides visibility and the shell, and renders
 * the founder profile block and testimonials as slots.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CourseView } from '@/src/hubs/training/lib/liveCourse/courseView';
import type { LiveCourseSettings, CourseSession } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import type { CourseInstructor } from '@/src/hubs/training/lib/liveCourse/courseInstructors';
import type { PageConfig } from '@/src/hubs/training/lib/liveCourse/pageSections';
import { autoFacts, nextSession, scheduleFacts } from '@/src/hubs/training/lib/liveCourse/pageSections';
import { CourseLanding } from './CourseLanding';
import { CourseShell, CourseSessionsTable } from '@/src/hubs/training/components/sessions/CourseShell';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { LiveCourseSubmission } from '@/src/hubs/training/components/sessions/LiveCourseSubmission';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const GREEN = '#2E7D52';
const PALE = '#E8EEF7';

export interface PublicCourseData {
  course: LiveCourseSettings;
  sessions: CourseSession[];
  /** The course's instructors, read live from their profiles. */
  instructors: CourseInstructor[];
  /** True when shown through an admin preview link (course not public). */
  preview: boolean;
  /** A new student may register or enrol (published, enrolment open). */
  canRegister: boolean;
}

/** What the server adds for the landing layout (no secrets: shown to anyone who may open the page). */
export interface LandingInput {
  page: PageConfig;
  enrolledCount: number;
  samples: { certificateUrl: string | null; badgeUrl: string | null };
  testimonialCount: number;
  /** Server time for the session status labels. */
  now: number;
}

export function LiveCourseClient({ courseCode, autoEnrol, signedIn, publicData, landing, founderSlot, testimonialsSlot }: {
  courseCode: string;
  autoEnrol: boolean;
  signedIn: boolean;
  publicData: PublicCourseData | null;
  landing: LandingInput;
  /** THE founder profile block (server-rendered from the one CMS record), or null. */
  founderSlot: ReactNode;
  /** The picked testimonials (existing carousel), or null. */
  testimonialsSlot: ReactNode;
}) {
  const [view, setView] = useState<CourseView | null>(null);
  const [loaded, setLoaded] = useState(!signedIn);
  const [enrolling, setEnrolling] = useState(false);
  const [notice, setNotice] = useState('');
  const autoTried = useRef(false);

  const load = useCallback(async () => {
    if (!signedIn) return null;
    const r = await fetch(`/api/training/live-course/${encodeURIComponent(courseCode)}`);
    setLoaded(true);
    if (r.status === 401) { window.location.href = `/signin?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`; return null; }
    if (!r.ok) return null; // not enrolled in a non-public course: the public view (if any) stands
    const v = await r.json() as CourseView;
    setView(v);
    return v;
  }, [courseCode, signedIn]);

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

  const course = view?.course ?? publicData?.course ?? null;
  if (!loaded) return <div style={{ padding: 32, color: SLATE }}>Loading…</div>;
  if (!course) {
    return <div data-testid="live-course-not-found" style={{ padding: 32, color: SLATE }}>This course is not available.</div>;
  }

  const enrolled = !!view?.enrolled;
  const instructors = view?.instructors ?? publicData?.instructors ?? [];
  const sessions: (CourseSession & Partial<CourseView['sessions'][number]>)[] = view?.sessions ?? publicData?.sessions ?? [];
  const canRegister = publicData?.canRegister ?? (course.status === 'published' && course.enrolmentOpen);
  const enrolPath = `${coursePagePath(course.courseCode)}?enrol=1`;
  const next = nextSession(sessions);

  const makeAction = (dark: boolean): ReactNode => {
    if (enrolled) return <span data-testid="live-course-enrolled" style={{ display: 'inline-block', background: GREEN, color: '#fff', padding: '10px 18px', borderRadius: 22, fontSize: 14, fontWeight: 800 }}>✓ Enrolled</span>;
    if (!canRegister) return <span data-testid="live-course-enrolment-closed" style={{ display: 'inline-block', background: dark ? 'rgba(255,255,255,0.18)' : '#F1F3F5', color: dark ? '#fff' : SLATE, padding: '11px 20px', borderRadius: 8, fontSize: 14, fontWeight: 800 }}>{course.status === 'published' ? 'Enrolment closed' : 'Not open for registration'}</span>;
    if (signedIn) {
      return (
        <button data-testid="live-course-enrol" onClick={() => enrol('dashboard')} disabled={enrolling}
          style={{ background: dark ? '#fff' : NAVY, color: dark ? NAVY : '#fff', border: 'none', borderRadius: 10, padding: '13px 28px', fontWeight: 800, fontSize: 15, cursor: enrolling ? 'wait' : 'pointer' }}>
          {enrolling ? 'Enrolling…' : 'Enrol in this course'}
        </button>
      );
    }
    return (
      <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <a data-testid="live-course-register" href={`/register?course=${encodeURIComponent(course.courseCode)}`} style={{ background: '#2E7D52', color: '#fff', borderRadius: 10, padding: '13px 28px', fontWeight: 800, fontSize: 15, textDecoration: 'none' }}>Register free</a>
        {dark && <a href={`/signin?redirect=${encodeURIComponent(enrolPath)}`} style={{ color: '#fff', fontSize: 13.5, textDecoration: 'underline' }}>Already have an account? Sign in to enrol</a>}
      </span>
    );
  };

  const whoForCardsOn = landing.page.sections.whoFor.enabled && landing.page.sections.whoFor.items.length > 0;
  const about: { title: string; body: string }[] = [
    { title: 'About this course', body: course.description },
    ...(whoForCardsOn ? [] : [{ title: 'Who it is for', body: course.whoFor }]),
  ].filter((b) => b.body && b.body.trim());
  const otherInstructors = instructors.filter((i) => !i.isFounder);
  const hasFounder = instructors.some((i) => i.isFounder) && !!founderSlot;

  const instructorSlot = (hasFounder || otherInstructors.length > 0 || course.trainerName) ? (
    <>
      {hasFounder && founderSlot}
      {otherInstructors.length > 0 && (
        <div data-testid="live-course-instructors" style={{ display: 'grid', gap: 14, padding: hasFounder ? '20px 0 0' : 0 }}>
          {otherInstructors.map((i) => <InstructorCard key={i.id} i={i} />)}
        </div>
      )}
      {!hasFounder && otherInstructors.length === 0 && course.trainerName && (
        // Fallback: a course with no instructor picked shows its old free-text trainer.
        <p style={{ margin: 0, fontSize: 14.5 }}><strong>{course.trainerName}</strong>{course.trainerTitle ? `, ${course.trainerTitle}` : ''}</p>
      )}
    </>
  ) : null;

  // Sessions the student has completed (the attendance or recording rule met).
  const completed = new Set((view?.eligibility.sessions ?? []).filter((e) => e.met).map((e) => e.sessionId));
  const curriculum = (
    <>
      {enrolled && (
        <a data-testid="add-to-calendar" href={`/api/training/live-course/${encodeURIComponent(course.courseCode)}/calendar`} style={{ display: 'inline-block', marginBottom: 12, color: NAVY, fontWeight: 700, fontSize: 13.5 }}>📅 Add all sessions to your calendar (.ics)</a>
      )}
      <CourseSessionsTable courseCode={course.courseCode} sessions={sessions} completed={completed} now={landing.now} />
    </>
  );

  const personal = (
    <>
      {publicData?.preview && (
        <div data-testid="live-course-preview-banner" style={{ background: '#EEF2FF', color: '#3730A3', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
          Preview: this course is {course.status} and is not shown to the public.
        </div>
      )}
      {notice && <div data-testid="live-course-notice" style={{ background: '#E7F4EC', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, marginBottom: 12, color: GREEN, fontWeight: 700 }}>{notice}</div>}
      {view?.certificate && (
        <div data-testid="live-course-certificate" style={{ background: '#E7F4EC', border: '1px solid #B7DFC5', borderRadius: 10, padding: '16px 18px', marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ color: GREEN, fontSize: 15 }}>🏆 Certificate issued: {view.certificate.certificateId}</strong>
          {view.certificate.certPdfUrl && <a href={view.certificate.certPdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>Download certificate</a>}
          {view.certificate.verificationUrl && <a href={view.certificate.verificationUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>Verification page</a>}
        </div>
      )}
      {enrolled && view && <ProgressSummary view={view} />}
      {enrolled && view && <LiveCourseSubmission courseCode={view.course.courseCode} onChange={() => void load()} />}
    </>
  );

  const prereq = (course.prerequisites ?? '').trim();
  const aboutSlot = about.length > 0 || prereq ? (
    <div style={{ display: 'grid', gap: 16 }}>
      {about.map((b) => (
        <div key={b.title}>
          <h2 style={{ fontSize: 'clamp(18px,2.2vw,22px)', fontWeight: 800, color: '#0D2E5A', margin: '0 0 6px' }}>{b.title}</h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{b.body}</p>
        </div>
      ))}
      {prereq && <p data-testid="live-course-prereq" style={{ margin: 0, fontSize: 14, color: SLATE }}><strong style={{ color: '#0D2E5A' }}>Prerequisites:</strong> {prereq.replace(/\s+/g, ' ')}</p>}
    </div>
  ) : null;

  return (
    <div data-testid="live-course-page" style={{ padding: '24px 16px 48px', maxWidth: 1440, margin: '0 auto' }}>
      <CourseShell courseCode={course.courseCode} courseTitle={course.title} sessions={sessions} current="overview" completed={completed} now={landing.now}>
      <CourseLanding
        d={{
          page: landing.page,
          title: course.title,
          shortTitle: course.shortTitle,
          tagline: course.tagline,
          bannerUrl: course.bannerUrl,
          bannerAlt: course.bannerAlt,
          facts: landing.page.sections.hero.facts.length ? landing.page.sections.hero.facts : autoFacts(sessions),
          sideFacts: scheduleFacts(sessions),
          prerequisites: prereq.replace(/s+/g, ' '),
          next: next?.scheduled_datetime ? { no: next.course_session_no, startIso: next.scheduled_datetime } : null,
          timeZones: course.timeZones,
          enrolledCount: landing.enrolledCount,
          samples: landing.samples,
          counts: { testimonials: testimonialsSlot ? landing.testimonialCount : 0, sessions: sessions.length, instructors: instructorSlot ? 1 : 0 },
        }}
        action={{ dark: makeAction(true), light: makeAction(false) }}
        calendarHref={enrolled ? `/api/training/live-course/${encodeURIComponent(course.courseCode)}/calendar` : null}
        slots={{ personal, about: aboutSlot, curriculum, instructor: instructorSlot, testimonials: testimonialsSlot }}
      />
      </CourseShell>
    </div>
  );
}

type SessionElig = CourseView['eligibility']['sessions'][number];

/** One session's status: met live, met by recording, or what is still needed. */
export function SessionProgress({ e, course }: { e: SessionElig | undefined; course: CourseView['course'] }) {
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

/** One instructor, from their live profile (name, title, credentials, photo, bio, links). */
function InstructorCard({ i }: { i: CourseInstructor }) {
  const initials = i.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div data-testid="live-course-instructor" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {i.photoUrl
        ? <img src={i.photoUrl} alt={i.name} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${PALE}` }} />
        : <div aria-hidden style={{ width: 72, height: 72, borderRadius: '50%', background: NAVY, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 22, flexShrink: 0 }}>{initials}</div>}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>{i.name}{i.credentials ? <span style={{ fontWeight: 600, color: SLATE, fontSize: 13 }}>, {i.credentials}</span> : null}</div>
        {i.title && <div style={{ fontSize: 13.5, color: NAVY, marginTop: 2 }}>{i.title}</div>}
        {i.bio && (/<[a-z][\s\S]*?>/i.test(i.bio)
          // Already sanitised on the server (courseInstructors.safeBio): render it as formatted text.
          ? <div data-testid="instructor-bio" className="fmp-rich-text" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.55 }} dangerouslySetInnerHTML={{ __html: i.bio }} />
          : <p data-testid="instructor-bio" style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{i.bio}</p>)}
        {(i.linkedinUrl || i.profileUrl) && (
          <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 13 }}>
            {i.profileUrl && <a href={i.profileUrl} style={{ color: NAVY, fontWeight: 700 }}>Profile</a>}
            {i.linkedinUrl && <a href={i.linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>LinkedIn</a>}
          </div>
        )}
      </div>
    </div>
  );
}
