'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getTrainingSession, clearTrainingSession } from '@/src/lib/training-session';
import { COURSES } from '@/src/config/courses';

interface LiveSessionLink { tabKey: string; youtubeUrl: string; formUrl: string; }
// Keyed by tabKey e.g. "3SFM_S1"
type LiveLinksMap = Record<string, LiveSessionLink>;

// ── Local types (mirrors server-side sheets.ts interfaces) ────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function Skeleton({ w, h, radius = 6 }: { w: string | number; h: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: 'linear-gradient(90deg,#E5E7EB 25%,#F3F4F6 50%,#E5E7EB 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      flexShrink: 0,
    }} />
  );
}

function StatusBadge({ sessionId, locked, prog }: {
  sessionId: string;
  locked: boolean;
  prog: SessionProgress | undefined;
}) {
  if (locked) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
        background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA',
        whiteSpace: 'nowrap',
      }}>
        🔒 Locked
      </span>
    );
  }
  if (!prog || prog.attempts === 0) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
        background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB',
        whiteSpace: 'nowrap',
      }}>
        Not Started
      </span>
    );
  }
  if (prog.passed) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
        background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0',
        whiteSpace: 'nowrap',
      }}>
        ✓ Passed — {prog.score}%
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA',
      whiteSpace: 'nowrap',
    }}>
      Attempted — {prog.score}%
    </span>
  );
}

