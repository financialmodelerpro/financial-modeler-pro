'use client';

import { useEffect, useState } from 'react';
import { SessionCard } from './SessionCard';
import type { LiveSession, WatchHistoryEntry } from '@/src/lib/training/liveSessionsForStudent';

interface AttemptSummary {
  attempts: number;
  maxAttempts: number;
  passed: boolean;
  bestScore: number;
}

interface Props {
  session: LiveSession & { has_assessment?: boolean };
  idx: number;
  studentEmail: string;
  studentName: string;
  registrationId: string;
  watch?: WatchHistoryEntry;
  attempt?: AttemptSummary | null;
  watchThreshold?: number;
}

/**
 * Adapter: renders a recorded live session using the 3SFM SessionCard so the
 * visual treatment (borders, status badge, score row, Share/Card buttons,
 * attachments, notes) is pixel-identical to course sessions.
 *
 * Data mapping:
 *   - tabKey = `LIVE_${session.id}` → attachments + notes API both keyed the same
 *     way for course and live sessions
 *   - watchHref/assessmentHref override the default course-scoped routes
 *   - hideAssessment when the session has no assessment → score row + Take
 *     Assessment chip disappear, but Share/Card stay visible once watched
 */
export function RecordedLiveSessionRow({
  session, idx, studentEmail, studentName, registrationId, watch, attempt, watchThreshold = 70,
}: Props) {
  const tabKey = `LIVE_${session.id}`;
  const [noteContent, setNoteContent] = useState('');

  useEffect(() => {
    fetch(`/api/training/session-notes?sessionId=${encodeURIComponent(tabKey)}&email=${encodeURIComponent(studentEmail)}`)
      .then(r => r.json())
      .then((d: { notes?: string }) => setNoteContent(d.notes ?? ''))
      .catch(() => {});
  }, [tabKey, studentEmail]);

  async function saveNote(_sessionKey: string, content: string) {
    try {
      await fetch('/api/training/session-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: tabKey, student_email: studentEmail, notes: content }),
      });
    } catch { /* swallow — re-try on next keystroke */ }
  }

  const hasAssessment = !!session.has_assessment;
  const watchPct = Math.min(100, Math.max(0, Number(watch?.watch_percentage ?? 0)));
  const watchCompleted = watch?.status === 'completed' || watchPct >= 100;
  const watchMet = watchPct >= watchThreshold;

  // Build SessionCard's `prog` from either the quiz attempt (if there's an
  // assessment) or the watch record (if there isn't). For sessions with no
  // assessment, watching ≥ threshold counts as "passed" so the card renders
  // the green state + Share/Card buttons.
  const prog = hasAssessment
    ? (attempt && attempt.attempts > 0
        ? {
            sessionId: session.id,
            passed: attempt.passed,
            score: attempt.bestScore,
            attempts: attempt.attempts,
            completedAt: watch?.watched_at ?? null,
          }
        : undefined)
    : (watchMet
        ? {
            sessionId: session.id,
            passed: true,
            score: 100,
            attempts: 0,
            completedAt: watch?.watched_at ?? null,
          }
        : undefined);

  const label = `R${idx + 1}`;
  const courseName = 'FMP Real-World Financial Modeling';

  return (
    <SessionCard
      sessionTitle={session.title}
      sessionId={session.id}
      maxAttempts={attempt?.maxAttempts ?? 3}
      questionCount={0}
      passingScore={70}
      idx={idx}
      prog={prog}
      locked={false}
      ytUrl={session.youtube_url ?? ''}
      isFinal={false}
      passedCount={0}
      regularCount={0}
      tabKey={tabKey}
      videoDuration={session.duration_minutes ?? 0}
      regId={registrationId}
      noteContent={noteContent}
      onNoteSave={saveNote}
      feedbackGiven={true}
      onFeedbackRequest={() => {}}
      isWatched={watchCompleted || watchMet}
      isInProgress={!watchCompleted && watchPct > 0 && watchPct < watchThreshold}
      watchPercentage={watchPct || undefined}
      watchThreshold={watchThreshold}
      courseName={courseName}
      studentName={studentName}
      // Live-session overrides:
      watchHref={`/training/live-sessions/${session.id}`}
      assessmentHref={`/training/live-sessions/${session.id}/assessment`}
      hideAssessment={!hasAssessment}
      hideNotes={false}
      labelOverride={label}
    />
  );
}
