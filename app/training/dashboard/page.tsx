'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getTrainingSession, clearTrainingSession } from '@/src/lib/training-session';
import { COURSES } from '@/src/config/courses';

interface LiveSessionLink { tabKey: string; youtubeUrl: string; formUrl: string; }
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
}

function SessionCard({
  sessionTitle, maxAttempts, questionCount, passingScore,
  idx, prog, locked, ytUrl, formUrl, isFinal, passedCount, regularCount,
}: SessionCardProps) {
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
            <div style={{ fontWeight: isFinal ? 700 : 600, color: '#0D2E5A', fontSize: 14, lineHeight: 1.4 }}>
              {sessionTitle}
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

      {/* Row 3: action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: locked ? 0 : 38 }}>
        {/* Watch Video */}
        {ytUrl ? (
          <a href={ytUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#FF0000', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            ▶ Watch Video
          </a>
        ) : !isFinal ? (
          // Regular sessions without video: show Coming Soon
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
            📹 Coming Soon
          </span>
        ) : null /* Final exam without video: hide entirely */}

        {/* Assessment */}
        {locked ? (
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
        ) : (
          <a href={formUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: isFinal ? '#C9A84C' : '#2EAA4A', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            {isFinal ? '🏆 Take Final Exam →' : '📝 Take Assessment →'}
          </a>
        )}
      </div>
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
  onDownloadTranscript: () => void;
  generating: boolean;
}

function CourseContent({ courseId, progressMap, certificates, liveLinks, courseDescs, onDownloadTranscript, generating }: CourseContentProps) {
  const course = COURSES[courseId];
  if (!course) return null;

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
  const certStatus = finalPassed && courseCert ? 'Earned' : allRegularPassed && finalPassed ? 'Eligible' : allRegularPassed ? 'Eligible' : 'Pending';
  const certColor = certStatus === 'Earned' ? '#C9A84C' : certStatus === 'Eligible' ? '#2EAA4A' : '#6B7280';
  const hasAny = passedCount > 0;
  const isOfficial = finalPassed;

  // "About This Course" — courses API keys by category (e.g. '3SFM', 'BVM')
  const desc = courseDescs[course.shortTitle] ?? courseDescs[course.shortTitle.toLowerCase()];

  return (
    <div>
      {/* Course Header */}
      <div style={{ background: 'linear-gradient(135deg, #0D2E5A 0%, #1B4F8A 100%)', borderRadius: 12, padding: '24px 28px', marginBottom: 20, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.15)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              🎓 {course.shortTitle}
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
            <span style={{ color: '#fff', fontWeight: 700 }}>{passedCount} / {regularSessions.length} Sessions · {progressPct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, background: progressPct === 100 ? '#C9A84C' : '#2EAA4A', width: `${progressPct}%`, transition: 'width 0.6s ease' }} />
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="dash-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
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
          Sessions
        </h3>
        {course.sessions.map((session, idx) => {
          const prog = progressMap.get(session.id);
          const isFinalRow = session.isFinal;
          const tk = `${course.shortTitle.toUpperCase()}_${session.id}`;
          const ytUrl = liveLinks[tk]?.youtubeUrl || session.youtubeUrl || '';
          const formUrl = liveLinks[tk]?.formUrl || session.quizFormUrl || '';

          let locked = false;
          if (isFinalRow) {
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
            />
          );
        })}
      </div>

      {/* Certificate Card */}
      {(finalPassed && courseCert) ? (
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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={courseCert.certifierUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700, background: '#2EAA4A', color: '#fff', textDecoration: 'none' }}>
              View Certificate →
            </a>
            <a href={courseCert.certifierUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700, background: '#1B4F8A', color: '#fff', textDecoration: 'none' }}>
              Verify Online →
            </a>
            <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(courseCert.certifierUrl)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 700, background: '#0A66C2', color: '#fff', textDecoration: 'none' }}>
              Share on LinkedIn →
            </a>
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
  const [isFallback, setIsFallback]               = useState(false);
  const [progress, setProgress]                   = useState<ProgressData | null>(null);
  const [certificates, setCertificates]           = useState<Certificate[]>([]);
  const [activeCourse, setActiveCourse]           = useState('3sfm');
  const [liveLinks, setLiveLinks]                 = useState<LiveLinksMap>({});
  const [courseDescs, setCourseDescs]             = useState<CourseDescsMap>({});
  const [generating, setGenerating]               = useState(false);
  const [transcriptToast, setTranscriptToast]     = useState('');
  const [sidebarCollapsed, setSidebarCollapsed]   = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Restore sidebar state from localStorage (client-only)
  useEffect(() => {
    if (localStorage.getItem('dashboardSidebarCollapsed') === 'true') setSidebarCollapsed(true);
  }, []);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('dashboardSidebarCollapsed', String(next));
  }

  const loadData = useCallback(async (sess: { email: string; registrationId: string }) => {
    setLoading(true);
    setIsFallback(false);
    try {
      const params = new URLSearchParams({ email: sess.email, registrationId: sess.registrationId });
      const res  = await fetch(`/api/training/progress?${params}`);
      const json = await res.json() as { success: boolean; fallback?: boolean; data?: ProgressData };

      if (json.success && json.data) {
        setProgress(json.data);
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
    }
  }, []);

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/login'); return; }
    setLocalSession(sess);
    loadData(sess);
    fetch('/api/training/course-details?bust=1')
      .then(r => r.json())
      .then((d: { sessions?: LiveSessionLink[]; courses?: CourseDescsMap }) => {
        const map: LiveLinksMap = {};
        for (const s of d.sessions ?? []) map[s.tabKey] = s;
        setLiveLinks(map);
        if (d.courses) setCourseDescs(d.courses);
      })
      .catch(() => {});
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

  async function handleLogout() {
    await fetch('/api/training/logout', { method: 'POST' });
    clearTrainingSession();
    router.replace('/training');
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

  // Student avatar initials
  const studentName = progress?.student.name ?? '';
  const initials = studentName.split(' ').map((w: string) => w[0] ?? '').filter(Boolean).join('').toUpperCase().slice(0, 2) || 'ST';

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
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎓</div>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Training Academy</span>
        </div>
        <button onClick={handleLogout} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, cursor: 'pointer' }}>
          Logout
        </button>
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
                  <div title={studentName || 'Student'} style={{ width: 40, height: 40, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                    {initials}
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
                </div>
              )}
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
            showLockedBvm ? (
              <BvmLockedContent
                sfmProgress={sfmPassedCount}
                sfmTotal={sfmRegular.length}
                onContinue={() => setActiveCourse('3sfm')}
              />
            ) : (
              <CourseContent
                courseId={displayCourse}
                progressMap={progressMap}
                certificates={certificates}
                liveLinks={liveLinks}
                courseDescs={courseDescs}
                onDownloadTranscript={downloadTranscript}
                generating={generating}
              />
            )
          )}
        </main>
      </div>
    </div>
  );
}
