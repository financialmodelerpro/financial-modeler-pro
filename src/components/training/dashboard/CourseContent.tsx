'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { COURSES } from '@/src/config/courses';
import type { SessionProgress, Certificate, LiveLinksMap, CourseDescsMap } from './types';
import { allRegularSessionsPassed } from './types';
import { AboutThisCourse } from './AboutThisCourse';
import { SessionCard } from './SessionCard';
import { FilePreviewModal } from './FilePreviewModal';

export interface CourseContentProps {
  courseId: string;
  progressMap: Map<string, SessionProgress>;
  certificates: Certificate[];
  liveLinks: LiveLinksMap;
  courseDescs: CourseDescsMap;
  regId: string;
  onDownloadTranscript: (courseId: string) => void;
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
  /** Server-side timer bypass from training_settings DB */
  timerBypassed?: boolean;
  /** Tab keys where video has been marked complete */
  completedWatchKeys?: Set<string>;
  /** Tab keys where video is in progress */
  inProgressWatchKeys?: Set<string>;
}

export function CourseContent({ courseId, progressMap, certificates, liveLinks, courseDescs, regId, onDownloadTranscript, generating, studentName, studentEmail, onShare, testimonialSubmitted, onOpenTestimonial, notes, onNoteSave, feedbackGiven, onFeedbackRequest, bvmLocked, sfmProgress = 0, sfmTotal = 0, onSwitchTo3sfm, timerBypassed, completedWatchKeys, inProgressWatchKeys }: CourseContentProps) {
  const course = COURSES[courseId];
  if (!course) return null;

  // Track dismissed banners for this session
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(JSON.parse(sessionStorage.getItem('fmp_banners') || '[]')); } catch { return new Set(); }
  });
  const [copiedCert, setCopiedCert] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ file_name: string; file_url: string; file_type: string; file_size: number } | null>(null);

  // Course-level attachments
  const [courseAttachments, setCourseAttachments] = useState<{ id: string; file_name: string; file_url: string; file_type: string; file_size: number }[]>([]);
  useEffect(() => {
    const courseTk = `${(courseId === 'bvm' ? 'BVM' : '3SFM')}_COURSE`;
    fetch(`/api/training/attachments?tabKey=${encodeURIComponent(courseTk)}`)
      .then(r => r.json())
      .then((d: { attachments?: typeof courseAttachments }) => setCourseAttachments(d.attachments ?? []))
      .catch(() => {});
  }, [courseId]);

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
  // Include final exam in display counts
  const allPassedCount = course.sessions.filter(s => progressMap.get(s.id)?.passed).length;
  const progressPct = course.sessions.length > 0 ? Math.round((allPassedCount / course.sessions.length) * 100) : 0;

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
              onClick={() => onDownloadTranscript(courseId)}
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
            <span style={{ color: '#fff', fontWeight: 700 }}>{allPassedCount} / {course.sessions.length} {course.id === 'bvm' ? 'Lessons' : 'Sessions'} · {progressPct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, background: progressPct === 100 ? '#C9A84C' : '#2EAA4A', width: `${progressPct}%`, transition: 'width 0.6s ease' }} />
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="dash-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20, opacity: bvmLocked ? 0.55 : 1, transition: 'opacity 0.2s' }}>
        {[
          { label: 'Sessions Passed', value: `${allPassedCount} / ${course.sessions.length}`, icon: '📊', color: '#1B4F8A' },
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

      {/* Course-level materials */}
      {courseAttachments.length > 0 && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', marginBottom: 8 }}>Course Materials</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {courseAttachments.map(att => {
              const icon = att.file_type === 'pdf' ? '📄' : att.file_type === 'docx' ? '📝' : att.file_type === 'pptx' ? '📊' : att.file_type === 'xlsx' ? '📗' : '🖼️';
              const size = att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : '';
              return (
                <button key={att.id} onClick={() => setPreviewFile(att)}
                  title="View file"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #BFDBFE', background: '#fff', fontSize: 11, color: '#374151', cursor: 'pointer' }}>
                  <span>{icon}</span>
                  <span style={{ fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.file_name}</span>
                  {size && <span style={{ color: '#9CA3AF', fontSize: 10 }}>{size}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

          // Watch Video lock: Session 1 always open; Session 2+ locked until prev assessment passed;
          // Final exam Watch Video always open if URL exists.
          let watchLocked = false;
          if (bvmLocked) {
            watchLocked = true;
          } else if (idx > 0) {
            const prev = course.sessions[idx - 1];
            watchLocked = !progressMap.get(prev.id)?.passed;
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
              watchLocked={watchLocked}
              timerBypassed={timerBypassed}
              courseId={courseId}
              isWatched={completedWatchKeys?.has(tk)}
              isInProgress={inProgressWatchKeys?.has(tk)}
              courseName={course.title}
              studentName={studentName}
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
          action = 'Add to LinkedIn';
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
            <a href={`https://wa.me/?text=${encodeURIComponent(`I just earned my ${course.shortTitle} certificate from Financial Modeler Pro! 🎓\n\nCheck out the free course: ${process.env.NEXT_PUBLIC_LEARN_URL || 'https://learn.financialmodelerpro.com'}/training\n\nVerify my certificate: ${courseCert.certifierUrl}`)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#25D366', color: '#fff', textDecoration: 'none' }}>
              WhatsApp
            </a>
            <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Just earned my ${course.shortTitle} certification! 🏆\n\nFree course at ${process.env.NEXT_PUBLIC_LEARN_URL || 'https://learn.financialmodelerpro.com'}/training\n\n#FinancialModeling #Finance`)}`}
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
      {/* File preview modal */}
      {previewFile && (
        <FilePreviewModal
          fileName={previewFile.file_name}
          fileUrl={previewFile.file_url}
          fileType={previewFile.file_type}
          fileSize={previewFile.file_size}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
