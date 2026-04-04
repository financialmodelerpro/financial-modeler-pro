'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { startTimer, getTimerStatus, type TimerStatus } from '@/src/lib/training/videoTimer';
import { CountdownTimer } from '@/src/components/training/CountdownTimer';
import type { SessionProgress } from './types';
import { StatusBadge } from './StatusBadge';

export interface SessionCardProps {
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
  /** Watch Video is locked until the previous session assessment is passed (independent of assessment lock) */
  watchLocked?: boolean;
}

export function SessionCard({
  sessionTitle, maxAttempts, questionCount, passingScore,
  idx, prog, locked, ytUrl, formUrl, isFinal, passedCount, regularCount,
  tabKey, videoDuration, regId, noteContent, onNoteSave, feedbackGiven, onFeedbackRequest,
  bvmLocked, watchLocked,
}: SessionCardProps) {
  const [timerStatus, setTimerStatus] = useState<TimerStatus>({ locked: false, secondsRemaining: 0, started: false });
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
        ) : watchLocked ? (
          <span title={`Complete Session ${idx} assessment first`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: '#F3F4F6', color: '#9CA3AF', whiteSpace: 'nowrap', cursor: 'default' }}>
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
            onExpired={() => setTimerStatus({ locked: false, secondsRemaining: 0, started: true })}
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
