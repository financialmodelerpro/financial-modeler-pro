'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession, clearTrainingSession } from '@/src/lib/training-session';
import { COURSES } from '@/src/config/courses';
import { startTimer, getTimerStatus, type TimerStatus } from '@/src/lib/videoTimer';
import { CountdownTimer } from '@/src/components/training/CountdownTimer';

interface LiveSessionLink { tabKey: string; youtubeUrl: string; formUrl: string; videoDuration?: number; }
type LiveLinksMap = Record<string, LiveSessionLink>;

interface CourseDescription {
  tagline?: string;
  fullDescription?: string;
  whatYouLearn?: string[];
  prerequisites?: string;
  whoIsThisFor?: string;
  skillLevel?: string;
  durationHours?: number;
  language?: string;
  certificateDescription?: string;
}
type CourseDescsMap = Record<string, CourseDescription>;

// ── Local types ───────────────────────────────────────────────────────────────

interface SessionProgress {
  sessionId: string;
  passed: boolean;
  score: number;
  attempts: number;
  completedAt: string | null;
}

interface StudentData {
  name: string;
  email: string;
  registrationId: string;
  course: string;
  registeredAt: string;
}

interface ProgressData {
  student: StudentData;
  sessions: SessionProgress[];
  finalPassed: boolean;
  certificateIssued: boolean;
}

interface Certificate {
  certificateId: string;
  studentName: string;
  email: string;
  course: string;
  issuedAt: string;
  certifierUrl: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEnrolledCourses(courseValue: string): string[] {
  if (courseValue === 'both') return ['3sfm', 'bvm'];
  if (courseValue === 'bvm') return ['bvm'];
  return ['3sfm'];
}

function buildProgressMap(sessions: SessionProgress[]): Map<string, SessionProgress> {
  return new Map(sessions.map(s => [s.sessionId, s]));
}

function allRegularSessionsPassed(courseId: string, progressMap: Map<string, SessionProgress>): boolean {
  const course = COURSES[courseId];
  if (!course) return false;
  return course.sessions
    .filter(s => !s.isFinal)
    .every(s => progressMap.get(s.id)?.passed === true);
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ w, h, radius = 6 }: { w: string | number; h: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius, flexShrink: 0,
      background: 'linear-gradient(90deg,#E5E7EB 25%,#F3F4F6 50%,#E5E7EB 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ locked, prog }: { locked: boolean; prog: SessionProgress | undefined }) {
  if (locked) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', whiteSpace: 'nowrap' }}>
      🔒 Locked
    </span>
  );
  if (!prog || prog.attempts === 0) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB', whiteSpace: 'nowrap' }}>
      Not Started
    </span>
  );
  if (prog.passed) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0', whiteSpace: 'nowrap' }}>
      ✓ Passed — {prog.score}%
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA', whiteSpace: 'nowrap' }}>
      Attempted — {prog.score}%
    </span>
  );
}

// ── Session Card ──────────────────────────────────────────────────────────────

interface SessionCardProps {
  sessionTitle: string;
  sessionId: string;
  maxAttempts: number;
  questionCount: number;
  passingScore: number;
  idx: number;
  prog: SessionProgress | undefined;
  locked: boolean;
  ytUrl: string;
  formUrl: string;
  isFinal: boolean;
  passedCount: number;
  regularCount: number;
  tabKey: string;
  videoDuration: number;
  regId: string;
  noteContent: string;
  onNoteSave: (sessionKey: string, content: string) => void;
  feedbackGiven: boolean;
  onFeedbackRequest: (sessionKey: string, sessionTitle: string) => void;
  /** When true the entire BVM course is locked — show course content but lock Watch + Assessment buttons */
  bvmLocked?: boolean;
}

