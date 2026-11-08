'use client';

/**
 * The live course page. ONE page for everyone:
 *   - a visitor (signed out): the public course page (hero, description, who
 *     it is for, prerequisites, trainer, sessions with dates, time zone
 *     table, Register), for a published course or with an admin preview link;
 *   - a signed-in student: the same, plus Enrol, Join live, progress,
 *     recordings, the model submission and the certificate.
 * The server page (page.tsx) decides visibility and the shell.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatSessionTime } from '@/src/hubs/training/lib/liveCourse/time';
import type { CourseView } from '@/src/hubs/training/lib/liveCourse/courseView';
import type { LiveCourseSettings, CourseSession } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { JoinLiveButton } from '@/src/hubs/training/components/sessions/JoinLiveButton';
import { TimeZoneTable } from '@/src/hubs/training/components/sessions/TimeZoneTable';
import { SessionCertificateButton } from '@/src/hubs/training/components/sessions/SessionCertificateButton';
import { sessionCertificateAvailable } from '@/src/hubs/training/lib/liveCourse/sessionCertificate';

const NAVY = '#1B4F8A';
const INK = '#2A3440';
const SLATE = '#5A6675';
const GREEN = '#2E7D52';
const PALE = '#E8EEF7';

export interface PublicCourseData {
  course: LiveCourseSettings;
  sessions: CourseSession[];
  /** True when shown through an admin preview link (course not public). */
  preview: boolean;
  /** A new student may register or enrol (published, enrolment open). */
  canRegister: boolean;
}