function CourseTable({
  courseId,
  progressMap,
  registrationId,
  certificates,
  liveLinks,
}: {
  courseId: string;
  progressMap: Map<string, SessionProgress>;
  registrationId: string;
  certificates: Certificate[];
  liveLinks: LiveLinksMap;
}) {
  const course = COURSES[courseId];
  if (!course) return null;

  const allRegularPassed = allRegularSessionsPassed(courseId, progressMap);
  const courseCert = certificates.find(c =>
    c.course === courseId || c.course === course.id || c.course === course.shortTitle.toLowerCase()
  );

  // Count passed (non-final) sessions for progress display
  const regularSessions = course.sessions.filter(s => !s.isFinal);
  const passedCount = regularSessions.filter(s => progressMap.get(s.id)?.passed).length;
  const finalSession = course.sessions.find(s => s.isFinal);
  const finalPassed = finalSession ? progressMap.get(finalSession.id)?.passed === true : false;

  return (
    <div>
      {/* Horizontal scroll wrapper for mobile */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #E5E7EB' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700, fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              {['#', 'Session', 'Status', 'Best Score', 'Attempts', 'Watch', 'Assessment'].map(h => (
                <th key={h} style={{
                  padding: '11px 14px', textAlign: 'left',
                  fontSize: 11, fontWeight: 700, color: '#6B7280',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {course.sessions.map((session, idx) => {
              const prog = progressMap.get(session.id);
              const isFinalRow = session.isFinal;
              // Prefer live URLs from Apps Script over static courses.ts values
              const tk       = `${course.shortTitle.toUpperCase()}_${session.id}`;
              const ytUrl    = liveLinks[tk]?.youtubeUrl  || session.youtubeUrl    || '';
              const formUrl  = liveLinks[tk]?.formUrl     || session.quizFormUrl   || '';

              // Locking logic
              let locked = false;
              if (isFinalRow) {
                locked = !allRegularPassed;
              } else if (idx > 0) {
                const prev = course.sessions[idx - 1];
                locked = !progressMap.get(prev.id)?.passed;
              }

              const isEvenRow = idx % 2 === 0;

              return (
                <tr
                  key={session.id}
                  style={{
                    background: locked ? '#FAFAFA' : isFinalRow && !locked ? '#F0FFF4' : isEvenRow ? '#fff' : '#FAFAFA',
                    borderBottom: '1px solid #F3F4F6',
                    opacity: locked ? 0.7 : 1,
                  }}
                >
                  {/* # */}
                  <td style={{ padding: '13px 14px', fontWeight: 600, color: '#9CA3AF', width: 36 }}>
                    {idx + 1}
                  </td>

                  {/* Session name */}
                  <td style={{ padding: '13px 14px', fontWeight: isFinalRow ? 700 : 500, color: '#0D2E5A', minWidth: 200 }}>
                    {session.title}
                    {isFinalRow && !locked && (
                      <div style={{ fontSize: 11, color: '#15803D', marginTop: 3, fontWeight: 600 }}>
                        {session.questionCount} questions · 1 attempt · 70% to pass
                      </div>
                    )}
                    {isFinalRow && locked && (
                      <div style={{ fontSize: 11, color: '#DC2626', marginTop: 3 }}>
                        🔒 Complete all sessions to unlock — {passedCount} of {regularSessions.length} passed
                      </div>
                    )}
                  </td>

                  {/* Status */}
                  <td style={{ padding: '13px 14px', whiteSpace: 'nowrap' }}>
                    <StatusBadge sessionId={session.id} locked={locked} prog={prog} />
                  </td>

                  {/* Best Score */}
                  <td style={{ padding: '13px 14px', color: '#374151', textAlign: 'center' }}>
                    {!locked && prog && prog.attempts > 0 ? `${prog.score}%` : '—'}
                  </td>

                  {/* Attempts */}
                  <td style={{ padding: '13px 14px', color: '#374151', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {!locked && prog ? `${prog.attempts} / ${session.maxAttempts}` : `0 / ${session.maxAttempts}`}
                  </td>

                  {/* Watch button */}
                  <td style={{ padding: '13px 14px' }}>
                    {ytUrl ? (
                      <a
                        href={ytUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Watch on YouTube"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: '#FF0000', color: '#fff', textDecoration: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ▶ Watch
                      </a>
                    ) : (
                      <span
                        title="Video coming soon"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: '#F3F4F6', color: '#9CA3AF',
                          whiteSpace: 'nowrap', cursor: 'default',
                        }}
                      >
                        Coming Soon
                      </span>
                    )}
                  </td>

                  {/* Assessment button */}
                  <td style={{ padding: '13px 14px' }}>
                    {locked ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: '#FEF2F2', color: '#FCA5A5',
                        whiteSpace: 'nowrap', cursor: 'default',
                      }}>
                        🔒 Locked
                      </span>
                    ) : prog?.passed ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: '#F0FFF4', color: '#86EFAC',
                        whiteSpace: 'nowrap', cursor: 'default',
                      }}>
                        ✓ Passed
                      </span>
                    ) : (prog?.attempts ?? 0) >= session.maxAttempts ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: '#FEF2F2', color: '#DC2626',
                        whiteSpace: 'nowrap', cursor: 'default',
                      }}>
                        No Attempts Left
                      </span>
                    ) : !formUrl ? (
                      <span
                        title="Assessment coming soon"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: '#F3F4F6', color: '#9CA3AF',
                          whiteSpace: 'nowrap', cursor: 'default',
                        }}
                      >
                        Coming Soon
                      </span>
                    ) : (
                      <a
                        href={formUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                          background: isFinalRow ? '#2EAA4A' : '#2EAA4A',
                          color: '#fff', textDecoration: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isFinalRow ? 'Take Final Exam →' : 'Take Assessment →'}
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Certificate Card */}
      <div style={{ marginTop: 24 }}>
        {courseCert && finalPassed ? (
          // ── Earned certificate ──
          <div style={{
            border: '2px solid #C9A84C', borderRadius: 12,
            padding: '28px 28px 24px',
            background: 'linear-gradient(135deg, #FFFBF0 0%, #FFF8E1 100%)',
            boxShadow: '0 4px 20px rgba(201,168,76,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#C9A84C', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  🏆 Certificate Earned
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', marginBottom: 4 }}>
                  {courseCert.studentName}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 2 }}>
                  {course.title}
                </div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>
                  Issued: {new Date(courseCert.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4, fontFamily: 'monospace' }}>
                  ID: {courseCert.certificateId}
                </div>
              </div>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: '#C9A84C', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 24, flexShrink: 0,
              }}>
                🏆
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a
                href={courseCert.certifierUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '9px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                  background: '#2EAA4A', color: '#fff', textDecoration: 'none',
                }}
              >
                View Certificate →
              </a>
              <a
                href={courseCert.certifierUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '9px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                  background: '#1B4F8A', color: '#fff', textDecoration: 'none',
                }}
              >
                Verify Online →
              </a>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(courseCert.certifierUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '9px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                  background: '#0A66C2', color: '#fff', textDecoration: 'none',
                }}
              >
                Share on LinkedIn →
              </a>
            </div>
          </div>
        ) : (
          // ── Not yet earned ──
          <div style={{
            border: '2px dashed #D1D5DB', borderRadius: 12,
            padding: '24px 24px',
            background: '#FAFAFA',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🎓</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Certificate Not Yet Earned
            </div>
            <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 6 }}>
              {passedCount} of {regularSessions.length} sessions passed — {regularSessions.length - passedCount} remaining
            </div>
            <div style={{ fontSize: 12.5, color: '#6B7280' }}>
              Complete all sessions and pass the Final Exam to earn your certificate.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard Page ───────────────────────────────────────────────────────

export default function TrainingDashboardPage() {
  const router = useRouter();

  const [localSession, setLocalSession] = useState<{ email: string; registrationId: string } | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [progress, setProgress]         = useState<ProgressData | null>(null);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [activeTab, setActiveTab]       = useState('3sfm');
  const [liveLinks, setLiveLinks]       = useState<LiveLinksMap>({});

  const loadData = useCallback(async (sess: { email: string; registrationId: string }) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ email: sess.email, registrationId: sess.registrationId });
      const res  = await fetch(`/api/training/progress?${params}`);
      const json = await res.json() as { success: boolean; data?: ProgressData; error?: string };
      if (!json.success || !json.data) {
        setError(json.error ?? 'Failed to load your progress. Please try again.');
        setLoading(false);
        return;
      }
      setProgress(json.data);

      // If certificate may be issued, fetch certificate data
      if (json.data.certificateIssued) {
        const certRes  = await fetch(`/api/training/certificate?email=${encodeURIComponent(sess.email)}`);
        const certJson = await certRes.json() as { success: boolean; data?: Certificate[] };
        if (certJson.success && certJson.data) {
          setCertificates(certJson.data);
        }
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) {
      router.replace('/training/login');
      return;
    }
    setLocalSession(sess);
    loadData(sess);
    // Load live session links from Apps Script (non-blocking)
    fetch('/api/training/course-details')
      .then(r => r.json())
      .then((d: { sessions?: LiveSessionLink[] }) => {
        const map: LiveLinksMap = {};
        for (const s of d.sessions ?? []) map[s.tabKey] = s;
        setLiveLinks(map);
      })
      .catch(() => {});
  }, [router, loadData]);

  async function handleLogout() {
    await fetch('/api/training/logout', { method: 'POST' });
    clearTrainingSession();
    router.replace('/training');
  }

  // ── Auth guard (redirect in progress) ──
  if (!localSession && !loading) return null;

  const enrolledCourses = progress ? getEnrolledCourses(progress.student.course) : [];
  const progressMap     = progress ? buildProgressMap(progress.sessions) : new Map<string, SessionProgress>();

  // Overall progress across all enrolled courses
  const totalSessions = enrolledCourses.reduce((sum, cId) => {
    return sum + (COURSES[cId]?.sessions.filter(s => !s.isFinal).length ?? 0);
  }, 0);
  const totalPassed = enrolledCourses.reduce((sum, cId) => {
    const course = COURSES[cId];
    if (!course) return sum;
    return sum + course.sessions.filter(s => !s.isFinal && progressMap.get(s.id)?.passed).length;
  }, 0);
  const overallPct = totalSessions > 0 ? Math.round((totalPassed / totalSessions) * 100) : 0;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#F5F7FA', minHeight: '100vh', color: '#374151' }}>

      {/* ── Top Nav ──────────────────────────────────────────────────────── */}
      <div style={{
        background: '#0D2E5A', padding: '0 32px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: '#2EAA4A',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
          }}>🎓</div>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Training Academy</span>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: '7px 16px', fontSize: 12, fontWeight: 700,
            background: 'rgba(255,255,255,0.1)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Logout
        </button>
      </div>

      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* ── Loading Skeleton ─────────────────────────────────────────── */}
        {loading && (
          <div>
            <div style={{ background: '#fff', borderRadius: 12, padding: '28px 28px', marginBottom: 24, border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Skeleton w={220} h={28} />
              <Skeleton w={320} h={18} />
              <Skeleton w="100%" h={8} radius={4} />
            </div>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid #F3F4F6', display: 'flex', gap: 16, alignItems: 'center' }}>
                  <Skeleton w={24} h={14} />
                  <Skeleton w={240} h={14} />
                  <Skeleton w={80} h={22} radius={20} />
                  <Skeleton w={40} h={14} />
                  <Skeleton w={40} h={14} />
                  <Skeleton w={64} h={28} radius={6} />
                  <Skeleton w={120} h={28} radius={6} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Error State ──────────────────────────────────────────────── */}
        {!loading && error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: 12, padding: '32px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#DC2626', marginBottom: 8 }}>
              ⚠️ {error}
            </div>
            <button
              onClick={() => localSession && loadData(localSession)}
              style={{
                marginTop: 12, padding: '10px 24px', fontSize: 13, fontWeight: 700,
                background: '#2EAA4A', color: '#fff', border: 'none',
                borderRadius: 7, cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* ── Dashboard Content ─────────────────────────────────────────── */}
        {!loading && !error && progress && (
          <>
            {/* ── Header Card ──────────────────────────────────────────── */}
            <div style={{
              background: '#fff', borderRadius: 12, padding: '28px 28px 24px',
              border: '1px solid #E5E7EB', marginBottom: 24,
              boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 18 }}>
                <div>
                  <h1 style={{ fontSize: 'clamp(20px,3vw,28px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 10 }}>
                    Welcome back, {progress.student.name}
                  </h1>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    {/* Registration ID badge */}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                      background: '#F0FFF4', color: '#15803D', border: '1px solid #BBF7D0',
                    }}>
                      🪪 {progress.student.registrationId}
                    </span>
                    {/* Course tags */}
                    {enrolledCourses.map(cId => (
                      <span key={cId} style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                        background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE',
                      }}>
                        {COURSES[cId]?.shortTitle ?? cId.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>
                    Overall Progress
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#2EAA4A' }}>
                    {totalPassed} of {totalSessions} sessions passed ({overallPct}%)
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: '#E5E7EB', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    background: overallPct === 100 ? '#C9A84C' : '#2EAA4A',
                    width: `${overallPct}%`,
                    transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            </div>

            {/* ── Course Tabs (if both enrolled) ───────────────────────── */}
            {enrolledCourses.length > 1 && (
              <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #E5E7EB', marginBottom: 0 }}>
                {enrolledCourses.map(cId => (
                  <button
                    key={cId}
                    onClick={() => setActiveTab(cId)}
                    style={{
                      padding: '10px 20px', fontSize: 13,
                      fontWeight: activeTab === cId ? 700 : 500,
                      border: 'none', background: 'none', cursor: 'pointer',
                      borderBottom: activeTab === cId ? '2px solid #2EAA4A' : '2px solid transparent',
                      color: activeTab === cId ? '#2EAA4A' : '#6B7280',
                      marginBottom: -2,
                    }}
                  >
                    {COURSES[cId]?.title ?? cId}
                  </button>
                ))}
              </div>
            )}

            {/* ── Session Tables ───────────────────────────────────────── */}
            {enrolledCourses.length > 1 ? (
              // Tabs — show only active course
              <div style={{ background: '#fff', borderRadius: enrolledCourses.length > 1 ? '0 0 12px 12px' : 12, padding: '24px', border: '1px solid #E5E7EB', borderTop: enrolledCourses.length > 1 ? 'none' : undefined }}>
                <CourseTable
                  courseId={activeTab}
                  progressMap={progressMap}
                  registrationId={progress.student.registrationId}
                  certificates={certificates}
                  liveLinks={liveLinks}
                />
              </div>
            ) : (
              // Single course — no tabs
              <div style={{ background: '#fff', borderRadius: 12, padding: '24px', border: '1px solid #E5E7EB' }}>
                {enrolledCourses[0] && (
                  <CourseTable
                    courseId={enrolledCourses[0]}
                    progressMap={progressMap}
                    registrationId={progress.student.registrationId}
                    certificates={certificates}
                    liveLinks={liveLinks}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