function SessionCard({
  sessionTitle, maxAttempts, questionCount, passingScore,
  idx, prog, locked, ytUrl, formUrl, isFinal, passedCount, regularCount,
  tabKey, videoDuration, regId, noteContent, onNoteSave, feedbackGiven, onFeedbackRequest,
  bvmLocked,
}: SessionCardProps) {
  const [timerStatus, setTimerStatus] = useState<TimerStatus>({ locked: false, minutesRemaining: 0, started: false });
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteText, setNoteText] = useState(noteContent);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync incoming noteContent (loaded async)
  useEffect(() => { setNoteText(noteContent); }, [noteContent]);

  useEffect(() => {
    if (typeof window === 'undefined' || !regId) return;
    setTimerStatus(getTimerStatus(regId, tabKey, videoDuration));
  }, [regId, tabKey, videoDuration]);

  let borderColor = '#E5E7EB';
  let bgColor = '#ffffff';
  if (!locked) {
    if (prog?.passed) { borderColor = '#2EAA4A'; bgColor = '#F0FFF4'; }
    else if (prog && prog.attempts > 0) { borderColor = '#F59E0B'; bgColor = '#FFFBEB'; }
    else { borderColor = '#D1D5DB'; bgColor = '#ffffff'; }
  }

  const attemptsUsed = prog?.attempts ?? 0;
  const attemptsLeft = maxAttempts - attemptsUsed;
  const label = isFinal ? '🏆' : `S${idx + 1}`;

  // Time-lock state (only applies when formUrl is available and session not locked/passed)
  const hasTimeLock = videoDuration > 0 && !!ytUrl;
  const timerLocked  = hasTimeLock && timerStatus.locked;
  const timerStarted = timerStatus.started;

  return (
    <div style={{
      borderRadius: 8, border: '1px solid #E5E7EB',
      borderLeft: `4px solid ${borderColor}`,
      background: bgColor, padding: '14px 18px', marginBottom: 8,
      boxShadow: locked ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
      opacity: locked ? 0.65 : 1,
    }}>
      {/* Row 1: number + title + badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: '#9CA3AF', fontSize: 12, minWidth: 28, paddingTop: 2, flexShrink: 0, fontFamily: 'monospace' }}>
            {locked && !isFinal ? '🔒' : label}
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: isFinal ? 700 : 600, color: '#0D2E5A', fontSize: 14, lineHeight: 1.4 }}>
                {sessionTitle}
              </span>
              {videoDuration > 0 && (
                <span style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                  {`⏱ ${videoDuration >= 60 ? `${Math.floor(videoDuration / 60)} hr${Math.floor(videoDuration / 60) > 1 ? 's' : ''}${videoDuration % 60 > 0 ? ` ${videoDuration % 60} min` : ''}` : `${videoDuration} min`}`}
                </span>
              )}
            </div>
            {isFinal && locked && (
              <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3, fontWeight: 600 }}>
                {passedCount} of {regularCount} sessions passed — complete all to unlock
              </div>
            )}
            {isFinal && !locked && (
              <div style={{ fontSize: 11, color: '#15803D', marginTop: 3, fontWeight: 600 }}>
                {questionCount} questions · 1 attempt only · {passingScore}% to pass
              </div>
            )}
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <StatusBadge locked={locked} prog={prog} />
        </div>
      </div>

      {/* Row 2: score + attempts */}
      {!locked && (
        <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#6B7280', marginBottom: 10, paddingLeft: 38, flexWrap: 'wrap' }}>
          <span>Score: <strong style={{ color: '#374151' }}>{attemptsUsed > 0 ? `${prog!.score}%` : '—'}</strong></span>
          <span>Attempts: <strong style={{ color: '#374151' }}>{attemptsUsed} / {maxAttempts}</strong></span>
          {attemptsLeft < maxAttempts && attemptsLeft > 0 && !prog?.passed && (
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>{attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left</span>
          )}
        </div>
      )}

      {/* Feedback prompt for recently-passed sessions */}
      {prog?.passed && !feedbackGiven && !locked && !isFinal && (
        <div style={{ paddingLeft: 38, marginBottom: 8 }}>
          <button onClick={() => onFeedbackRequest(tabKey, sessionTitle)}
            style={{ fontSize: 10, fontWeight: 700, color: '#C9A84C', background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}>
            ⭐ Rate this session
          </button>
        </div>
      )}

      {/* Row 3: action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: locked ? 0 : 38 }}>
        {/* Watch Video */}
        {bvmLocked ? (
          <span title="Complete 3-Statement Financial Modeling first to unlock"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#FCA5A5', whiteSpace: 'nowrap', cursor: 'default' }}>
            🔒 Watch Video
          </span>
        ) : ytUrl ? (
          <a href={ytUrl} target="_blank" rel="noopener noreferrer"
            onClick={() => {
              startTimer(regId, tabKey, videoDuration);
              setTimerStatus(getTimerStatus(regId, tabKey, videoDuration));
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#FF0000', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            ▶ Watch Video
          </a>
        ) : !isFinal ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
            📹 Coming Soon
          </span>
        ) : null}

        {/* Assessment */}
        {bvmLocked ? (
          <span title="Complete 3-Statement Financial Modeling first to unlock"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#FCA5A5', whiteSpace: 'nowrap', cursor: 'default' }}>
            🔒 {isFinal ? 'Final Exam Locked' : 'Assessment Locked'}
          </span>
        ) : locked ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#FCA5A5', whiteSpace: 'nowrap' }}>
            🔒 {isFinal ? 'Final Exam Locked' : 'Locked'}
          </span>
        ) : prog?.passed ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0', whiteSpace: 'nowrap' }}>
            ✓ {isFinal ? 'Exam Passed' : 'Assessment Done'}
          </span>
        ) : attemptsUsed >= maxAttempts ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#FEF2F2', color: '#DC2626', whiteSpace: 'nowrap' }}>
            No Attempts Left
          </span>
        ) : !formUrl ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
            📝 Assessment Coming Soon
          </span>
        ) : timerLocked && !timerStarted ? (
          // STATE 2: video exists but never watched
          <span title="Watch the video to unlock the assessment"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#9CA3AF', whiteSpace: 'nowrap', cursor: 'default' }}>
            👁 Watch Video First
          </span>
        ) : timerLocked && timerStarted ? (
          // STATE 3: timer running — live countdown
          <CountdownTimer
            regId={regId}
            tabKey={tabKey}
            durationMinutes={videoDuration}
            onExpired={() => setTimerStatus({ locked: false, minutesRemaining: 0, started: true })}
          />
        ) : (
          // STATE 1 / 4: no lock or timer expired
          <Link href={`/training/assessment/${encodeURIComponent(tabKey)}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: isFinal ? '#C9A84C' : '#2EAA4A', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            {isFinal ? '🏆 Take Final Exam →' : '📝 Take Assessment →'}
          </Link>
        )}
      </div>

      {/* Notes toggle */}
      {!locked && !isFinal && (
        <div style={{ marginTop: 8, paddingLeft: 38 }}>
          <button onClick={() => setNotesOpen(v => !v)}
            style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            📝 {notesOpen ? 'Hide Notes' : `Study Notes${noteText ? ' ●' : ''}`}
          </button>
          {notesOpen && (
            <div style={{ marginTop: 6 }}>
              <textarea
                value={noteText}
                onChange={e => {
                  const val = e.target.value.slice(0, 2000);
                  setNoteText(val);
                  if (noteTimer.current) clearTimeout(noteTimer.current);
                  noteTimer.current = setTimeout(() => onNoteSave(tabKey, val), 1500);
                }}
                rows={3}
                maxLength={2000}
                placeholder="Add your study notes here… (auto-saved)"
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box', color: '#374151', background: '#FEFCE8' }}
              />
              <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 2 }}>{noteText.length}/2000 · auto-saved</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── About This Course ─────────────────────────────────────────────────────────

function AboutThisCourse({ desc, course }: { desc: CourseDescription; course: { title: string; shortTitle: string } }) {
  const [open, setOpen] = useState(false);
  const metaItems: { icon: string; label: string }[] = [];
  if (desc.durationHours) metaItems.push({ icon: '⏱', label: `${desc.durationHours} Hours` });
  if (desc.skillLevel)    metaItems.push({ icon: '📊', label: desc.skillLevel });
  if (desc.language)      metaItems.push({ icon: '🌐', label: desc.language });

  return (
    <div style={{ marginBottom: 20, borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: open ? '#F5F7FA' : '#F9FAFB',
          border: 'none', cursor: 'pointer', borderBottom: open ? '1px solid #E5E7EB' : 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>
          <span style={{ fontSize: 15 }}>ℹ️</span> About This Course
        </span>
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '18px 18px 20px' }}>
          {/* Title + meta */}
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>{course.title}</div>
          {metaItems.length > 0 && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              {metaItems.map(m => (
                <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', fontWeight: 600 }}>
                  <span style={{ fontSize: 13 }}>{m.icon}</span>{m.label}
                </div>
              ))}
            </div>
          )}

          {/* Full description */}
          {desc.fullDescription && (
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.65, margin: '0 0 14px' }}>
              {desc.fullDescription}
            </p>
          )}

          {/* What You Will Learn */}
          {desc.whatYouLearn && desc.whatYouLearn.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                What You Will Learn
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {desc.whatYouLearn.map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: '#2EAA4A', fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Course Content ────────────────────────────────────────────────────────────

interface CourseContentProps {
  courseId: string;
  progressMap: Map<string, SessionProgress>;
  certificates: Certificate[];
  liveLinks: LiveLinksMap;
  courseDescs: CourseDescsMap;
  regId: string;
  onDownloadTranscript: () => void;
  generating: boolean;
  // share + testimonials
  studentName: string;
  studentEmail: string;
  onShare: (label: string, certUrl?: string) => void;
  testimonialSubmitted: boolean;
  onOpenTestimonial: (type: 'written' | 'video') => void;
  // notes + feedback
  notes: Record<string, string>;
  onNoteSave: (sessionKey: string, content: string) => void;
  feedbackGiven: Set<string>;
  onFeedbackRequest: (sessionKey: string, sessionTitle: string) => void;
  /** BVM course-level lock — show content but lock Watch + Assessment buttons */
  bvmLocked?: boolean;
  sfmProgress?: number;
  sfmTotal?: number;
  onSwitchTo3sfm?: () => void;
}

function CourseContent({ courseId, progressMap, certificates, liveLinks, courseDescs, regId, onDownloadTranscript, generating, studentName, onShare, testimonialSubmitted, onOpenTestimonial, notes, onNoteSave, feedbackGiven, onFeedbackRequest, bvmLocked, sfmProgress = 0, sfmTotal = 0, onSwitchTo3sfm }: CourseContentProps) {
  const course = COURSES[courseId];
  if (!course) return null;

  // Track dismissed banners for this session
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(JSON.parse(sessionStorage.getItem('fmp_banners') || '[]')); } catch { return new Set(); }
  });
  const [copiedCert, setCopiedCert] = useState(false);

  function dismissBanner(key: string) {
    setDismissedBanners(prev => {
      const next = new Set([...prev, key]);
      try { sessionStorage.setItem('fmp_banners', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  // Detect most recently passed session within the last 4 hours
  const recentlyPassed = useMemo(() => {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;
    const regularSess = course.sessions.filter(s => !s.isFinal);
    let best: { key: string; label: string; certUrl?: string } | null = null;
    let bestTime = 0;
    for (const s of course.sessions) {
      const prog = progressMap.get(s.id);
      if (!prog?.passed || !prog.completedAt) continue;
      const t = new Date(prog.completedAt).getTime();
      if (t < cutoff || t <= bestTime) continue;
      const idx = regularSess.findIndex(r => r.id === s.id);
      const label = s.isFinal ? 'passed the Final Exam' : `passed Session ${idx + 1}`;
      best = { key: `sess_${s.id}`, label };
      bestTime = t;
    }
    return best;
  }, [progressMap, course]);

  const allRegularPassed = allRegularSessionsPassed(courseId, progressMap);
  const regularSessions = course.sessions.filter(s => !s.isFinal);
  const finalSession = course.sessions.find(s => s.isFinal);
  const passedCount = regularSessions.filter(s => progressMap.get(s.id)?.passed).length;
  const finalPassed = finalSession ? progressMap.get(finalSession.id)?.passed === true : false;
  const progressPct = regularSessions.length > 0 ? Math.round((passedCount / regularSessions.length) * 100) : 0;

  const courseCert = certificates.find(c =>
    c.course === courseId || c.course === course.id || c.course === course.shortTitle.toLowerCase()
  );

  // Stats
  const attempted = regularSessions.filter(s => (progressMap.get(s.id)?.attempts ?? 0) > 0);
  const avgScore = attempted.length > 0
    ? Math.round(attempted.reduce((sum, s) => sum + (progressMap.get(s.id)?.score ?? 0), 0) / attempted.length)
    : null;
  const bestEntry = regularSessions.reduce<{ score: number; label: string } | null>((best, s) => {
    const p = progressMap.get(s.id);
    if (!p || p.attempts === 0) return best;
    if (!best || p.score > best.score) return { score: p.score, label: s.id };
    return best;
  }, null);
  const certStatus = bvmLocked ? 'Locked' : (finalPassed && courseCert ? 'Earned' : allRegularPassed ? 'Eligible' : 'Pending');
  const certColor = bvmLocked ? '#9CA3AF' : (certStatus === 'Earned' ? '#C9A84C' : certStatus === 'Eligible' ? '#2EAA4A' : '#6B7280');
  const hasAny = passedCount > 0;
  const isOfficial = finalPassed;

  // "About This Course" — courses API keys by category (e.g. '3SFM', 'BVM')
  const desc = courseDescs[course.shortTitle] ?? courseDescs[course.shortTitle.toLowerCase()];

  return (
    <div>
      {/* BVM prerequisite banner — gold/amber, dismissible */}
      {bvmLocked && !dismissedBanners.has('bvm_lock') && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: '#92400E', fontWeight: 700, marginBottom: 2 }}>
              🔒 Complete 3-Statement Financial Modeling to unlock this course
            </div>
            <div style={{ fontSize: 12, color: '#B45309' }}>
              Your 3SFM Progress: {sfmProgress} / {sfmTotal} sessions
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {onSwitchTo3sfm && (
              <button onClick={onSwitchTo3sfm} style={{ padding: '6px 14px', borderRadius: 7, background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                Continue 3SFM →
              </button>
            )}
            <button onClick={() => dismissBanner('bvm_lock')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B45309', fontSize: 15, padding: '0 2px', lineHeight: 1 }}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Course Header */}
      <div style={{ background: 'linear-gradient(135deg, #0D2E5A 0%, #1B4F8A 100%)', borderRadius: 12, padding: '24px 28px', marginBottom: 20, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.15)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                🎓 {course.shortTitle}
              </div>
              {bvmLocked && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.5)', fontSize: 11, fontWeight: 700, color: '#C9A84C' }}>
                  🔒 Locked
                </div>
              )}
            </div>
            <h2 style={{ fontSize: 'clamp(18px,2.5vw,22px)', fontWeight: 800, color: '#fff', marginBottom: 6, lineHeight: 1.2 }}>
              {course.title}
            </h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0, maxWidth: 480, lineHeight: 1.5 }}>
              {course.description}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
            <button
              onClick={onDownloadTranscript}
              disabled={!hasAny || generating}
              title={!hasAny ? 'Complete at least one session to download' : undefined}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                background: !hasAny ? 'rgba(255,255,255,0.08)' : isOfficial ? '#2EAA4A' : 'rgba(255,255,255,0.18)',
                color: !hasAny ? 'rgba(255,255,255,0.35)' : '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                cursor: !hasAny || generating ? 'not-allowed' : 'pointer',
              }}
            >
              {generating ? (
                <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              ) : '📄'}
              {generating ? 'Generating…' : isOfficial ? 'Official Transcript' : 'Progress Transcript'}
            </button>
            {courseCert && finalPassed && (
              <a href={courseCert.certifierUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#C9A84C', color: '#fff', textDecoration: 'none' }}>
                🏆 View Certificate
              </a>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>Course Progress</span>
            <span style={{ color: '#fff', fontWeight: 700 }}>{passedCount} / {regularSessions.length} {course.id === 'bvm' ? 'Lessons' : 'Sessions'} · {progressPct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, background: progressPct === 100 ? '#C9A84C' : '#2EAA4A', width: `${progressPct}%`, transition: 'width 0.6s ease' }} />
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="dash-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20, opacity: bvmLocked ? 0.55 : 1, transition: 'opacity 0.2s' }}>
        {[
          { label: 'Sessions Passed', value: `${passedCount} / ${regularSessions.length}`, icon: '📊', color: '#1B4F8A' },
          { label: 'Avg Score', value: avgScore !== null ? `${avgScore}%` : '—', icon: '📈', color: '#059669' },
          { label: 'Best Score', value: bestEntry ? `${bestEntry.score}% (${bestEntry.label})` : '—', icon: '⭐', color: '#C9A84C' },
          { label: 'Certificate', value: certStatus, icon: '🏆', color: certColor },
        ].map(card => (
          <div key={card.label} style={{ background: '#fff', borderRadius: 10, padding: '16px 18px', border: '1px solid #E5E7EB', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{card.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: card.color, marginBottom: 2, wordBreak: 'break-word' }}>{card.value}</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* About This Course */}
      {desc && <AboutThisCourse desc={desc} course={course} />}

      {/* Session Cards */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
          {course.id === 'bvm' ? 'Lessons' : 'Sessions'}
        </h3>
        {course.sessions.map((session, idx) => {
          const prog = progressMap.get(session.id);
          const isFinalRow = session.isFinal;
          // NOTE: Watch button shows for ALL sessions including finals if youtubeUrl exists.
          // Final sessions use '_Final' suffix to match the Apps Script tabKey convention
          // (Apps Script Form Registry stores the final row as e.g. '3SFM_Final', not '3SFM_S18').
          // Do NOT revert this to session.id — that was the root cause of Session 18 never showing.
          const tk = isFinalRow
            ? `${course.shortTitle.toUpperCase()}_Final`
            : `${course.shortTitle.toUpperCase()}_${session.id}`;
          const ytUrl = liveLinks[tk]?.youtubeUrl || session.youtubeUrl || '';
          const formUrl = liveLinks[tk]?.formUrl || session.quizFormUrl || '';

          let locked = false;
          if (bvmLocked) {
            locked = true;
          } else if (isFinalRow) {
            locked = !allRegularPassed;
          } else if (idx > 0) {
            const prev = course.sessions[idx - 1];
            locked = !progressMap.get(prev.id)?.passed;
          }

          return (
            <SessionCard
              key={session.id}
              sessionTitle={session.title}
              sessionId={session.id}
              maxAttempts={session.maxAttempts}
              questionCount={session.questionCount}
              passingScore={session.passingScore}
              idx={idx}
              prog={prog}
              locked={locked}
              ytUrl={ytUrl}
              formUrl={formUrl}
              isFinal={isFinalRow}
              passedCount={passedCount}
              regularCount={regularSessions.length}
              tabKey={tk}
              videoDuration={liveLinks[tk]?.videoDuration ?? 0}
              regId={regId}
              noteContent={notes[tk] ?? ''}
              onNoteSave={onNoteSave}
              feedbackGiven={feedbackGiven.has(tk)}
              onFeedbackRequest={onFeedbackRequest}
              bvmLocked={bvmLocked}
            />
          );
        })}
      </div>

      {/* ── Exam Prep Mode ───────────────────────────────────────────────── */}
      {allRegularPassed && !finalPassed && finalSession && (progressMap.get(finalSession.id)?.attempts ?? 0) === 0 && (
        <div style={{ background: 'linear-gradient(135deg,#EFF6FF,#DBEAFE)', border: '1px solid #93C5FD', borderRadius: 12, padding: '18px 22px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1E3A8A', marginBottom: 8 }}>🎯 Exam Prep Mode — You are ready for the Final Exam!</div>
          <div style={{ fontSize: 12, color: '#1E40AF', marginBottom: 12 }}>Review your weakest sessions before sitting the final:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {regularSessions
              .filter(s => progressMap.get(s.id)?.attempts ?? 0 > 0)
              .sort((a, b) => (progressMap.get(a.id)?.score ?? 100) - (progressMap.get(b.id)?.score ?? 100))
              .slice(0, 3)
              .map((s, i) => {
                const p = progressMap.get(s.id);
                const tk = `${course.shortTitle.toUpperCase()}_${s.id}`;
                const ytUrl = liveLinks[tk]?.youtubeUrl || s.youtubeUrl || '';
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.6)', borderRadius: 7, padding: '8px 12px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? '#DC2626' : '#C2410C', minWidth: 20 }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#1E3A8A' }}>{s.title}</span>
                    <span style={{ fontSize: 11, color: '#6B7280' }}>{p?.score ?? 0}%</span>
                    {ytUrl && (
                      <a href={ytUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10, fontWeight: 700, color: '#DC2626', textDecoration: 'none', background: '#FEE2E2', padding: '2px 8px', borderRadius: 4 }}>
                        ▶ Rewatch
                      </a>
                    )}
                  </div>
                );
              })}
          </div>
          {finalSession && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <Link href={`/training/assessment/${encodeURIComponent(`${course.shortTitle.toUpperCase()}_${finalSession.id}`)}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, background: '#1E3A8A', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
                🏆 I&apos;m Ready — Take Final Exam →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Session completion share prompt ─────────────────────────────── */}
      {recentlyPassed && !dismissedBanners.has(recentlyPassed.key) && (
        <div style={{ background: 'linear-gradient(135deg,#EFF6FF,#DBEAFE)', border: '1px solid #BFDBFE', borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: '#1E40AF', fontWeight: 600 }}>
            🎉 You {recentlyPassed.label} in <strong>{course.shortTitle}</strong>! Share Your Achievement
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => onShare(recentlyPassed.label)}
              style={{ padding: '6px 14px', borderRadius: 20, background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              Share
            </button>
            <button onClick={() => dismissBanner(recentlyPassed.key)}
              style={{ padding: '6px 10px', borderRadius: 20, background: 'transparent', color: '#6B7280', border: '1px solid #D1D5DB', cursor: 'pointer', fontSize: 12 }}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Progress milestone share banner ──────────────────────────────── */}
      {[25, 50, 75].map(m => {
        const key = `milestone_${courseId}_${m}`;
        const hit = progressPct >= m && progressPct < m + 25;
        if (!hit || dismissedBanners.has(key)) return null;
        return (
          <div key={m} style={{ background: 'linear-gradient(135deg,#F0FDF4,#DCFCE7)', border: '1px solid #BBF7D0', borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>
              🚀 You are <strong>{m}% through</strong> the {course.shortTitle} course! Keep it up.
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => onShare(`reached ${m}% progress in ${course.shortTitle}`)}
                style={{ padding: '6px 14px', borderRadius: 20, background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                Share Progress
              </button>
              <button onClick={() => dismissBanner(key)}
                style={{ padding: '6px 10px', borderRadius: 20, background: 'transparent', color: '#6B7280', border: '1px solid #D1D5DB', cursor: 'pointer', fontSize: 12 }}>
                ✕
              </button>
            </div>
          </div>
        );
      })}

      {/* ── Share Your Experience (testimonial prompt) ────────────────────── */}
      {passedCount >= 1 && !testimonialSubmitted && (
        <div style={{ background: 'linear-gradient(135deg,#FFFBF0,#FFF8E1)', border: '1px solid #FDE68A', borderRadius: 12, padding: '20px 22px', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#92400E', marginBottom: 4 }}>⭐ Enjoying the course?</div>
          <div style={{ fontSize: 12, color: '#B45309', lineHeight: 1.5, marginBottom: 14 }}>
            Your feedback helps other professionals discover FMP. Takes under 2 minutes!
          </div>
          {/* Star rating */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>How would you rate your experience?</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1,2,3,4,5].map(star => (
                <span key={star} style={{ fontSize: 22, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => onOpenTestimonial('written')}>
                  ☆
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => onOpenTestimonial('written')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              ✍️ Write a Testimonial
            </button>
            <button onClick={() => onOpenTestimonial('video')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, background: '#fff', color: '#1B4F8A', border: '1px solid #1B4F8A', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              🎥 Submit Video Testimonial
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: '#D97706' }}>
            {studentName || 'You'} • {course.shortTitle} • {passedCount} session{passedCount === 1 ? '' : 's'} completed
          </div>
        </div>
      )}

      {/* ── Recommended Next Steps ───────────────────────────────────────── */}
      {!bvmLocked && (() => {
        const nextUnpassed = regularSessions.find(s => !progressMap.get(s.id)?.passed);
        const nextIdx = nextUnpassed ? regularSessions.indexOf(nextUnpassed) : -1;
        let title = '';
        let body = '';
        let action = '';
        let actionUrl = '';
        if (passedCount === 0) {
          title = '🚀 Start Your Journey';
          body = `Begin with Session 1 of ${course.shortTitle} — watch the video then take the assessment.`;
          const s = regularSessions[0];
          const tk = s ? `${course.shortTitle.toUpperCase()}_${s.id}` : '';
          actionUrl = liveLinks[tk]?.youtubeUrl || s?.youtubeUrl || '';
          action = '▶ Watch Session 1';
        } else if (!allRegularPassed && nextUnpassed) {
          title = `📌 Continue — Session ${nextIdx + 1}`;
          body = `You have completed ${passedCount} of ${regularSessions.length} sessions. Keep the momentum!`;
          const tk = `${course.shortTitle.toUpperCase()}_${nextUnpassed.id}`;
          actionUrl = liveLinks[tk]?.youtubeUrl || nextUnpassed.youtubeUrl || '';
          action = `▶ Watch Session ${nextIdx + 1}`;
        } else if (allRegularPassed && !finalPassed) {
          title = '🏆 Ready for the Final Exam';
          body = 'All sessions passed! Sit the Final Exam to earn your certificate.';
          const fk = finalSession ? `${course.shortTitle.toUpperCase()}_${finalSession.id}` : '';
          actionUrl = fk ? `/training/assessment/${encodeURIComponent(fk)}` : '';
          action = '🏆 Take Final Exam';
        } else if (finalPassed && courseCert) {
          title = '🎓 Share Your Certificate';
          body = 'Congratulations! Add your certificate to LinkedIn to showcase your skills.';
          actionUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(courseCert.certifierUrl)}`;
          action = 'in Add to LinkedIn';
        } else {
          title = '📈 Keep Going';
          body = 'Complete the remaining sessions to unlock your certificate.';
        }
        return (
          <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>{title}</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: actionUrl ? 10 : 0 }}>{body}</div>
            {actionUrl && (
              actionUrl.startsWith('/') ? (
                <Link href={actionUrl}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 7, background: '#1B4F8A', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>
                  {action}
                </Link>
              ) : (
                <a href={actionUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 7, background: '#1B4F8A', color: '#fff', textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>
                  {action}
                </a>
              )
            )}
          </div>
        );
      })()}

      {/* Certificate Card — locked state when bvmLocked */}
      {bvmLocked && (
        <div style={{ border: '2px dashed #D1D5DB', borderRadius: 12, padding: '24px', background: '#FAFAFA', textAlign: 'center', opacity: 0.6 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Certificate Locked</div>
          <div style={{ fontSize: 13, color: '#9CA3AF' }}>
            Complete 3-Statement Financial Modeling to unlock this course and earn your BVM certificate.
          </div>
        </div>
      )}
      {!bvmLocked && (
        (finalPassed && courseCert) ? (
        <div style={{ border: '2px solid #C9A84C', borderRadius: 12, padding: '24px 28px', background: 'linear-gradient(135deg, #FFFBF0 0%, #FFF8E1 100%)', boxShadow: '0 4px 20px rgba(201,168,76,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>🏆 Certificate Earned</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0D2E5A', marginBottom: 2 }}>{courseCert.studentName}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 2 }}>{course.title}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Issued: {new Date(courseCert.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4, fontFamily: 'monospace' }}>ID: {courseCert.certificateId}</div>
            </div>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#C9A84C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🏆</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href={courseCert.certifierUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#2EAA4A', color: '#fff', textDecoration: 'none' }}>
              🏆 View Certificate
            </a>
            <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(courseCert.certifierUrl)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#0A66C2', color: '#fff', textDecoration: 'none' }}>
              in LinkedIn
            </a>
            <a href={`https://wa.me/?text=${encodeURIComponent(`I just earned my ${course.shortTitle} certificate from Financial Modeler Pro! 🎓\n\nCheck out the free course: https://financialmodelerpro.com/training\n\nVerify my certificate: ${courseCert.certifierUrl}`)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#25D366', color: '#fff', textDecoration: 'none' }}>
              WhatsApp
            </a>
            <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Just earned my ${course.shortTitle} certification! 🏆\n\nFree course at https://financialmodelerpro.com/training\n\n#FinancialModeling #Finance`)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#000', color: '#fff', textDecoration: 'none' }}>
              𝕏 Twitter
            </a>
            <button
              onClick={() => { navigator.clipboard.writeText(courseCert.certifierUrl).then(() => { setCopiedCert(true); setTimeout(() => setCopiedCert(false), 2500); }); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: copiedCert ? '#2EAA4A' : '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer' }}>
              {copiedCert ? '✓ Copied!' : '🔗 Copy Link'}
            </button>
            <button onClick={() => onShare(`earned my ${course.shortTitle} certificate`, courseCert.certifierUrl)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: 'rgba(201,168,76,0.15)', color: '#92600A', border: '1px solid rgba(201,168,76,0.4)', cursor: 'pointer' }}>
              🎉 Share Achievement
            </button>
            <a href={`https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(course.title)}&organizationName=Financial+Modeler+Pro&issueYear=${new Date(courseCert.issuedAt).getFullYear()}&issueMonth=${new Date(courseCert.issuedAt).getMonth()+1}&certUrl=${encodeURIComponent(courseCert.certifierUrl)}&certId=${encodeURIComponent(courseCert.certificateId)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#0A66C2', color: '#fff', textDecoration: 'none' }}>
              in Add Credential
            </a>
          </div>
          {/* QR Code */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(201,168,76,0.2)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(courseCert.certifierUrl)}`}
              alt="Certificate QR"
              width={80} height={80}
              style={{ borderRadius: 6, border: '1px solid #E5E7EB' }}
            />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 3 }}>Certificate QR Code</div>
              <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>Scan to verify your certificate instantly.<br />Share on your resume or LinkedIn profile.</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ border: '2px dashed #D1D5DB', borderRadius: 12, padding: '24px', background: '#FAFAFA', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🎓</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Certificate Not Yet Earned</div>
          <div style={{ fontSize: 13, color: '#9CA3AF' }}>
            {passedCount} of {regularSessions.length} sessions passed — complete all sessions and pass the Final Exam.
          </div>
        </div>
        )
      )}
    </div>
  );
}

// ── BVM Locked Content ────────────────────────────────────────────────────────

function BvmLockedContent({ sfmProgress, sfmTotal, onContinue }: { sfmProgress: number; sfmTotal: number; onContinue: () => void }) {
  const pct = sfmTotal > 0 ? Math.round((sfmProgress / sfmTotal) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '80px 24px', minHeight: 400 }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>🔒</div>
      <h2 style={{ fontSize: 'clamp(18px,3vw,24px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 12 }}>
        Business Valuation Modeling — Locked
      </h2>
      <p style={{ fontSize: 14, color: '#6B7280', maxWidth: 420, lineHeight: 1.6, marginBottom: 28 }}>
        Complete the 3-Statement Financial Modeling course to unlock Business Valuation Methods.
      </p>
      <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: '16px 28px', marginBottom: 28, minWidth: 260 }}>
        <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your 3SFM Progress</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#1B4F8A', marginBottom: 10 }}>{sfmProgress} / {sfmTotal} sessions completed</div>
        <div style={{ height: 6, borderRadius: 3, background: '#E5E7EB', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: '#2EAA4A', width: `${pct}%`, transition: 'width 0.6s' }} />
        </div>
      </div>
      <button onClick={onContinue}
        style={{ padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 700, background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer' }}>
        Continue 3SFM →
      </button>
    </div>
  );
}

// ── Main Dashboard Page ───────────────────────────────────────────────────────

export default function TrainingDashboardPage() {
  const router = useRouter();

  const [localSession, setLocalSession]           = useState<{ email: string; registrationId: string } | null>(null);
  const [loading, setLoading]                     = useState(true);
  const [refreshing, setRefreshing]               = useState(false);
  const [isFallback, setIsFallback]               = useState(false);
  const [progress, setProgress]                   = useState<ProgressData | null>(null);
  const [certificates, setCertificates]           = useState<Certificate[]>([]);
  const [activeCourse, setActiveCourse]           = useState('3sfm');
  const [liveLinks, setLiveLinks]                 = useState<LiveLinksMap>({});
  const [courseDescs, setCourseDescs]             = useState<CourseDescsMap>({});
  const [generating, setGenerating]               = useState(false);
  const [transcriptToast, setTranscriptToast]     = useState('');
  const [lastUpdated, setLastUpdated]             = useState<Date | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed]   = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // share + testimonials
  const [shareModal, setShareModal]               = useState<{ label: string; certUrl?: string } | null>(null);
  const [testimonialModal, setTestimonialModal]   = useState<'written' | 'video' | null>(null);
  const [testimonialSubmitted, setTestimonialSubmitted] = useState(false);
  const [dashToast, setDashToast]                 = useState('');
  // streak / gamification
  const [streak, setStreak]                       = useState(0);
  const [points, setPoints]                       = useState(0);
  const [badges, setBadges]                       = useState<{ badge_key: string; earned_at: string }[]>([]);
  const [newBadgeToast, setNewBadgeToast]         = useState('');
  // notes
  const [notes, setNotes]                         = useState<Record<string, string>>({});
  // feedback
  const [feedbackGiven, setFeedbackGiven]         = useState<Set<string>>(new Set());
  const [feedbackModal, setFeedbackModal]         = useState<{ sessionKey: string; sessionTitle: string } | null>(null);
  // profile
  const [profileModal, setProfileModal]           = useState(false);
  const [profileDropdown, setProfileDropdown]     = useState(false);
  const [studentProfile, setStudentProfile]       = useState<{ job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; display_name?: string; avatar_url?: string } | null>(null);
  const [avatarUploading, setAvatarUploading]     = useState(false);
  const sidebarFileInputRef                       = useRef<HTMLInputElement>(null);
  // share CMS text (fetched once, cached 10 min)
  const [shareCms, setShareCms]                   = useState<{ title: string; messageTemplate: string }>({ title: '', messageTemplate: '' });

  // Restore sidebar state from localStorage (client-only)
  useEffect(() => {
    if (localStorage.getItem('dashboardSidebarCollapsed') === 'true') setSidebarCollapsed(true);
  }, []);

  // Fetch share CMS text once on mount
  useEffect(() => {
    fetch('/api/cms?section=training&keys=share_achievement_title,share_default_message')
      .then(r => r.json())
      .then((j: { map?: Record<string, string> }) => {
        const title = j.map?.['training__share_achievement_title'] ?? '';
        const msg   = j.map?.['training__share_default_message'] ?? '';
        if (title || msg) setShareCms({ title, messageTemplate: msg });
      })
      .catch(() => {});
  }, []);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('dashboardSidebarCollapsed', String(next));
  }

  const loadData = useCallback(async (
    sess: { email: string; registrationId: string },
    forceRefresh = false,
  ) => {
    // ── Issue 4: Show cached progress immediately, then refresh in background ─
    const CACHE_KEY = `fmp_progress_${sess.registrationId}`;
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { data: ProgressData; at: number };
          if (Date.now() - cached.at < CACHE_TTL) {
            setProgress(cached.data);
            setLoading(false); // show cached data instantly; fetch continues in background
          }
        }
      } catch { /* ignore — stale or corrupt cache */ }
    }

    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setIsFallback(false);
    try {
      const progressParams = new URLSearchParams({ email: sess.email, registrationId: sess.registrationId });
      if (forceRefresh) progressParams.set('refresh', '1');

      // ── Fetch progress + course-details + notes + profile in PARALLEL ───
      const [progressRes, detailsRes, notesRes, profileRes] = await Promise.all([
        fetch(`/api/training/progress?${progressParams}`),
        fetch('/api/training/course-details'),
        fetch(`/api/training/notes?registrationId=${encodeURIComponent(sess.registrationId)}`),
        fetch(`/api/training/profile?registrationId=${encodeURIComponent(sess.registrationId)}`),
      ]);

      const [json, detailsJson, notesJson, profileJson] = await Promise.all([
        progressRes.json() as Promise<{ success: boolean; fallback?: boolean; data?: ProgressData }>,
        detailsRes.json() as Promise<{ sessions?: LiveSessionLink[]; courses?: CourseDescsMap }>,
        notesRes.json() as Promise<{ notes?: { session_key: string; content: string }[] }>,
        profileRes.json() as Promise<{ profile?: { job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; streak_days?: number; total_points?: number; display_name?: string; avatar_url?: string } | null }>,
      ]);

      // Apply notes
      const notesMap: Record<string, string> = {};
      for (const n of notesJson.notes ?? []) notesMap[n.session_key] = n.content;
      setNotes(notesMap);

      // Apply profile + streak/points
      if (profileJson.profile) {
        setStudentProfile(profileJson.profile);
        setStreak(profileJson.profile.streak_days ?? 0);
        setPoints(profileJson.profile.total_points ?? 0);
      }

      // Apply course-details
      const map: LiveLinksMap = {};
      for (const s of detailsJson.sessions ?? []) map[s.tabKey] = s;
      // Debug: verify final session data and video durations from Apps Script
      console.log('[CourseDetails] 3SFM_Final:', map['3SFM_Final'] ?? 'NOT FOUND — check Apps Script tabKey');
      console.log('[CourseDetails] BVM_Final:', map['BVM_Final'] ?? 'NOT FOUND — check Apps Script tabKey');
      console.log('[CourseDetails] 3SFM_S1 duration:', map['3SFM_S1']?.videoDuration ?? 'undefined — check Apps Script col J');
      setLiveLinks(map);
      if (detailsJson.courses) setCourseDescs(detailsJson.courses);

      // Apply progress
      if (json.success && json.data) {
        setProgress(json.data);
        setLastUpdated(new Date());
        // Persist to localStorage so next load shows data instantly
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: json.data, at: Date.now() })); } catch { /* ignore */ }
        // Fire activity (streak/badges) — fire-and-forget
        const sessionsPassed = json.data.sessions.filter(s => s.passed).length;
        const hasPerfect = json.data.sessions.some(s => s.passed && s.score === 100);
        fetch('/api/training/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: sess.registrationId, sessionsPassed, hasPerfect }),
        }).then(r => r.json()).then((act: { ok?: boolean; streak?: number; points?: number; badges?: { badge_key: string; earned_at: string }[]; newBadges?: string[] }) => {
          if (act.ok) {
            setStreak(act.streak ?? 0);
            setPoints(act.points ?? 0);
            setBadges(act.badges ?? []);
            if (act.newBadges && act.newBadges.length > 0) {
              setNewBadgeToast(`🏅 New badge earned: ${act.newBadges[0].replace(/_/g, ' ')}`);
              setTimeout(() => setNewBadgeToast(''), 4000);
            }
          }
        }).catch(() => {});
        if (json.fallback) setIsFallback(true);
        if (json.data.certificateIssued) {
          const certRes  = await fetch(`/api/training/certificate?email=${encodeURIComponent(sess.email)}`);
          const certJson = await certRes.json() as { success: boolean; data?: Certificate[] };
          if (certJson.success && certJson.data) setCertificates(certJson.data);
        }
      } else {
        setProgress({ student: { name: sess.registrationId, email: sess.email, registrationId: sess.registrationId, course: '3sfm', registeredAt: '' }, sessions: [], finalPassed: false, certificateIssued: false });
        setIsFallback(true);
      }
    } catch {
      setProgress({ student: { name: sess.registrationId, email: sess.email, registrationId: sess.registrationId, course: '3sfm', registeredAt: '' }, sessions: [], finalPassed: false, certificateIssued: false });
      setIsFallback(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/login'); return; }
    setLocalSession(sess);
    loadData(sess);
    // Restore testimonial submitted state from localStorage
    try {
      if (localStorage.getItem(`fmp_test_${sess.registrationId}`) === 'true') {
        setTestimonialSubmitted(true);
      }
    } catch { /* ignore */ }
  }, [router, loadData]);

  async function downloadTranscript() {
    if (!localSession || !progress) return;
    setGenerating(true);
    setTranscriptToast('');
    try {
      const params = new URLSearchParams({ regId: localSession.registrationId, email: localSession.email });
      const res = await fetch(`/api/training/transcript?${params}`);
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `FMP-Transcript-${localSession.registrationId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setTranscriptToast('Could not generate transcript. Please try again.');
      setTimeout(() => setTranscriptToast(''), 4000);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSidebarPhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !localSession) return;
    const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!ALLOWED.includes(file.type)) {
      setDashToast('Invalid file type. Use JPG, PNG, or WebP.');
      setTimeout(() => setDashToast(''), 4000);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setDashToast('Upload failed — please try a smaller image');
      setTimeout(() => setDashToast(''), 4000);
      return;
    }
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('regId', localSession.registrationId);
      const res = await fetch('/api/training/upload-avatar', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');
      const busted = `${data.url}?v=${Date.now()}`;
      // Persist to profile
      await fetch('/api/training/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: localSession.registrationId, avatarUrl: busted }),
      });
      setStudentProfile(prev => prev ? { ...prev, avatar_url: busted } : { avatar_url: busted });
      setDashToast('Profile photo updated');
      setTimeout(() => setDashToast(''), 3000);
    } catch {
      setDashToast('Upload failed — please try a smaller image');
      setTimeout(() => setDashToast(''), 4000);
    } finally {
      setAvatarUploading(false);
      // Reset input so same file can be re-selected
      if (sidebarFileInputRef.current) sidebarFileInputRef.current.value = '';
    }
  }

  async function handleLogout() {
    await fetch('/api/training/logout', { method: 'POST' });
    clearTrainingSession();
    router.replace('/training');
  }

  async function saveNote(sessionKey: string, content: string) {
    if (!localSession) return;
    setNotes(prev => ({ ...prev, [sessionKey]: content }));
    await fetch('/api/training/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: localSession.registrationId, sessionKey, content }),
    });
  }

  async function saveFeedback(sessionKey: string, rating: number, comment: string) {
    if (!localSession) return;
    setFeedbackGiven(prev => new Set([...prev, sessionKey]));
    await fetch('/api/training/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: localSession.registrationId, sessionKey, rating, comment }),
    });
  }

  if (!localSession && !loading) return null;

  const enrolledCourses = progress ? getEnrolledCourses(progress.student.course) : [];
  const progressMap     = progress ? buildProgressMap(progress.sessions) : new Map<string, SessionProgress>();

  // BVM unlock: all 17 3SFM sessions + S18 final must be passed
  const sfmFinalSession = COURSES['3sfm']?.sessions.find(s => s.isFinal);
  const bvmUnlocked     = allRegularSessionsPassed('3sfm', progressMap) &&
    (sfmFinalSession ? progressMap.get(sfmFinalSession.id)?.passed === true : false);

  // 3SFM stats (for BVM locked state)
  const sfmRegular    = COURSES['3sfm']?.sessions.filter(s => !s.isFinal) ?? [];
  const sfmPassedCount = sfmRegular.filter(s => progressMap.get(s.id)?.passed).length;

  // Student avatar initials — prefer profile display_name over registration name
  const studentName = studentProfile?.display_name || progress?.student.name || '';
  const initials = studentName.split(' ').map((w: string) => w[0] ?? '').filter(Boolean).join('').toUpperCase().slice(0, 2) || 'ST';
  const avatarUrl = studentProfile?.avatar_url || '';

  // Overall progress
  const totalSessions = enrolledCourses.reduce((s, cId) => s + (COURSES[cId]?.sessions.filter(x => !x.isFinal).length ?? 0), 0);
  const totalPassed   = enrolledCourses.reduce((s, cId) => {
    const c = COURSES[cId]; if (!c) return s;
    return s + c.sessions.filter(x => !x.isFinal && progressMap.get(x.id)?.passed).length;
  }, 0);

  const isEnrolledInBvm = enrolledCourses.includes('bvm');

  // What to show in main area
  const showLockedBvm = activeCourse === 'bvm' && !bvmUnlocked;
  // Effective course to render (fall back to first enrolled if activeCourse not enrolled)
  const displayCourse = enrolledCourses.includes(activeCourse) ? activeCourse : (enrolledCourses[0] ?? '3sfm');

  const sidebarW = sidebarCollapsed ? 60 : 260;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>

      {/* ── Global styles ──────────────────────────────────────────────────── */}
      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .dash-hamburger { display: none !important; }
        .dash-mob-backdrop { display: none !important; }
        @media (max-width: 767px) {
          .dash-hamburger { display: flex !important; }
          .dash-sidebar {
            position: fixed !important;
            left: ${mobileSidebarOpen ? '0' : '-270px'} !important;
            top: 0 !important; bottom: 0 !important;
            z-index: 200 !important;
            width: 260px !important;
            transition: left 0.3s ease !important;
            overflow-y: auto !important;
          }
          .dash-mob-backdrop {
            display: ${mobileSidebarOpen ? 'block' : 'none'} !important;
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5); z-index: 199;
          }
          .dash-sidebar-toggle { display: none !important; }
          .dash-main { padding: 16px 16px 48px !important; }
          .dash-stats-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* Mobile backdrop */}
      <div className="dash-mob-backdrop" onClick={() => setMobileSidebarOpen(false)} />

      {/* ── TOP NAV ──────────────────────────────────────────────────────────── */}
      <div style={{ background: '#0D2E5A', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 150, boxShadow: '0 2px 12px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Mobile hamburger */}
          <button
            className="dash-hamburger"
            onClick={() => setMobileSidebarOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            ☰
          </button>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📐</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1 }}>Financial Modeler Pro</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Training Hub</div>
            </div>
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdated && !loading && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => localSession && loadData(localSession, true)}
            disabled={loading || refreshing}
            title="Refresh progress"
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: refreshing ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: loading || refreshing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }}>↻</span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => setShareModal({ label: 'am learning Financial Modeling' })}
            title="Share your progress"
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            🔗 Share
          </button>
          {/* Profile avatar dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setProfileDropdown(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px 4px 4px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, cursor: 'pointer', color: '#fff' }}
            >
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', overflow: 'hidden', flexShrink: 0 }}>
                {avatarUrl ? <img src={avatarUrl} alt={studentName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {studentName || localSession?.registrationId || 'Student'}
              </span>
              <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
            </button>
            {profileDropdown && (
              <div
                style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: '#fff', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.18)', minWidth: 180, zIndex: 300, overflow: 'hidden', border: '1px solid #E5E7EB' }}
                onMouseLeave={() => setProfileDropdown(false)}
              >
                <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{studentName || 'Student'}</div>
                  {studentProfile?.linkedin_url && (
                    <a href={studentProfile.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#0A66C2', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
                      in LinkedIn Profile ↗
                    </a>
                  )}
                </div>
                {[
                  { icon: '👤', label: 'Edit Profile', action: () => { setProfileModal(true); setProfileDropdown(false); } },
                  { icon: '🚪', label: 'Logout', action: () => { setProfileDropdown(false); handleLogout(); }, color: '#DC2626' },
                ].map(item => (
                  <button key={item.label} onClick={item.action}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', fontSize: 13, color: item.color ?? '#374151', cursor: 'pointer', fontWeight: 600, textAlign: 'left' }}>
                    <span>{item.icon}</span> {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>

        {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
        <aside className="dash-sidebar" style={{
          width: sidebarW, flexShrink: 0,
          background: '#0D2E5A',
          display: 'flex', flexDirection: 'column',
          position: 'sticky', top: 56,
          height: 'calc(100vh - 56px)',
          overflowY: 'auto', overflowX: 'hidden',
          transition: 'width 0.3s ease',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}>

          {/* ─ Mobile close button ─ */}
          <div className="dash-hamburger" style={{ padding: '12px 16px 0', justifyContent: 'flex-end' }}>
            <button onClick={() => setMobileSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer', padding: 4 }}>✕</button>
          </div>

          {/* ─ Student Info ─ */}
          <div style={{ padding: sidebarCollapsed ? '16px 8px' : '16px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: sidebarCollapsed ? 'center' : 'flex-start' }}>
                <Skeleton w={40} h={40} radius={20} />
                {!sidebarCollapsed && <><Skeleton w={120} h={13} /><Skeleton w={80} h={11} /></>}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: sidebarCollapsed ? 0 : 10 }}>
                  {/* Clickable avatar with upload overlay */}
                  <div
                    title="Change profile photo"
                    className="sidebar-avatar-btn"
                    onClick={() => sidebarFileInputRef.current?.click()}
                    style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0, overflow: 'visible', cursor: 'pointer' }}
                  >
                    {/* Avatar circle */}
                    <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#2EAA4A', fontSize: 14, fontWeight: 800, color: '#fff', position: 'relative' }}>
                      {avatarUploading ? (
                        <div style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      ) : avatarUrl ? (
                        <img src={avatarUrl} alt={studentName} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
                      ) : initials}
                      {/* Hover overlay */}
                      {!avatarUploading && (
                        <div className="avatar-hover-overlay" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </div>
                      )}
                    </div>
                    {/* Camera badge — always visible bottom-right */}
                    {!avatarUploading && (
                      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: '#1d4ed8', border: '1.5px solid #0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                      </div>
                    )}
                    {/* Hidden file input */}
                    <input
                      ref={sidebarFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      onChange={handleSidebarPhotoUpload}
                    />
                  </div>
                  {!sidebarCollapsed && (
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {studentName || 'Student'}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', marginTop: 1 }}>
                        {progress?.student.registrationId}
                      </div>
                    </div>
                  )}
                </div>
                {!sidebarCollapsed && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Overall Progress</span>
                      <span style={{ fontSize: 10, color: '#2EAA4A', fontWeight: 700 }}>{totalPassed}/{totalSessions}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, background: '#2EAA4A', width: `${totalSessions > 0 ? (totalPassed / totalSessions) * 100 : 0}%` }} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ─ Courses + Achievements ─ */}
          <div style={{ padding: sidebarCollapsed ? '10px 6px' : '10px 10px', flex: 1 }}>

            {/* Section label */}
            {!sidebarCollapsed && (
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '6px 4px 6px', marginBottom: 2 }}>
                My Courses
              </div>
            )}

            {/* Enrolled course buttons */}
            {enrolledCourses.map(cId => {
              const c = COURSES[cId];
              if (!c) return null;
              const cReg    = c.sessions.filter(s => !s.isFinal);
              const cPassed = cReg.filter(s => progressMap.get(s.id)?.passed).length;
              const cPct    = cReg.length > 0 ? Math.round((cPassed / cReg.length) * 100) : 0;
              const isActive = activeCourse === cId;
              const isLocked = cId === 'bvm' && !bvmUnlocked;
              const icon = c.shortTitle === '3SFM' ? '📈' : '📊';

              if (sidebarCollapsed) {
                return (
                  <button key={cId} onClick={() => setActiveCourse(cId)}
                    title={isLocked ? `${c.shortTitle} — Locked` : `${c.shortTitle}: ${cPassed}/${cReg.length}`}
                    style={{ width: '100%', background: isActive ? '#1B4F8A' : 'transparent', border: 'none', borderLeft: `3px solid ${isActive ? '#2EAA4A' : 'transparent'}`, borderRadius: 6, padding: '10px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4, fontSize: 18 }}>
                    {isLocked ? '🔒' : icon}
                  </button>
                );
              }

              return (
                <button key={cId} onClick={() => setActiveCourse(cId)}
                  style={{ width: '100%', textAlign: 'left', background: isActive ? '#1B4F8A' : 'rgba(255,255,255,0.04)', border: `1px solid ${isActive ? 'rgba(255,255,255,0.1)' : 'transparent'}`, borderLeft: `3px solid ${isActive ? '#2EAA4A' : 'transparent'}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer', marginBottom: 6, transition: 'background 0.15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isLocked ? 0 : 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>{isLocked ? '🔒' : icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isLocked ? 'rgba(255,255,255,0.35)' : '#fff' }}>{c.shortTitle}</span>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: isLocked ? 'rgba(255,255,255,0.06)' : cPct === 100 ? '#C9A84C' : cPassed > 0 ? '#2EAA4A' : 'rgba(255,255,255,0.08)', color: isLocked ? 'rgba(255,255,255,0.25)' : '#fff' }}>
                      {isLocked ? 'LOCKED' : cPct === 100 ? 'DONE' : cPassed > 0 ? 'IN PROGRESS' : 'START'}
                    </span>
                  </div>
                  {!isLocked && (
                    <>
                      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: 4 }}>
                        <div style={{ height: '100%', borderRadius: 2, background: cPct === 100 ? '#C9A84C' : '#2EAA4A', width: `${cPct}%` }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{cPassed} / {cReg.length} sessions</div>
                    </>
                  )}
                  {isLocked && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>Complete 3SFM to unlock</div>}
                </button>
              );
            })}

            {/* BVM hint / Start Another Course */}
            {!isEnrolledInBvm && (
              sidebarCollapsed ? (
                bvmUnlocked ? (
                  <a href="/training/register?course=bvm" title="Enrol in BVM"
                    style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 0', cursor: 'pointer', color: '#2EAA4A', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                    ➕
                  </a>
                ) : (
                  <div title="BVM — Complete 3SFM first" style={{ width: '100%', padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'rgba(255,255,255,0.2)' }}>🔒</div>
                )
              ) : bvmUnlocked ? (
                <a href="/training/register?course=bvm"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, background: 'rgba(46,170,74,0.1)', border: '1px dashed rgba(46,170,74,0.35)', color: '#2EAA4A', textDecoration: 'none', fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                  ➕ Enrol in BVM →
                </a>
              ) : (
                <button onClick={() => setActiveCourse('bvm')}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.25)', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                  🔒 BVM — Complete 3SFM first
                </button>
              )
            )}

            {/* ─ Streak & Points ─ */}
            {!sidebarCollapsed && (streak > 0 || points > 0) && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', marginTop: 8, marginBottom: 4, display: 'flex', gap: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16 }}>🔥</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: streak >= 5 ? '#F59E0B' : '#fff' }}>{streak}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>day streak</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16 }}>⭐</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#C9A84C' }}>{points}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>points</div>
                </div>
                {badges.length > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16 }}>🏅</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{badges.length}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>badges</div>
                  </div>
                )}
              </div>
            )}

            {/* ─ Badges grid ─ */}
            {!sidebarCollapsed && badges.length > 0 && (() => {
              const BADGE_META: Record<string, { icon: string; label: string }> = {
                first_step:   { icon: '👣', label: 'First Step' },
                on_fire:      { icon: '🔥', label: 'On Fire' },
                unstoppable:  { icon: '⚡', label: 'Unstoppable' },
                halfway:      { icon: '🎯', label: 'Halfway' },
                almost_there: { icon: '🚀', label: 'Almost There' },
                certified:    { icon: '🏆', label: 'Certified' },
                perfect_score:{ icon: '💯', label: 'Perfect Score' },
                speed_runner: { icon: '⚡', label: 'Speed Runner' },
              };
              return (
                <div style={{ padding: '6px 4px 2px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 6 }}>Badges</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {badges.map(b => {
                      const meta = BADGE_META[b.badge_key];
                      if (!meta) return null;
                      return (
                        <span key={b.badge_key} title={meta.label} style={{ fontSize: 16, cursor: 'default' }}>{meta.icon}</span>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ─ Achievements ─ */}
            {!sidebarCollapsed && (
              <>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '14px 4px 6px', marginTop: 4 }}>
                  My Achievements
                </div>

                {/* Certificates */}
                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: certificates.length > 0 ? '#C9A84C' : 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
                    🏆 Certificates ({certificates.length})
                  </div>
                  {certificates.length === 0 ? (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Complete a course to earn your certificate</div>
                  ) : (
                    certificates.map(cert => (
                      <a key={cert.certificateId} href={cert.certifierUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', fontSize: 11, color: '#C9A84C', textDecoration: 'none', marginTop: 4 }}>
                        {cert.course.toUpperCase()} — View →
                      </a>
                    ))
                  )}
                </div>

                {/* Transcript */}
                <button onClick={downloadTranscript} disabled={totalPassed === 0 || generating}
                  title={totalPassed === 0 ? 'Complete at least one session first' : undefined}
                  style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', color: totalPassed === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 600, cursor: totalPassed === 0 || generating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📄</span> {generating ? 'Generating…' : 'Download Transcript'}
                </button>
                {transcriptToast && (
                  <div style={{ fontSize: 10, color: '#FCA5A5', padding: '4px 4px', marginTop: 4 }}>⚠️ {transcriptToast}</div>
                )}

                {/* Testimonial shortcut */}
                {totalPassed >= 1 && !testimonialSubmitted && (
                  <button onClick={() => setTestimonialModal('written')}
                    style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8, background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)', color: '#C9A84C', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span>⭐</span> Share Your Experience
                  </button>
                )}
              </>
            )}

            {/* Collapsed achievements icons */}
            {sidebarCollapsed && (
              <div style={{ marginTop: 8 }}>
                <button title={totalPassed === 0 ? 'Complete sessions first' : 'Download Transcript'} onClick={downloadTranscript} disabled={totalPassed === 0 || generating}
                  style={{ width: '100%', background: 'transparent', border: 'none', padding: '10px 0', cursor: totalPassed === 0 ? 'default' : 'pointer', color: totalPassed === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.45)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  📄
                </button>
                {certificates.length > 0 && (
                  <div title={`${certificates.length} Certificate${certificates.length > 1 ? 's' : ''}`} style={{ width: '100%', padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                    🏆
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─ Account ─ */}
          {!sidebarCollapsed && (
            <div style={{ padding: '10px 10px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', padding: '4px 4px 8px' }}>
                Account
              </div>
              {progress?.student.email && (
                <div style={{ padding: '4px 4px 8px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Email</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {progress.student.email}
                  </div>
                  {studentProfile?.job_title && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{studentProfile.job_title}{studentProfile.company ? ` · ${studentProfile.company}` : ''}</div>
                  )}
                </div>
              )}
              <button onClick={() => setProfileModal(true)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                👤 Edit Profile
              </button>
              <button onClick={handleLogout}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                🚪 Logout
              </button>
            </div>
          )}

          {/* ─ Collapse toggle ─ */}
          <button className="dash-sidebar-toggle" onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ margin: '8px auto 12px', width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
        <main className="dash-main" style={{ flex: 1, minWidth: 0, padding: '28px 28px 64px', overflowY: 'auto' }}>

          {/* Fallback banner */}
          {!loading && isFallback && progress && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#92400E' }}>
                ⚡ Could not load latest progress — showing your course structure. Your data will appear after the next sync.
              </span>
              <button onClick={() => localSession && loadData(localSession)}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div>
              <div style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', marginBottom: 20, border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Skeleton w="55%" h={26} />
                <Skeleton w="40%" h={16} />
                <Skeleton w="100%" h={8} radius={4} />
              </div>
              <div className="dash-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} style={{ background: '#fff', borderRadius: 10, padding: 16, border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Skeleton w={28} h={28} radius={6} />
                    <Skeleton w="60%" h={22} />
                    <Skeleton w="80%" h={11} />
                  </div>
                ))}
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 8, padding: '14px 18px', marginBottom: 8, border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <Skeleton w="50%" h={14} />
                    <Skeleton w={80} h={22} radius={20} />
                  </div>
                  <Skeleton w="30%" h={12} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Skeleton w={90} h={28} radius={6} />
                    <Skeleton w={120} h={28} radius={6} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Course content */}
          {!loading && progress && (
            <CourseContent
              courseId={activeCourse === 'bvm' ? 'bvm' : displayCourse}
              progressMap={progressMap}
              certificates={certificates}
              liveLinks={liveLinks}
              courseDescs={courseDescs}
              regId={localSession?.registrationId ?? ''}
              onDownloadTranscript={downloadTranscript}
              generating={generating}
              studentName={progress?.student.name ?? ''}
              studentEmail={progress?.student.email ?? ''}
              onShare={(label, certUrl) => setShareModal({ label, certUrl })}
              testimonialSubmitted={testimonialSubmitted}
              onOpenTestimonial={type => setTestimonialModal(type)}
              notes={notes}
              onNoteSave={saveNote}
              feedbackGiven={feedbackGiven}
              onFeedbackRequest={(sessionKey, sessionTitle) => setFeedbackModal({ sessionKey, sessionTitle })}
              bvmLocked={showLockedBvm}
              sfmProgress={sfmPassedCount}
              sfmTotal={sfmRegular.length}
              onSwitchTo3sfm={() => setActiveCourse('3sfm')}
            />
          )}
        </main>
      </div>

      {/* ── Share Modal ─────────────────────────────────────────────────────── */}
      {shareModal && (
        <ShareModal
          label={shareModal.label}
          certUrl={shareModal.certUrl}
          cmsTitle={shareCms.title}
          cmsMessageTemplate={shareCms.messageTemplate}
          onClose={() => setShareModal(null)}
          onCopyDone={() => { setDashToast('Link copied to clipboard!'); setTimeout(() => setDashToast(''), 2500); }}
        />
      )}

      {/* ── Testimonial Modal ───────────────────────────────────────────────── */}
      {testimonialModal && localSession && progress && (
        <TestimonialModal
          mode={testimonialModal}
          studentName={progress.student.name}
          studentEmail={progress.student.email}
          regId={localSession.registrationId}
          courseCode={activeCourse}
          courseName={COURSES[activeCourse]?.title ?? activeCourse.toUpperCase()}
          onClose={() => setTestimonialModal(null)}
          onSuccess={() => {
            setTestimonialSubmitted(true);
            try { localStorage.setItem(`fmp_test_${localSession.registrationId}`, 'true'); } catch { /* ignore */ }
            setDashToast('Thank you! Your testimonial has been submitted for review.');
            setTimeout(() => setDashToast(''), 4000);
          }}
        />
      )}

      {/* ── Dashboard toast ─────────────────────────────────────────────────── */}
      {dashToast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '11px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 700, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', maxWidth: 340 }}>
          {dashToast}
        </div>
      )}

      {/* ── Badge toast ──────────────────────────────────────────────────────── */}
      {newBadgeToast && (
        <div style={{ position: 'fixed', bottom: 64, right: 24, background: '#92400E', color: '#fff', padding: '11px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 700, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: 300 }}>
          {newBadgeToast}
        </div>
      )}

      {/* ── Session Feedback Modal ───────────────────────────────────────────── */}
      {feedbackModal && localSession && (
        <FeedbackModal
          sessionTitle={feedbackModal.sessionTitle}
          onClose={() => setFeedbackModal(null)}
          onSubmit={(rating, comment) => {
            saveFeedback(feedbackModal.sessionKey, rating, comment);
            setFeedbackModal(null);
            setDashToast('Thanks for your feedback!');
            setTimeout(() => setDashToast(''), 2500);
          }}
        />
      )}

      {/* ── Profile Modal ────────────────────────────────────────────────────── */}
      {profileModal && localSession && (
        <ProfileModal
          registrationId={localSession.registrationId}
          initial={studentProfile}
          onClose={() => setProfileModal(false)}
          onSave={(profile) => {
            setStudentProfile(profile);
            setProfileModal(false);
            setDashToast('Profile saved!');
            setTimeout(() => setDashToast(''), 2500);
          }}
        />
      )}
    </div>
  );
}

// ── Share Modal ───────────────────────────────────────────────────────────────

function ShareModal({ label, certUrl, cmsTitle, cmsMessageTemplate, onClose, onCopyDone }: {
  label: string;
  certUrl?: string;
  cmsTitle?: string;
  cmsMessageTemplate?: string;
  onClose: () => void;
  onCopyDone: () => void;
}) {
  const pageUrl  = 'https://financialmodelerpro.com/training';
  const shareUrl = certUrl || pageUrl;
  const defaultMsg = `I just ${label} at Financial Modeler Pro!\n\nBuilding institutional-grade financial models — Free certification program: ${pageUrl}${certUrl ? `\n\nVerify certificate: ${certUrl}` : ''}\n\n#FinancialModeling #CorporateFinance #FinancialModelerPro`;
  const resolvedMsg = cmsMessageTemplate
    ? cmsMessageTemplate.replace('{action}', label) + (certUrl ? `\n\nVerify certificate: ${certUrl}` : '')
    : defaultMsg;
  const [msg, setMsg] = useState(resolvedMsg);
  const modalTitle = cmsTitle || '🎉 Share Your Achievement';

  const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  const twUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just ${label} at Financial Modeler Pro! 🏆\n\nFree certification: ${pageUrl}\n\n#FinancialModeling #Finance`)}`;

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => { onCopyDone(); onClose(); }).catch(() => { onCopyDone(); onClose(); });
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '28px 28px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0D2E5A' }}>{modalTitle}</div>
          <button onClick={onClose} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>✕</button>
        </div>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={5}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', marginBottom: 18, color: '#374151' }} />
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Share on:</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <a href={liUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#0A66C2', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            in LinkedIn
          </a>
          <a href={waUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#25D366', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            WhatsApp
          </a>
          <a href={twUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#000', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            𝕏 Twitter/X
          </a>
          <button onClick={copyLink}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 20, background: '#1B4F8A', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            🔗 Copy Link
          </button>
        </div>
        <button onClick={onClose}
          style={{ width: '100%', padding: '9px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, color: '#6B7280', cursor: 'pointer', fontWeight: 600 }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ── Testimonial Modal ─────────────────────────────────────────────────────────

function TestimonialModal({ mode, studentName, studentEmail, regId, courseCode, courseName, onClose, onSuccess }: {
  mode: 'written' | 'video';
  studentName: string;
  studentEmail: string;
  regId: string;
  courseCode: string;
  courseName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [content, setContent]         = useState('');
  const [rating, setRating]           = useState(5);
  const [videoUrl, setVideoUrl]       = useState('');
  const [jobTitle, setJobTitle]       = useState('');
  const [company, setCompany]         = useState('');
  const [location, setLocation]       = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [consent, setConsent]         = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState(false);

  async function handleSubmit() {
    if (!consent) { setError('Please give your consent to submit.'); return; }
    if (mode === 'written' && content.trim().length < 50) { setError('Please write at least 50 characters.'); return; }
    if (mode === 'video' && !videoUrl.trim()) { setError('Please enter a video URL.'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/testimonials/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: regId, studentName, studentEmail, courseCode, courseName, type: mode, content, rating, videoUrl, jobTitle, company, location, linkedinUrl }),
      });
      if (res.status === 409) { setError('You have already submitted a testimonial for this course.'); setSubmitting(false); return; }
      if (!res.ok) throw new Error();
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 2800);
    } catch { setError('Submission failed. Please try again.'); }
    setSubmitting(false);
  }

  if (success) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: '44px 32px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>{mode === 'video' ? '🎥' : '✅'}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0D2E5A', marginBottom: 8 }}>Thank you!</div>
          <div style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>
            {mode === 'video'
              ? 'Our team will review your video testimonial and be in touch.'
              : 'Your testimonial has been submitted for review. We\'ll notify you when it\'s published.'}
          </div>
        </div>
      </div>
    );
  }

  const fields = [
    { label: 'Job Title', value: jobTitle,    setter: setJobTitle,    placeholder: 'e.g. Financial Analyst' },
    { label: 'Company',   value: company,     setter: setCompany,     placeholder: 'e.g. Goldman Sachs' },
    { label: 'Location',  value: location,    setter: setLocation,    placeholder: 'e.g. Lahore, Pakistan' },
    { label: 'LinkedIn',  value: linkedinUrl, setter: setLinkedinUrl, placeholder: 'https://linkedin.com/in/...' },
  ];

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '26px 26px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0D2E5A' }}>
            {mode === 'video' ? '🎥 Submit Video Testimonial' : '📝 Write Your Testimonial'}
          </div>
          <button onClick={onClose} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>✕</button>
        </div>

        {/* Auto-filled */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[{ label: 'Course', val: courseName }, { label: 'Your Name', val: studentName || 'Student' }].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>{f.label.toUpperCase()}</div>
              <div style={{ padding: '8px 10px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, color: '#374151' }}>{f.val}</div>
            </div>
          ))}
        </div>

        {mode === 'written' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 6 }}>RATING</div>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1,2,3,4,5].map(i => (
                  <button key={i} onClick={() => setRating(i)}
                    style={{ fontSize: 26, background: 'none', border: 'none', cursor: 'pointer', color: i <= rating ? '#F59E0B' : '#E5E7EB', padding: '0 1px', lineHeight: 1 }}>
                    ★
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>YOUR EXPERIENCE <span style={{ color: '#DC2626' }}>*</span></div>
              <textarea value={content} onChange={e => setContent(e.target.value.slice(0, 500))} rows={5}
                placeholder="This course completely transformed how I build financial models..."
                style={{ width: '100%', padding: '9px 11px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, fontFamily: 'Inter,sans-serif', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', color: '#374151' }} />
              <div style={{ fontSize: 10, color: content.length < 50 && content.length > 0 ? '#DC2626' : '#9CA3AF', marginTop: 3 }}>
                {content.length}/500{content.length < 50 && content.length > 0 ? ` — ${50 - content.length} more required` : ''}
              </div>
            </div>
          </>
        )}

        {mode === 'video' && (
          <>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '11px 14px', marginBottom: 14, fontSize: 12, color: '#1E40AF', lineHeight: 1.7 }}>
              <strong>Option 1 — Loom (free &amp; easy):</strong> Record at loom.com, paste share link below.<br />
              <strong>Option 2 — YouTube:</strong> Upload as Unlisted, paste the YouTube URL below.
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>VIDEO URL <span style={{ color: '#DC2626' }}>*</span></div>
              <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                placeholder="https://loom.com/share/... or https://youtube.com/watch?v=..."
                style={{ width: '100%', padding: '9px 11px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
            </div>
          </>
        )}

        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8, fontWeight: 600 }}>Optional: Add your details (shown publicly with testimonial)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {fields.map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', marginBottom: 3 }}>{f.label.toUpperCase()}</div>
              <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: 'pointer', fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
          I consent to this testimonial being displayed on the Financial Modeler Pro website.
        </label>

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSubmit} disabled={submitting || !consent}
            style={{ flex: 1, padding: '11px', background: submitting || !consent ? '#9CA3AF' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: submitting || !consent ? 'not-allowed' : 'pointer' }}>
            {submitting ? 'Submitting…' : mode === 'video' ? '🎥 Submit Video' : '📝 Submit Testimonial'}
          </button>
          <button onClick={onClose}
            style={{ padding: '11px 18px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, color: '#6B7280', cursor: 'pointer', fontWeight: 600 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Feedback Modal ────────────────────────────────────────────────────────────

function FeedbackModal({ sessionTitle, onClose, onSubmit }: {
  sessionTitle: string;
  onClose: () => void;
  onSubmit: (rating: number, comment: string) => void;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 420, padding: '24px 24px 20px', boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0D2E5A' }}>⭐ Rate This Session</div>
          <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 14, fontWeight: 600 }}>{sessionTitle}</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {[1,2,3,4,5].map(i => (
            <button key={i} onClick={() => setRating(i)}
              style={{ fontSize: 28, background: 'none', border: 'none', cursor: 'pointer', color: i <= rating ? '#F59E0B' : '#E5E7EB', padding: '0 2px' }}>
              ★
            </button>
          ))}
        </div>
        <textarea value={comment} onChange={e => setComment(e.target.value.slice(0, 300))} rows={3}
          placeholder="Optional comment (what did you learn? what can be improved?)"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'none', boxSizing: 'border-box', color: '#374151', marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onSubmit(rating, comment)}
            style={{ flex: 1, padding: '10px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Submit Feedback
          </button>
          <button onClick={onClose}
            style={{ padding: '10px 16px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, color: '#6B7280', cursor: 'pointer' }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Profile Modal ─────────────────────────────────────────────────────────────

function ProfileModal({ registrationId, initial, onClose, onSave }: {
  registrationId: string;
  initial: { job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; display_name?: string; avatar_url?: string } | null;
  onClose: () => void;
  onSave: (p: { job_title?: string; company?: string; location?: string; linkedin_url?: string; notify_milestones?: boolean; notify_reminders?: boolean; display_name?: string; avatar_url?: string }) => void;
}) {
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [avatarUrl, setAvatarUrl]     = useState(initial?.avatar_url ?? '');
  const [avatarPreview, setAvatarPreview] = useState(initial?.avatar_url ?? '');
  const [jobTitle, setJobTitle]       = useState(initial?.job_title ?? '');
  const [company, setCompany]         = useState(initial?.company ?? '');
  const [location, setLocation]       = useState(initial?.location ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(initial?.linkedin_url ?? '');
  const [notifyM, setNotifyM]         = useState(initial?.notify_milestones ?? true);
  const [notifyR, setNotifyR]         = useState(initial?.notify_reminders ?? true);
  const [saving, setSaving]           = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading]     = useState(false);
  const fileRef                        = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: { target: { files: FileList | null } }) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    // Client-side validation
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setUploadError('Invalid file type. Use JPG, PNG, or WebP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('File too large. Maximum size is 2 MB.');
      return;
    }

    // Show preview immediately while uploading
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('regId', registrationId);
      const res = await fetch('/api/training/upload-avatar', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setUploadError(data.error ?? 'Upload failed. Please try again.');
        setAvatarPreview(avatarUrl); // revert preview to saved url
      } else {
        // Cache-bust the URL so it refreshes immediately
        const busted = `${data.url}?v=${Date.now()}`;
        setAvatarUrl(busted);
        setAvatarPreview(busted);
      }
    } finally {
      setUploading(false);
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleSave() {
    setSaving(true);
    await fetch('/api/training/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId, jobTitle, company, location, linkedinUrl, notifyMilestones: notifyM, notifyReminders: notifyR, displayName, avatarUrl }),
    });
    onSave({ job_title: jobTitle, company, location, linkedin_url: linkedinUrl, notify_milestones: notifyM, notify_reminders: notifyR, display_name: displayName, avatar_url: avatarUrl });
    setSaving(false);
  }

  const initials = displayName.split(' ').map((w: string) => w[0] ?? '').filter(Boolean).join('').toUpperCase().slice(0, 2) || 'ST';

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>👤 Edit Profile</div>
          <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>✕</button>
        </div>

        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#fff', overflow: 'hidden', flexShrink: 0 }}>
            {avatarPreview ? <img src={avatarPreview} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <button onClick={() => fileRef.current?.click()}
              style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', marginBottom: 4, display: 'block' }}>
              Upload Photo
            </button>
            <div style={{ fontSize: 10, color: '#9CA3AF' }}>JPG, PNG, GIF · Max 2MB</div>
          </div>
        </div>

        {/* Display Name */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>DISPLAY NAME</div>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your full name"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 13, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
        </div>

        {/* Professional details */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Job Title', value: jobTitle, setter: setJobTitle, placeholder: 'e.g. Financial Analyst' },
            { label: 'Company',   value: company,  setter: setCompany,  placeholder: 'e.g. Goldman Sachs' },
            { label: 'Location',  value: location, setter: setLocation, placeholder: 'e.g. Lagos, Nigeria' },
            { label: 'LinkedIn',  value: linkedinUrl, setter: setLinkedinUrl, placeholder: 'https://linkedin.com/in/...' },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>{f.label.toUpperCase()}</div>
              <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 8 }}>NOTIFICATIONS</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <input type="checkbox" checked={notifyM} onChange={e => setNotifyM(e.target.checked)} />
            Progress milestone emails
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <input type="checkbox" checked={notifyR} onChange={e => setNotifyR(e.target.checked)} />
            Study reminder emails
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: '10px', background: saving ? '#9CA3AF' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
          <button onClick={onClose}
            style={{ padding: '10px 16px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, color: '#6B7280', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
