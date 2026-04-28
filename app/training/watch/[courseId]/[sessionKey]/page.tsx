'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTrainingSession } from '@/src/hubs/training/lib/session/training-session';
import { TrainingShell } from '@/src/hubs/training/components/TrainingShell';
import { CoursePlayerLayout, type SidebarSession } from '@/src/hubs/training/components/player/CoursePlayerLayout';
import { COURSES } from '@/src/hubs/training/config/courses';
import { startTimer, getTimerStatus } from '@/src/hubs/training/lib/watch/videoTimer';
import { WatchProgressBar } from '@/src/hubs/training/components/WatchProgressBar';
import { allRegularSessionsPassed, type LiveLinksMap, type SessionProgress } from '@/src/hubs/training/components/dashboard/types';
import { extractYouTubeId } from '@/src/shared/cms';
import type { WatchProgressPayload } from '@/src/hubs/training/components/YouTubePlayer';
import { hydrateIntervals, serializeIntervals, type Interval } from '@/src/hubs/training/lib/watch/watchTracker';

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
  // Watch-enforcement state
  const [enforcement, setEnforcement] = useState<{ enabled: boolean; threshold: number; sessionBypass: boolean; isAdmin: boolean }>({
    enabled: true, threshold: 70, sessionBypass: false, isAdmin: false,
  });
  const [baselineWatchedSec, setBaselineWatchedSec] = useState(0);
  // Hydrated from the watch_intervals JSONB column (migration 146). Seeds
  // the YouTubePlayer's tracker on mount so cross-session watch%
  // accumulates -- without this seed the tracker stays at the largest
  // single contiguous run forever (the smoking-gun bug). The reseed
  // effect inside YouTubePlayer picks up new values when this state
  // resolves AFTER the player has already mounted.
  const [initialIntervals, setInitialIntervals] = useState<Interval[]>([]);
  const [liveWatchSec, setLiveWatchSec] = useState(0);
  const [liveTotalSec, setLiveTotalSec] = useState(0);
  // Resume position captured from DB on mount. Passed once to the YT player
  // via playerVars.start so the video opens at the student's last position
  // instead of 0:00. Zeroed when the session is already completed so a
  // rewatch starts fresh; clamped below total-30 to avoid seeking past-end.
  const [resumeAtSec, setResumeAtSec] = useState(0);
  // Tracks the YT player's currentTime — used to evaluate the "last
  // 20 seconds" near-end window. Always monotonic-max so a seek-back
  // from pos 1700 → 200 can't collapse the gate once it's open.
  const [liveCurrentPos, setLiveCurrentPos] = useState(0);
  const lastPostedRef = useRef<{ sec: number; at: number }>({ sec: 0, at: 0 });

  const course = COURSES[courseId];

  // Fetch data
  useEffect(() => {
    const sess = getTrainingSession();
    if (!sess) { router.replace('/training/signin'); return; }
    setStudentSession(sess);

    // Build the tabKey early so we can query enforcement by it
    const earlyCourse = COURSES[courseId];
    const earlySession = earlyCourse?.sessions.find(x => x.id === sessionKey);
    const earlyTk = earlyCourse && earlySession
      ? (earlySession.isFinal ? `${earlyCourse.shortTitle.toUpperCase()}_Final` : `${earlyCourse.shortTitle.toUpperCase()}_${earlySession.id}`)
      : '';

    Promise.all([
      fetch('/api/training/course-details').then(r => r.json()),
      fetch(`/api/training/progress?registrationId=${encodeURIComponent(sess.registrationId)}&email=${encodeURIComponent(sess.email)}`).then(r => r.json()),
      fetch(`/api/training/certification-watch?email=${encodeURIComponent(sess.email)}`).then(r => r.json()).catch(() => ({ history: [] })),
      earlyTk ? fetch(`/api/training/watch-enforcement?tabKeys=${encodeURIComponent(earlyTk)}`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
    ]).then(([detailsJson, progressJson, watchJson, enforceJson]) => {
      if (enforceJson && earlyTk) {
        setEnforcement({
          enabled:       enforceJson.enabled !== false,
          threshold:     typeof enforceJson.threshold === 'number' ? enforceJson.threshold : 70,
          sessionBypass: !!enforceJson.sessionBypass?.[earlyTk],
          isAdmin:       !!enforceJson.isAdmin,
        });
      }
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
          const watchRecord = (watchJson.history as { tab_key: string; status: string; watch_seconds?: number; total_seconds?: number; last_position?: number; watch_intervals?: unknown }[] ?? [])
            .find((h: { tab_key: string }) => h.tab_key === watchTk);
          if (watchRecord?.status === 'completed') {
            setVideoEnded(true);
            setMarkedComplete(true);
            setTimerComplete(true);
          }
          if (watchRecord) {
            const base = Math.max(0, Math.round(watchRecord.watch_seconds ?? 0));
            const total = Math.max(0, Math.round(watchRecord.total_seconds ?? 0));
            const pos = Math.max(0, Math.round(watchRecord.last_position ?? 0));
            setBaselineWatchedSec(base);
            setLiveWatchSec(base);
            setLiveTotalSec(total);
            // Hydrate prior intervals so the tracker can union them with
            // the current session's playback (migration 146 fix).
            setInitialIntervals(hydrateIntervals(watchRecord.watch_intervals ?? []));
            if (watchRecord.status !== 'completed' && pos > 10 && (total === 0 || pos < total - 30)) {
              // Resume only when meaningfully inside the video and not
              // already completed. Completed rewatch starts at 0.
              setResumeAtSec(pos);
            }
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

  // Restore video-ended state from DB (progressMap) - session already passed = already complete
  useEffect(() => {
    if (!progressMap.size) return;
    const prog = progressMap.get(sessionKey);
    if (prog?.passed) {
      setVideoEnded(true);
      setMarkedComplete(true);
      setTimerComplete(true);
    }
  }, [progressMap, sessionKey]);

  // BVM direct-URL gate. Same rule the dashboard applies to hide BVM content
  // (all regular 3SFM sessions + the 3SFM final must be passed). Without this
  // gate a student could deep-link past the prerequisite; the dashboard tile
  // is locked but the URL isn't. Run only after loading completes so we don't
  // false-redirect while the progress fetch is still in flight.
  useEffect(() => {
    if (loading) return;
    if (courseId !== 'bvm') return;
    const sfmFinal = COURSES['3sfm']?.sessions.find(s => s.isFinal);
    const bvmUnlocked = allRegularSessionsPassed('3sfm', progressMap)
      && !!sfmFinal && progressMap.get(sfmFinal.id)?.passed === true;
    if (!bvmUnlocked) router.replace('/training/dashboard?course=bvm');
  }, [loading, courseId, progressMap, router]);

  // Restore timer-complete from localStorage (timer is time-based, stays in localStorage)
  useEffect(() => {
    if (!studentSession) return;
    const key = `fmp_timer_complete_${studentSession.registrationId}_${sessionKey}`;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'true') {
      setTimerComplete(true);
    }
  }, [studentSession, sessionKey]);

  // Handle video ended. Drives setTimerComplete + localStorage stamp so
  // a refresh after legitimate completion doesn't re-lock the button.
  // The YT PlayerState.ENDED event + the player's own currentTime >=
  // duration-1 fallback both funnel into here.
  const handleVideoEnded = useCallback(() => {
    setVideoEnded(true);
    setTimerComplete(true);
    if (studentSession) {
      const key = `fmp_timer_complete_${studentSession.registrationId}_${sessionKey}`;
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, 'true');
    }
  }, [studentSession, sessionKey]);

  // Handle Mark Complete click (auto path: pct >= threshold). Persists
  // to certification_watch_history DB. Server stamps completed_via='threshold'.
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

  // Manual override (Phase 3): student confirms via checkbox at >= 50%.
  // Server enforces pct >= 50 AND wall-clock elapsed >= total * 0.8;
  // a 403 lands here with a readable error message and the row stays
  // in_progress so the student can keep watching.
  const handleManualComplete = useCallback(async () => {
    if (!studentSession || !course) return;
    const session = course.sessions.find(s => s.id === sessionKey);
    if (!session) return;
    const tk = session.isFinal
      ? `${course.shortTitle.toUpperCase()}_Final`
      : `${course.shortTitle.toUpperCase()}_${session.id}`;
    try {
      const res = await fetch('/api/training/certification-watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_email: studentSession.email,
          tab_key: tk,
          course_id: courseId,
          status: 'completed',
          manual_override: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as {
          error?: string; current?: number; required?: number;
          elapsedSec?: number; requiredSec?: number;
        };
        const detail = err.requiredSec != null && err.elapsedSec != null
          ? `${err.error ?? 'Override blocked'} (page open for ${Math.round(err.elapsedSec / 60)} min, need ~${Math.round(err.requiredSec / 60)} min).`
          : err.current != null && err.required != null
          ? `${err.error ?? 'Override blocked'} (watched ${err.current}%, need at least ${err.required}%).`
          : err.error ?? 'Could not mark complete. Please keep watching.';
        alert(detail);
        return;
      }
      setMarkedComplete(true);
    } catch {
      alert('Network error. Please try again.');
    }
  }, [studentSession, course, sessionKey, courseId]);

  /**
   * Fires ~every 10s during playback, on pause, end, BUFFERING, and on
   * unmount. Tracks actual watched seconds (interval-merged by
   * watchTracker in YouTubePlayer) and posts to the DB so the threshold
   * can be enforced server-side too.
   *
   * `force=true` indicates a real close event (PAUSED / ENDED / BUFFERING
   * / unmount) -- bypass the throttle so the final partial interval lands
   * in the DB. Without this the last 5-10s of every session was dropped.
   *
   * `intervals` is the snapshot from the tracker (open interval virtually
   * closed at currentPos, clamped by wall-clock). Posted as
   * `watch_intervals` so the server can union with the JSONB column.
   */
  const handleProgress = useCallback((payload: WatchProgressPayload) => {
    const { watchedSec, totalSec, currentPos, intervals, force } = payload;
    // Monotonic-upward only. The YouTubePlayer's internal tracker is
    // initialized at mount time with `baselineWatchedSec` captured from
    // props, which starts at 0 and only arrives once the watch-history
    // fetch completes. Until then, the tracker reports from 0 upward
    // for THIS session. If we unconditionally set liveWatchSec to the
    // tracker value, a returning student whose DB baseline is 1800 sees
    // liveWatchSec get clobbered back to 3, 4, 5… right after play
    // starts — watchPct drops below threshold, button never unlocks.
    // Taking max(prev, baseline, watched) preserves the baseline as a
    // floor and lets liveWatchSec only climb.
    setLiveWatchSec(prev => Math.max(prev, baselineWatchedSec, watchedSec));
    if (totalSec > 0) setLiveTotalSec(prev => Math.max(prev, totalSec));
    if (currentPos > 0) setLiveCurrentPos(prev => Math.max(prev, currentPos));

    if (!studentSession || !course) return;
    const session = course.sessions.find(s => s.id === sessionKey);
    if (!session) return;
    const tk = session.isFinal
      ? `${course.shortTitle.toUpperCase()}_Final`
      : `${course.shortTitle.toUpperCase()}_${session.id}`;

    // Throttle: only POST if ≥10s elapsed AND value grew by ≥5s since last post
    // (plus always POST the first one, and always POST when force=true so
    // the final partial interval on unmount/pause/buffering lands in the DB).
    const now = Date.now();
    const last = lastPostedRef.current;
    const delta = watchedSec - last.sec;
    const tooSoon = now - last.at < 9500;
    if (!force && tooSoon && delta < 5 && last.at !== 0) return;
    lastPostedRef.current = { sec: watchedSec, at: now };

    fetch('/api/training/certification-watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_email: studentSession.email,
        tab_key: tk,
        course_id: courseId,
        status: markedComplete ? 'completed' : 'in_progress',
        watch_seconds: Math.round(watchedSec),
        total_seconds: Math.round(totalSec),
        last_position: Math.round(currentPos),
        watch_intervals: serializeIntervals(intervals),
      }),
    }).catch(() => {});
  }, [studentSession, course, sessionKey, courseId, markedComplete, baselineWatchedSec]);

  // Handle video play - start timer + record in_progress
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

  // Assessment URL - always use the internal route (Apps Script formUrl is deprecated)
  const assessmentUrl = `/training/assessment/${encodeURIComponent(tk)}`;

  // Watch-enforcement gate:
  //
  //   canMarkComplete = bypassActive || thresholdMet
  //
  // The interval-merging tracker (watchTracker) only credits real-time
  // playback, so seeking forward cannot inflate watchPct. That makes the
  // threshold check the actual anti-skip guard. The server re-checks the
  // stored watch_percentage against threshold before accepting
  // status='completed', so a tampered POST also bounces.
  //
  // We previously also required the playhead to be inside the last 20s
  // of the video (or the videoEnded event to have fired). That gate
  // hid the button for students who returned to the page after already
  // crossing threshold but had not scrubbed back to the end, leaving
  // them no way to finish without re-seeking. Dropping it surfaces the
  // button the moment a returning student loads the page.
  const watchPct = liveTotalSec > 0 ? Math.min(100, Math.round((liveWatchSec / liveTotalSec) * 100)) : 0;
  const thresholdMet = watchPct >= enforcement.threshold;
  const bypassActive = !enforcement.enabled || enforcement.sessionBypass || enforcement.isAdmin;
  const canMarkComplete = bypassActive || thresholdMet;

  // CourseTopBar hides the button entirely when `onMarkComplete` is undefined,
  // so we avoid visually-enabled-but-blocked UX.
  const markCompleteCallback = canMarkComplete && !markedComplete ? handleMarkComplete : undefined;

  // Manual override (Phase 3 / migration 147). Surfaces a checkbox +
  // Mark Complete button when watch% is in the [50, threshold) band
  // AND the auto path isn't already available. Below 50% there's no
  // path forward; the ghost hint takes over. Server still enforces
  // the elapsed-time check before honouring the override.
  const sessPassed = progressMap.get(sessionKey)?.passed === true;
  const manualOverrideAvailable =
    !markCompleteCallback &&
    !markedComplete &&
    !sessPassed &&
    !bypassActive &&
    watchPct >= 50;
  const manualCompleteCallback = manualOverrideAvailable ? handleManualComplete : undefined;

  // Ghost hint for the top bar. Reachable only when neither the auto
  // nor manual path is open. Surfaced once the student starts playing
  // so the toolbar isn't blank.
  let watchHint: string | undefined;
  if (!markCompleteCallback && !manualCompleteCallback && !markedComplete && !sessPassed && liveTotalSec > 0 && liveCurrentPos > 0) {
    watchHint = `Watching… ${watchPct}%`;
  }

  // Progress bar sits in the scroll area above the Mark Complete button (CourseTopBar).
  // We only show it while the student is watching (video opened, not yet completed).
  const progressBar = !markedComplete && !progressMap.get(sessionKey)?.passed ? (
    <WatchProgressBar
      watchPct={watchPct}
      threshold={enforcement.threshold}
      enforcing={enforcement.enabled}
      adminBypass={enforcement.isAdmin}
      sessionBypass={enforcement.sessionBypass}
    />
  ) : null;

  return (
    <TrainingShell headerOnly>
      <CoursePlayerLayout
        title={currentSession.title}
        youtubeUrl={ytUrl || undefined}
        channelId={process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}
        sessionTitle={currentSession.title}
        sessionDescription={liveLinks[tk]?.description || `${course.title} - ${currentSession.title}`}
        sessionUrl={typeof window !== 'undefined' ? window.location.href : ''}
        nextSessionHref={nextHref}
        isWatched={markedComplete || progressMap.get(sessionKey)?.passed}
        onMarkComplete={markCompleteCallback}
        onManualComplete={manualCompleteCallback}
        watchHint={watchHint}
        isCompleted={markedComplete || progressMap.get(sessionKey)?.passed === true}
        videoId={videoId || undefined}
        sessionId={sessionKey}
        studentEmail={studentSession?.email}
        studentRegId={studentSession?.registrationId}
        baselineWatchedSeconds={baselineWatchedSec}
        initialIntervals={initialIntervals}
        resumePositionSeconds={resumeAtSec}
        belowVideoContent={progressBar}
        sessionType="recorded"
        isLoggedIn={true}
        backUrl={`/training/dashboard?course=${courseId}`}
        backLabel={course.shortTitle}
        assessmentUrl={markedComplete && !progressMap.get(sessionKey)?.passed ? assessmentUrl : undefined}
        assessmentReady={markedComplete && !progressMap.get(sessionKey)?.passed}
        assessmentPassed={progressMap.get(sessionKey)?.passed === true}
        onVideoPlaying={handlePlaying}
        onVideoEnded={handleVideoEnded}
        onVideoProgress={handleProgress}
      />
    </TrainingShell>
  );
}
