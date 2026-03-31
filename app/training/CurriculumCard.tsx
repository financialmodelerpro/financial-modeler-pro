'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { CourseConfig } from '@/src/config/courses';
import { getTrainingSession } from '@/src/lib/training-session';
import { startTimer, getTimerStatus, type TimerStatus } from '@/src/lib/videoTimer';
import { CountdownTimer } from '@/src/components/training/CountdownTimer';

export interface CourseDescription {
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

interface Props {
  course: CourseConfig;
  accentColor: string;
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
  sessionLabel: string;
  description?: CourseDescription;
}

interface LiveSession {
  tabKey: string; num: number; youtubeUrl: string; formUrl: string; isFinal: boolean; videoDuration?: number;
}

interface ProgressEntry { sessionId: string; passed: boolean; }

export function CurriculumCard({
  course,
  accentColor,
  badgeBg,
  badgeColor,
  badgeBorder,
  sessionLabel,
  description,
}: Props) {
  const [showDetails, setShowDetails]     = useState(false);
  const [showAllLearn, setShowAllLearn]   = useState(false);
  const [open, setOpen]                   = useState(false);
  const [liveMap, setLiveMap]             = useState<Record<string, LiveSession>>({});
  const [passedSet, setPassedSet]         = useState<Set<string>>(new Set());
  const [loggedIn, setLoggedIn]           = useState(false);
  const [regId, setRegId]                 = useState('');
  const [timerMap, setTimerMap]           = useState<Record<string, TimerStatus>>({});
  const [linksLoading, setLinksLoading]   = useState(false);
  const fetched = useRef(false);

  // NOTE: Final sessions use '_Final' suffix to match Apps Script tabKey convention.
  // Do NOT revert to sessionId only — that caused the final Watch button to never show.
  const tabKey = (sessionId: string, isFinal?: boolean) =>
    isFinal
      ? `${course.shortTitle.toUpperCase()}_Final`
      : `${course.shortTitle.toUpperCase()}_${sessionId}`;

  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    setLinksLoading(true);

    const sess = getTrainingSession();
    setLoggedIn(!!sess);
    const currentRegId = sess?.registrationId ?? '';
    setRegId(currentRegId);

    const fetches: Promise<void>[] = [
      fetch(`/api/training/course-details?course=${course.id}`)
        .then(r => r.json())
        .then((d: { sessions?: LiveSession[] }) => {
          const map: Record<string, LiveSession> = {};
          for (const s of d.sessions ?? []) map[s.tabKey] = s;
          setLiveMap(map);
          // Initialise timer statuses for logged-in students
          if (currentRegId) {
            const timers: Record<string, TimerStatus> = {};
            for (const session of course.sessions) {
              const tk = `${course.shortTitle.toUpperCase()}_${session.id}`;
              const dur = map[tk]?.videoDuration ?? 0;
              timers[tk] = getTimerStatus(currentRegId, tk, dur);
            }
            setTimerMap(timers);
          }
        })
        .catch(() => {}),
    ];

    if (sess) {
      fetches.push(
        fetch('/api/training/progress')
          .then(r => r.json())
          .then((d: { success: boolean; data?: { sessions?: ProgressEntry[] } }) => {
            if (d.success && d.data?.sessions) {
              setPassedSet(new Set(d.data.sessions.filter(s => s.passed).map(s => s.sessionId)));
            }
          })
          .catch(() => {}),
      );
    }

    Promise.all(fetches).finally(() => setLinksLoading(false));
  }, [open, course.id, course.shortTitle]);

  const tagline       = description?.tagline       || course.description;
  const learns        = description?.whatYouLearn   ?? [];
  const visibleLearns = showAllLearn ? learns : learns.slice(0, 5);
  const hasDetails    = !!(description?.whoIsThisFor || description?.prerequisites || description?.certificateDescription || learns.length > 0);

  const metaItems: { icon: string; label: string }[] = [];
  if (description?.durationHours) metaItems.push({ icon: '⏱', label: `${description.durationHours} Hours` });
  if (description?.skillLevel)    metaItems.push({ icon: '📊', label: description.skillLevel });
  if (description?.language)      metaItems.push({ icon: '🌐', label: description.language });

  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid #E5E7EB', borderLeft: `4px solid ${accentColor}`,
      padding: '32px 28px',
      boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: accentColor, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            {course.shortTitle}
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0D2E5A', margin: 0, lineHeight: 1.3 }}>
            {course.title}
          </h3>
        </div>
        <span style={{
          flexShrink: 0, marginLeft: 12,
          fontSize: 11, fontWeight: 700, padding: '4px 10px',
          borderRadius: 20, background: badgeBg, color: badgeColor,
          border: `1px solid ${badgeBorder}`, whiteSpace: 'nowrap',
        }}>
          {sessionLabel}
        </span>
      </div>

      {/* Tagline */}
      <p style={{ fontSize: 13.5, color: '#6B7280', lineHeight: 1.65, marginBottom: 16 }}>
        {tagline}
      </p>

      {/* Metadata row */}
      {metaItems.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          {metaItems.map(m => (
            <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', fontWeight: 600 }}>
              <span style={{ fontSize: 13 }}>{m.icon}</span>
              {m.label}
            </div>
          ))}
        </div>
      )}

      {/* Certificate badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: '#F0FFF4', border: '1px solid #BBF7D0',
        borderRadius: 6, padding: '5px 12px', marginBottom: 20,
      }}>
        <span style={{ fontSize: 14 }}>✅</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#15803D' }}>
          Certificate issued via Certifier.io
        </span>
      </div>

      {/* Show Course Details toggle */}
      {hasDetails && (
        <>
          <button
            onClick={() => setShowDetails(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '11px 16px', borderRadius: 7,
              background: 'transparent',
              border: `1.5px solid #E5E7EB`,
              color: '#374151',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
              marginBottom: showDetails ? 0 : 12,
            }}
          >
            <span>{showDetails ? 'Hide Course Details' : 'Show Course Details'}</span>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>{showDetails ? '▲' : '▼'}</span>
          </button>

          {showDetails && (
            <div style={{ borderRadius: 8, border: '1px solid #E5E7EB', overflow: 'hidden', marginBottom: 12 }}>
              {/* What You Will Learn */}
              {learns.length > 0 && (
                <div style={{ padding: '18px 20px', borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                    What You Will Learn
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {visibleLearns.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{ color: '#2EAA4A', fontWeight: 700, fontSize: 13, flexShrink: 0, marginTop: 1 }}>✓</span>
                        <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{item}</span>
                      </div>
                    ))}
                  </div>
                  {learns.length > 5 && (
                    <button
                      onClick={() => setShowAllLearn(v => !v)}
                      style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: accentColor, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {showAllLearn ? '← Show less' : `Show all ${learns.length} →`}
                    </button>
                  )}
                </div>
              )}

              {/* Who Is This For */}
              {description?.whoIsThisFor && (
                <div style={{ padding: '16px 20px', borderBottom: description?.prerequisites || description?.certificateDescription ? '1px solid #F3F4F6' : undefined }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    Who Is This For
                  </div>
                  <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>{description.whoIsThisFor}</p>
                </div>
              )}

              {/* Prerequisites */}
              {description?.prerequisites && (
                <div style={{ padding: '16px 20px', borderBottom: description?.certificateDescription ? '1px solid #F3F4F6' : undefined }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    Prerequisites
                  </div>
                  <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>{description.prerequisites}</p>
                </div>
              )}

              {/* Certificate */}
              {description?.certificateDescription && (
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    Certificate
                  </div>
                  <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, margin: 0 }}>{description.certificateDescription}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* View Curriculum toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '11px 16px', borderRadius: 7,
          background: open ? accentColor : 'transparent',
          border: `1.5px solid ${accentColor}`,
          color: open ? '#fff' : accentColor,
          fontWeight: 700, fontSize: 13, cursor: 'pointer',
          marginBottom: open ? 0 : undefined,
        }}
      >
        <span>{open ? 'Hide Curriculum' : 'View Curriculum'}</span>
        <span style={{ fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Curriculum list */}
      {open && (
        <div style={{ marginTop: 12, borderRadius: 8, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          {linksLoading && (
            <div style={{ padding: '16px 20px', fontSize: 12, color: '#9CA3AF', textAlign: 'center' }}>
              Loading session links…
            </div>
          )}
          {course.sessions.map((session, idx) => {
            const live         = liveMap[tabKey(session.id, session.isFinal)];
            const ytUrl        = live?.youtubeUrl || session.youtubeUrl || '';
            const formUrl      = live?.formUrl    || session.quizFormUrl || '';
            const tk           = tabKey(session.id, session.isFinal);
            const videoDur     = live?.videoDuration ?? 0;
            const sessionTimer = timerMap[tk] ?? { locked: false, minutesRemaining: 0, started: false };
            const hasTimeLock  = loggedIn && videoDur > 0 && !!ytUrl;
            const timerLocked  = hasTimeLock && sessionTimer.locked;
            const timerStarted = sessionTimer.started;

            let locked = false;
            if (session.isFinal) {
              locked = !course.sessions.filter(s => !s.isFinal).every(s => passedSet.has(s.id));
            } else if (idx > 0) {
              locked = loggedIn && !passedSet.has(course.sessions[idx - 1].id);
            }

            return (
              <div
                key={session.id}
                style={{
                  padding: '12px 16px',
                  borderTop: idx === 0 ? 'none' : '1px solid #F3F4F6',
                  background: session.isFinal ? '#FFFBEB' : idx % 2 === 0 ? '#fff' : '#F9FAFB',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {/* Number badge */}
                  <span style={{
                    flexShrink: 0,
                    width: 24, height: 24, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800,
                    background: session.isFinal ? '#FEF3C7' : accentColor + '18',
                    color: session.isFinal ? '#B45309' : accentColor,
                    border: `1px solid ${session.isFinal ? '#FDE68A' : accentColor + '40'}`,
                    marginTop: 1,
                  }}>
                    {session.isFinal ? '★' : idx + 1}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: session.isFinal ? 700 : 500, color: '#1B3A6B', lineHeight: 1.4 }}>
                      {session.title}
                    </div>
                    {session.isFinal && (
                      <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>
                        Final Exam · {session.questionCount} questions · {session.passingScore}% to pass
                      </div>
                    )}

                    {/* Buttons row */}
                    {!linksLoading && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        {/* Watch button */}
                        {ytUrl ? (
                          <a
                            href={ytUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              if (loggedIn && regId) {
                                startTimer(regId, tk, videoDur);
                                setTimerMap(prev => ({ ...prev, [tk]: getTimerStatus(regId, tk, videoDur) }));
                              }
                            }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                              background: '#FF0000', color: '#fff', textDecoration: 'none',
                            }}
                          >
                            ▶ Watch
                          </a>
                        ) : !session.isFinal ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                            background: '#F3F4F6', color: '#9CA3AF',
                          }}>
                            ▶ Coming Soon
                          </span>
                        ) : null}

                        {/* Assessment button */}
                        {!loggedIn ? (
                          <Link
                            href="/training/register"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                              background: '#EFF6FF', color: '#1B4F8A', textDecoration: 'none',
                              border: '1px solid #BFDBFE',
                            }}
                          >
                            📝 Register to access
                          </Link>
                        ) : locked ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                            background: '#FEF2F2', color: '#FCA5A5',
                          }}>
                            🔒 Locked
                          </span>
                        ) : !formUrl ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                            background: '#F3F4F6', color: '#9CA3AF',
                          }}>
                            📝 Coming Soon
                          </span>
                        ) : timerLocked && !timerStarted ? (
                          // STATE 2: video exists, never watched
                          <span title="Watch the video to unlock the assessment" style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                            background: '#F3F4F6', color: '#9CA3AF', cursor: 'default',
                          }}>
                            👁 Watch Video First
                          </span>
                        ) : timerLocked && timerStarted ? (
                          // STATE 3: timer running
                          <CountdownTimer
                            regId={regId}
                            tabKey={tk}
                            durationMinutes={videoDur}
                            onExpired={() => setTimerMap(prev => ({ ...prev, [tk]: { locked: false, minutesRemaining: 0, started: true } }))}
                          />
                        ) : (
                          // STATE 1 / 4: no lock or expired
                          <a
                            href={formUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                              background: '#2EAA4A', color: '#fff', textDecoration: 'none',
                            }}
                          >
                            📝 Assessment
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Enrol CTA at bottom */}
          <div style={{ padding: '14px 16px', background: accentColor + '08', borderTop: `1px solid ${accentColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6B7280' }}>
              Free to enrol · Certificates issued on completion
            </span>
            <Link
              href="/training/register"
              style={{
                fontSize: 12, fontWeight: 700, padding: '8px 20px',
                borderRadius: 6, background: accentColor, color: '#fff',
                textDecoration: 'none',
              }}
            >
              Enrol Free →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
