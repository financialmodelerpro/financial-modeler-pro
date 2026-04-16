'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession } from '@/src/lib/training/training-session';
import { TrainingShell } from '@/src/components/training/TrainingShell';
import { CoursePlayerLayout, type SidebarSession } from '@/src/components/training/player/CoursePlayerLayout';
import { COURSES } from '@/src/config/courses';
import { startTimer, getTimerStatus } from '@/src/lib/training/videoTimer';
import type { LiveLinksMap, SessionProgress } from '@/src/components/training/dashboard/types';

function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export default function CourseWatchPage() {
  const params = useParams<{ courseId: string; sessionKey: string }>();
  const router = useRouter();
  const { courseId, sessionKey } = params;

  const [studentSession, setStudentSession] = useState<{ email: string; registrationId: string } | null>(null);
  const [liveLinks, setLiveLinks] = useState<LiveLinksMap>({});
  const [progressMap, setProgressMap] = useState<Map<string, SessionProgress>>(new Map());
  const [loading, setLoading] = useState(true);
  const [timerComplete, setTimerComplete] = useState(false);
  const [timerBypassed, setTimerBypassed] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [markedComplete, setMarkedComplete] = useState(false);

  const course = COURSES[courseId];

  // Fetch data
  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/signin'); return; }
    setStudentSession(sess);

    Promise.all([
      fetch('/api/training/course-details').then(r => r.json()),
      fetch(`/api/training/progress?registrationId=${encodeURIComponent(sess.registrationId)}&email=${encodeURIComponent(sess.email)}`).then(r => r.json()),
      fetch(`/api/training/certification-watch?email=${encodeURIComponent(sess.email)}`).then(r => r.json()).catch(() => ({ history: [] })),
    ]).then(([detailsJson, progressJson, watchJson]) => {
      const map: LiveLinksMap = {};
      for (const raw of detailsJson.sessions ?? []) {
        map[raw.tabKey] = { ...raw, videoDuration: raw.videoDuration ?? 0 };
      }
      setLiveLinks(map);
      const bypassed = detailsJson.timerBypassed === true;
      setTimerBypassed(bypassed);

      if (progressJson.success && progressJson.data) {
        setProgressMap(new Map((progressJson.data.sessions ?? []).map((s: SessionProgress) => [s.sessionId, s])));
      }

      // Immediate timer check with fresh bypass value (avoids race condition)
      if (course && sess) {
        const s = course.sessions.find(x => x.id === sessionKey);
        if (s) {
          const sessionTk = s.isFinal
            ? `${course.shortTitle.toUpperCase()}_Final`
            : `${course.shortTitle.toUpperCase()}_${s.id}`;
          const dur = map[sessionTk]?.videoDuration ?? 0;
          if (!dur || bypassed) {
            setTimerComplete(true);
          } else {
            const status = getTimerStatus(sess.registrationId, sessionTk, dur, bypassed);
            setTimerComplete(!status.locked);
          }
        }
      }

      // Restore certification watch history from DB
      if (course) {
        const currentSess = course.sessions.find(x => x.id === sessionKey);
        if (currentSess) {
          const watchTk = currentSess.isFinal
            ? `${course.shortTitle.toUpperCase()}_Final`
            : `${course.shortTitle.toUpperCase()}_${currentSess.id}`;
          const watchRecord = (watchJson.history as { tab_key: string; status: string }[] ?? [])
            .find((h: { tab_key: string }) => h.tab_key === watchTk);
          if (watchRecord?.status === 'completed') {
            setVideoEnded(true);
            setMarkedComplete(true);
            setTimerComplete(true);
          }
        }
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [router, courseId]);

  // Timer check
  const checkTimer = useCallback(() => {
    if (!studentSession || !course) return;
    const session = course.sessions.find(s => s.id === sessionKey);
    if (!session) return;
    const tk = session.isFinal
      ? `${course.shortTitle.toUpperCase()}_Final`
      : `${course.shortTitle.toUpperCase()}_${session.id}`;
    const dur = liveLinks[tk]?.videoDuration ?? 0;
    if (!dur) { setTimerComplete(true); return; }
    const status = getTimerStatus(studentSession.registrationId, tk, dur, timerBypassed);
    setTimerComplete(!status.locked);
  }, [studentSession, course, sessionKey, liveLinks, timerBypassed]);

  useEffect(() => { checkTimer(); }, [checkTimer]);

  useEffect(() => {
    if (loading) return;
    const id = setInterval(checkTimer, 10000);
    return () => clearInterval(id);
  }, [loading, checkTimer]);

  // Restore video-ended state from DB (progressMap) — session already passed = already complete
  useEffect(() => {
    if (!progressMap.size) return;
    const prog = progressMap.get(sessionKey);
    if (prog?.passed) {
      setVideoEnded(true);
      setMarkedComplete(true);
      setTimerComplete(true);
    }
  }, [progressMap, sessionKey]);

  // Restore timer-complete from localStorage (timer is time-based, stays in localStorage)
  useEffect(() => {
    if (!studentSession) return;
    const key = `fmp_timer_complete_${studentSession.registrationId}_${sessionKey}`;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'true') {
      setTimerComplete(true);
    }
  }, [studentSession, sessionKey]);

  // Handle near end (20s before video ends) — show Mark Complete early
  const handleNearEnd = useCallback(() => {
    setVideoEnded(true);
  }, []);

  // Handle video ended — also show Mark Complete button
  const handleVideoEnded = useCallback(() => {
    setVideoEnded(true);
    setTimerComplete(true);
    if (studentSession) {
      const key = `fmp_timer_complete_${studentSession.registrationId}_${sessionKey}`;
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, 'true');
    }
  }, [studentSession, sessionKey]);

  // Handle Mark Complete click — persists to certification_watch_history DB
  const handleMarkComplete = useCallback(() => {
    setMarkedComplete(true);
    if (!studentSession || !course) return;
    const session = course.sessions.find(s => s.id === sessionKey);
    if (!session) return;
    const tk = session.isFinal
      ? `${course.shortTitle.toUpperCase()}_Final`
      : `${course.shortTitle.toUpperCase()}_${session.id}`;
    fetch('/api/training/certification-watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_email: studentSession.email, tab_key: tk, course_id: courseId, status: 'completed' }),
    }).catch(() => {});
  }, [studentSession, course, sessionKey, courseId]);

  // Handle video play — start timer + record in_progress
  const handlePlaying = useCallback(() => {
    if (!studentSession || !course) return;
    const session = course.sessions.find(s => s.id === sessionKey);
    if (!session) return;
    const tk = session.isFinal
      ? `${course.shortTitle.toUpperCase()}_Final`
      : `${course.shortTitle.toUpperCase()}_${session.id}`;
    const dur = liveLinks[tk]?.videoDuration ?? 0;
    if (dur > 0) {
      startTimer(studentSession.registrationId, tk, dur);
      checkTimer();
    }
    // Record in_progress (fire-and-forget, only if not already marked complete)
    if (!markedComplete) {
      fetch('/api/training/certification-watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_email: studentSession.email, tab_key: tk, course_id: courseId, status: 'in_progress' }),
      }).catch(() => {});
    }
  }, [studentSession, course, sessionKey, liveLinks, checkTimer, markedComplete, courseId]);

  if (!course) {
    return (
      <TrainingShell headerOnly>
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>404</div>
          <div style={{ color: '#6B7280' }}>Course not found</div>
        </div>
      </TrainingShell>
    );
  }

  if (loading) {
    return (
      <TrainingShell headerOnly>
        <div style={{ textAlign: 'center', padding: 80, color: '#9CA3AF' }}>Loading...</div>
      </TrainingShell>
    );
  }

  const currentSession = course.sessions.find(s => s.id === sessionKey);
  if (!currentSession) {
    return (
      <TrainingShell headerOnly>
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>404</div>
          <div style={{ color: '#6B7280' }}>Session not found</div>
          <Link href={`/training/dashboard?course=${courseId}`} style={{ color: '#1B4F8A', marginTop: 12, display: 'inline-block' }}>Back to Course</Link>
        </div>
      </TrainingShell>
    );
  }

  const currentIdx = course.sessions.indexOf(currentSession);
  const tk = currentSession.isFinal
    ? `${course.shortTitle.toUpperCase()}_Final`
    : `${course.shortTitle.toUpperCase()}_${currentSession.id}`;
  const ytUrl = liveLinks[tk]?.youtubeUrl || currentSession.youtubeUrl || '';
  const videoId = extractYouTubeId(ytUrl);

  // Build sidebar sessions
  const sidebarSessions: SidebarSession[] = course.sessions.map((s, idx) => {
    const passed = progressMap.get(s.id)?.passed === true;
    let locked = false;
    if (idx > 0 && !s.isFinal) {
      locked = !progressMap.get(course.sessions[idx - 1].id)?.passed;
    }
    if (s.isFinal) {
      locked = !course.sessions.filter(x => !x.isFinal).every(x => progressMap.get(x.id)?.passed);
    }
    return {
      id: s.id,
      title: s.title,
      watched: passed,
      type: 'recorded' as const,
      href: locked ? '#' : `/training/watch/${courseId}/${s.id}`,
    };
  });

  // Next session
  const nextIdx = currentIdx + 1;
  const nextSession = nextIdx < course.sessions.length ? sidebarSessions[nextIdx] : null;
  const nextHref = nextSession && nextSession.href !== '#' ? nextSession.href : undefined;

  // Assessment URL — always use the internal route (Apps Script formUrl is deprecated)
  const assessmentUrl = `/training/assessment/${encodeURIComponent(tk)}`;

  return (
    <TrainingShell headerOnly>
      <CoursePlayerLayout
        title={currentSession.title}
        youtubeUrl={ytUrl || undefined}
        channelId={process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}
        sessionTitle={currentSession.title}
        sessionDescription={liveLinks[tk]?.description || `${course.title} — ${currentSession.title}`}
        sessionUrl={typeof window !== 'undefined' ? window.location.href : ''}
        nextSessionHref={nextHref}
        isWatched={markedComplete || progressMap.get(sessionKey)?.passed}
        onMarkComplete={videoEnded ? (markedComplete ? undefined : handleMarkComplete) : undefined}
        isCompleted={markedComplete || progressMap.get(sessionKey)?.passed === true}
        videoId={videoId || undefined}
        sessionId={sessionKey}
        studentEmail={studentSession?.email}
        studentRegId={studentSession?.registrationId}
        sessionType="recorded"
        isLoggedIn={true}
        sessions={sidebarSessions}
        currentSessionId={sessionKey}
        backUrl={`/training/dashboard?course=${courseId}`}
        backLabel={`← ${course.shortTitle}`}
        assessmentUrl={markedComplete && !progressMap.get(sessionKey)?.passed ? assessmentUrl : undefined}
        assessmentReady={markedComplete && !progressMap.get(sessionKey)?.passed}
        assessmentPassed={progressMap.get(sessionKey)?.passed === true}
        onVideoPlaying={handlePlaying}
        onVideoEnded={handleVideoEnded}
        onVideoNearEnd={handleNearEnd}
      />
    </TrainingShell>
  );
}