export function LiveCourseClient({ courseCode, autoEnrol, signedIn, publicData }: {
  courseCode: string;
  autoEnrol: boolean;
  signedIn: boolean;
  publicData: PublicCourseData | null;
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
  const sessions: (CourseSession & Partial<CourseView['sessions'][number]>)[] = view?.sessions ?? publicData?.sessions ?? [];
  const canRegister = publicData?.canRegister ?? (course.status === 'published' && course.enrolmentOpen);
  const next = sessions.find((s) => s.scheduled_datetime && new Date(s.scheduled_datetime).getTime() > Date.now()) ?? sessions[0];
  const enrolPath = `/training/live-course/${encodeURIComponent(course.courseCode)}?enrol=1`;

  let action: ReactNode;
  if (enrolled) {
    action = <span data-testid="live-course-enrolled" style={{ display: 'inline-block', background: GREEN, padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>✓ Enrolled</span>;
  } else if (!canRegister) {
    action = <span data-testid="live-course-enrolment-closed" style={{ display: 'inline-block', background: 'rgba(255,255,255,0.18)', padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 800 }}>{course.status === 'published' ? 'Enrolment closed' : 'Not open for registration'}</span>;
  } else if (signedIn) {
    action = (
      <button data-testid="live-course-enrol" onClick={() => enrol('dashboard')} disabled={enrolling}
        style={{ background: '#fff', color: NAVY, border: 'none', borderRadius: 8, padding: '11px 24px', fontWeight: 800, fontSize: 14, cursor: enrolling ? 'wait' : 'pointer' }}>
        {enrolling ? 'Enrolling…' : 'Enrol in this course'}
      </button>
    );
  } else {
    action = (
      <span style={{ display: 'inline-flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <a data-testid="live-course-register" href={`/register?course=${encodeURIComponent(course.courseCode)}`} style={{ background: '#2E7D52', color: '#fff', borderRadius: 8, padding: '11px 24px', fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>Register for this course</a>
        <a href={`/signin?redirect=${encodeURIComponent(enrolPath)}`} style={{ color: '#fff', fontSize: 13.5, textDecoration: 'underline' }}>Already have an account? Sign in to enrol</a>
      </span>
    );
  }

  const hero = course.bannerUrl
    ? { backgroundImage: `linear-gradient(90deg, rgba(13,46,90,0.92) 0%, rgba(13,46,90,0.65) 55%, rgba(13,46,90,0.25) 100%), url(${course.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(135deg, #0D2E5A, ${NAVY})` };

  const about: { title: string; body: string }[] = [
    { title: 'About this course', body: course.description },
    { title: 'Who it is for', body: course.whoFor },
    { title: 'Prerequisites', body: course.prerequisites },
  ].filter((b) => b.body && b.body.trim());

  return (
    <div data-testid="live-course-page" style={{ padding: '24px 16px 48px', maxWidth: 1040, margin: '0 auto', color: INK }}>
      {publicData?.preview && (
        <div data-testid="live-course-preview-banner" style={{ background: '#EEF2FF', color: '#3730A3', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
          Preview: this course is {course.status} and is not shown to the public.
        </div>
      )}
      <div role="img" aria-label={course.bannerAlt || course.title} style={{ ...hero, color: '#fff', borderRadius: 14, padding: 'clamp(24px,5vw,48px) clamp(20px,4vw,40px)', marginBottom: 22 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.85 }}>Live course · Microsoft Teams</div>
        <h1 style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 800, margin: '8px 0 6px', maxWidth: 680 }}>{course.title}</h1>
        {course.tagline && <p style={{ margin: 0, opacity: 0.95, fontSize: 16, maxWidth: 640 }}>{course.tagline}</p>}
        {next?.scheduled_datetime && <p style={{ margin: '10px 0 0', fontSize: 14, opacity: 0.9 }}>{sessions.length} session{sessions.length === 1 ? '' : 's'} · Next: {formatSessionTime(next.scheduled_datetime)}</p>}
        <div style={{ marginTop: 18 }}>{action}</div>
        {notice && <div data-testid="live-course-notice" style={{ marginTop: 12, fontSize: 13 }}>{notice}</div>}
      </div>

      {view?.certificate && (
        <div data-testid="live-course-certificate" style={{ background: '#E7F4EC', border: '1px solid #B7DFC5', borderRadius: 10, padding: '16px 18px', marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ color: GREEN, fontSize: 15 }}>🏆 Certificate issued: {view.certificate.certificateId}</strong>
          {view.certificate.certPdfUrl && <a href={view.certificate.certPdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>Download certificate</a>}
          {view.certificate.verificationUrl && <a href={view.certificate.verificationUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>Verification page</a>}
        </div>
      )}

      {enrolled && view && <ProgressSummary view={view} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 22 }}>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          {about.map((b) => (
            <div key={b.title}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 6px' }}>{b.title}</h2>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{b.body}</p>
            </div>
          ))}
          {course.trainerName && (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 6px' }}>Trainer</h2>
              <p style={{ margin: 0, fontSize: 14.5 }}><strong>{course.trainerName}</strong>{course.trainerTitle ? `, ${course.trainerTitle}` : ''}</p>
            </div>
          )}
        </div>
        {next?.scheduled_datetime && (
          <TimeZoneTable iso={next.scheduled_datetime} zones={course.timeZones} title={`Next session in your region${next.course_session_no ? ` (Session ${next.course_session_no})` : ''}`} />
        )}
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>Sessions</h2>
      {sessions.length === 0 && <div style={{ color: SLATE, fontSize: 14 }}>The schedule will appear here as sessions are announced.</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {sessions.map((s) => (
          <div key={s.id} data-testid="live-course-session" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: 84, fontWeight: 800, color: NAVY, fontSize: 13 }}>{s.course_session_no != null ? `Session ${s.course_session_no}` : 'Session'}</div>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ fontWeight: 700 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: SLATE }}>{formatSessionTime(s.scheduled_datetime)}</div>
            </div>
            {enrolled && s.state !== 'recorded' && (
              <JoinLiveButton joinUrl={s.joinUrl ?? null} joinOpensAt={s.joinOpensAt ?? null} joinClosesAt={s.joinClosesAt ?? null} size="sm" />
            )}
            {enrolled && s.youtube_url && (
              // The session player tracks skip-resistant watch time for the recording route.
              <a data-testid="watch-recording" href={`/training/live-sessions/${s.id}`} style={{ padding: '8px 14px', borderRadius: 8, border: `1.5px solid ${NAVY}`, color: NAVY, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>▶ Watch recording</a>
            )}
            {enrolled && view && <SessionProgress e={view.eligibility.sessions.find((x) => x.sessionId === s.id)} course={view.course} />}
            {enrolled && view && sessionCertificateAvailable(view.course, view.eligibility.sessions.find((x) => x.sessionId === s.id)) && (
              <SessionCertificateButton session={s} studentName={view.student.name} registrationId={view.student.registrationId} courseTitle={view.course.title} />
            )}
          </div>
        ))}
      </div>

      {enrolled && view && <LiveCourseSubmission courseCode={view.course.courseCode} onChange={() => void load()} />}
    </div>
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

interface SubmissionStatus {
  required: boolean; hasApproved: boolean; latestStatus: 'none' | 'pending_review' | 'approved' | 'rejected';
  attemptsUsed: number; attemptsRemaining: number; maxAttempts: number; locked: boolean;
  eligibleToSubmit: boolean | null; guidance: string; sampleUrl: string | null;
  latest: { id: string; file_name: string; attempt_number: number; review_note: string | null; reviewed_file_name: string | null } | null;
}

/**
 * The model submission for a live course. Reuses the existing submission
 * system (same route, bucket, review queue and emails); this is only the
 * course page's view of it.
 */
export function LiveCourseSubmission({ courseCode, onChange }: { courseCode: string; onChange?: () => void }) {
  const [st, setSt] = useState<SubmissionStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/training/model-submission?courseCode=${encodeURIComponent(courseCode)}`);
    const j = await r.json() as { status?: SubmissionStatus };
    setSt(j.status ?? null);
  }, [courseCode]);
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('courseCode', courseCode); fd.append('studentNotes', notes);
      const r = await fetch('/api/training/model-submission', { method: 'POST', body: fd });
      const j = await r.json() as { error?: string; message?: string };
      if (!r.ok) { setMsg({ ok: false, text: j.message ?? j.error ?? 'Upload failed.' }); return; }
      setMsg({ ok: true, text: 'Submitted. You will get an email when it has been reviewed.' });
      setFile(null); setNotes('');
      await load(); onChange?.();
    } finally { setBusy(false); }
  }

  if (!st) return null;
  const box = (testid: string, bg: string, border: string, children: ReactNode) => (
    <div data-testid={testid} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 16px', fontSize: 14, lineHeight: 1.55 }}>{children}</div>
  );
  const latest = st.latest;
  const reviewedLink = latest?.reviewed_file_name
    ? <a href={`/api/training/model-submission/${latest.id}/reviewed-file`} style={{ color: NAVY, fontWeight: 700 }}>Download the reviewed model ({latest.reviewed_file_name})</a>
    : null;

  let body: ReactNode;
  if (st.hasApproved) {
    body = box('submission-approved', '#E7F4EC', '#B7DFC5', <><strong style={{ color: GREEN }}>✓ Your model is approved.</strong> Your certificate is issued by email.{reviewedLink && <div style={{ marginTop: 6 }}>{reviewedLink}</div>}</>);
  } else if (!st.eligibleToSubmit) {
    body = box('submission-gate-locked', '#F5F7FA', '#E2E8F0', 'Model submission unlocks once every session is complete: attended live, or its recording watched in full.');
  } else if (st.latestStatus === 'pending_review') {
    body = box('submission-pending', '#EFF6FF', '#BFDBFE', <>Attempt {latest?.attempt_number} of {st.maxAttempts} (<strong>{latest?.file_name}</strong>) is being reviewed. You will get an email with the result.</>);
  } else if (st.locked) {
    body = box('submission-attempts-locked', '#FEF2F2', '#FECACA', <>
      <strong style={{ color: '#B91C1C' }}>Uploads are locked.</strong> You have used all {st.maxAttempts} attempts and the last one was not approved.
      Please contact us; the administrator can reset your attempts.
      {latest?.review_note && <div style={{ marginTop: 8 }}><strong>Last reviewer note:</strong> {latest.review_note}</div>}
      {reviewedLink && <div style={{ marginTop: 6 }}>{reviewedLink}</div>}
    </>);
  } else {
    body = (
      <div data-testid="submission-upload" style={{ background: '#fff', border: `1px solid ${PALE}`, borderRadius: 10, padding: '14px 16px' }}>
        {st.latestStatus === 'rejected' && latest && (
          <div data-testid="submission-rejected" style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>
            <strong>Attempt {latest.attempt_number} was not approved.</strong> {st.attemptsRemaining} of {st.maxAttempts} attempts left.
            {latest.review_note && <div style={{ marginTop: 6 }}><strong>Reviewer note:</strong> {latest.review_note}</div>}
            {reviewedLink && <div style={{ marginTop: 6 }}>{reviewedLink}</div>}
          </div>
        )}
        <div style={{ fontSize: 14, marginBottom: 10 }}>
          Upload your model (Excel or PDF, up to 10 MB). Attempt {st.attemptsUsed + 1} of {st.maxAttempts}.
          {st.sampleUrl && <> <a href={st.sampleUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontWeight: 700 }}>Sample template</a></>}
        </div>
        {st.guidance && <div style={{ fontSize: 13, color: SLATE, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{st.guidance}</div>}
        <input data-testid="submission-file" type="file" accept=".xlsx,.xls,.xlsm,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <textarea placeholder="Notes for the reviewer (optional)" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 10, minHeight: 60, padding: 8, borderRadius: 6, border: '1px solid #CBD5E1', fontFamily: 'inherit' }} />
        <button data-testid="submission-submit" onClick={submit} disabled={!file || busy} style={{ marginTop: 10, background: GREEN, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 800, cursor: !file || busy ? 'not-allowed' : 'pointer', opacity: !file || busy ? 0.6 : 1 }}>
          {busy ? 'Uploading…' : 'Submit model'}
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: '0 0 10px' }}>Model submission</h2>
      {body}
      {msg && <div data-testid="submission-message" style={{ marginTop: 8, fontSize: 13, color: msg.ok ? GREEN : '#B91C1C' }}>{msg.text}</div>}
    </div>
  );
}
