'use client';

import { useEffect, useRef } from 'react';
import {
  makeWatchTracker,
  reseedTracker,
  onPlay,
  onTick,
  onClose,
  watchedSeconds,
  snapshotIntervals,
  serializeIntervals,
  type WatchTrackerState,
  type Interval,
} from '@/src/hubs/training/lib/watch/watchTracker';

/* -- Minimal YT IFrame API types ----------------------------------------- */
interface YTPlayerOptions {
  videoId: string;
  playerVars?: Record<string, unknown>;
  events?: {
    onReady?: () => void;
    onStateChange?: (e: { data: number }) => void;
  };
}
interface YTPlayer { destroy(): void; getDuration?(): number; getCurrentTime?(): number; seekTo?(seconds: number, allowSeekAhead?: boolean): void }
interface YTAPI { Player: new (el: string, opts: YTPlayerOptions) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number } }

declare global {
  interface Window {
    YT: YTAPI;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

/* -- Progress payload ----------------------------------------------------- */
/**
 * The shape that `onProgress` emits on every tick / pause / end / unmount.
 *
 * `intervals` is a snapshot of merged closed intervals INCLUDING the
 * bounded open interval as if it had been closed at `currentPos`. This is
 * what the watch page POSTs to the server so the JSONB column always
 * reflects the student's actual watch -- never just intervals that
 * happened to be closed at report time. See `snapshotIntervals` in
 * `watchTracker.ts` for the rationale.
 *
 * `force === true` means the player closed for real (PAUSED, ENDED, or
 * unmount cleanup) and the parent should bypass its POST throttle so the
 * final partial interval lands in the database. Without this the last
 * 5-10s of every session was silently dropped (Failure #4 in the
 * diagnosis report).
 */
export interface WatchProgressPayload {
  watchedSec: number;
  totalSec: number;
  currentPos: number;
  intervals: Interval[];
  force: boolean;
}

/* -- Props ---------------------------------------------------------------- */
interface YouTubePlayerProps {
  videoId: string;
  title: string;
  sessionId?: string;
  studentEmail?: string;
  studentRegId?: string;
  /** Seed the tracker with seconds already persisted to DB (avoids backwards drift on reload). */
  baselineWatchedSeconds?: number;
  /** Seed the tracker with the intervals JSONB column from the DB so
   *  cross-session watch progress accumulates instead of being capped at
   *  the largest single contiguous run (the smoking-gun bug, migration 146). */
  initialIntervals?: Interval[];
  /** Resume playback from this position on load (passed to YT as playerVars.start). Zero/undefined = start at 0. */
  startSeconds?: number;
  onReady?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
  /**
   * Fires exactly once per mount when the video reaches its end. Two
   * triggers cover the common YouTube edge cases:
   *   - YT PlayerState.ENDED (the reliable path for most videos)
   *   - tick fallback: when `currentTime >= duration - 1`, which catches
   *     videos where ENDED doesn't emit (end-screen cards, quality
   *     switch at the tail, autoplay-then-stop behavior). Both paths
   *     guard against double-fire via `endedFiredRef`.
   */
  onEnded?: () => void;
  /**
   * Fires periodically (~10s during playback + on pause/end/unmount)
   * with the full `WatchProgressPayload`. `totalSec` may be 0 before
   * metadata loads. `force` is true on real close events (the parent
   * MUST bypass its POST throttle in those cases).
   */
  onProgress?: (payload: WatchProgressPayload) => void;
}

export function YouTubePlayer({
  videoId, title, sessionId, studentEmail, studentRegId,
  baselineWatchedSeconds, initialIntervals, startSeconds,
  onReady, onPlaying, onPaused, onEnded, onProgress,
}: YouTubePlayerProps) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerIdRef = useRef(`yt-player-${videoId}`);
  const reportedRef = useRef(false);

  // FIX 2.4 -- the tracker lives in a ref so external prop updates can
  // re-seed it without remounting the player. Parent's
  // baseline/initialIntervals often arrive AFTER the player has mounted
  // (the watch-history fetch is async), and a re-seed effect below
  // keeps the tracker in sync with the latest values without losing
  // any in-progress open interval or live-session intervals.
  const trackerRef = useRef<WatchTrackerState>(
    makeWatchTracker(baselineWatchedSeconds ?? 0, initialIntervals ?? []),
  );
  // Stable JSON form of initialIntervals so the re-seed effect doesn't
  // run on every render when the parent passes a new array reference.
  const initialIntervalsKey = JSON.stringify(initialIntervals ?? []);

  // Keep the latest onProgress callback in a ref so it's reachable from
  // the player's effect closure without re-running on every parent
  // render. The player's main useEffect depends only on `videoId`.
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);
  const onPlayingRef = useRef(onPlaying);
  useEffect(() => { onPlayingRef.current = onPlaying; }, [onPlaying]);
  const onPausedRef = useRef(onPaused);
  useEffect(() => { onPausedRef.current = onPaused; }, [onPaused]);
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // Re-seed tracker when parent props change (e.g. watch-history fetch
  // resolves after mount). Idempotent: reseedTracker takes the max of
  // baseline and the union of intervals so we never shrink credit.
  useEffect(() => {
    trackerRef.current = reseedTracker(
      trackerRef.current,
      baselineWatchedSeconds ?? 0,
      initialIntervals ?? [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineWatchedSeconds, initialIntervalsKey]);

  useEffect(() => {
    let destroyed = false;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let lastReportAt = 0;
    // Single-fire flag so both the ENDED state change AND the tick-fallback
    // can't double-fire onEnded. Whichever arrives first wins.
    let endedFired = false;

    function pos(): number { try { return playerRef.current?.getCurrentTime?.() ?? 0; } catch { return 0; } }
    function dur(): number { try { return playerRef.current?.getDuration?.() ?? 0; } catch { return 0; } }

    function fireEndedOnce() {
      if (endedFired) return;
      endedFired = true;
      try { onEndedRef.current?.(); } catch { /* caller error is not our problem */ }
    }

    function report(force = false) {
      const now = Date.now();
      if (!force && now - lastReportAt < 9500) return;
      lastReportAt = now;
      const c = pos();
      const tracker = trackerRef.current;
      const watched = watchedSeconds(tracker, c);
      const intervals = snapshotIntervals(tracker, c);
      onProgressRef.current?.({
        watchedSec: watched,
        totalSec: dur(),
        currentPos: c,
        intervals,
        force,
      });
    }

    function startTickCheck() {
      if (tickInterval) return;
      tickInterval = setInterval(() => {
        const c = pos();
        trackerRef.current = onTick(trackerRef.current, c);
        const d = dur();
        // End-of-video fallback. YT's PlayerState.ENDED is usually reliable,
        // but some videos (those with end-screen cards, mid-playback quality
        // switches, or when the player is auto-muted) skip the event. If
        // the playhead reaches the final second of a known duration, treat
        // that as "ended" and fire.
        if (d > 0 && c >= d - 1) fireEndedOnce();
        report(false);
      }, 1000);
    }
    function stopTickCheck() {
      if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    }

    function reportCompletion() {
      if (!sessionId || !studentEmail || reportedRef.current) return;
      reportedRef.current = true;
      fetch(`/api/training/live-sessions/${sessionId}/watched`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: studentEmail, regId: studentRegId ?? '' }),
      }).catch(e => {
        console.error('[YouTubePlayer] completion report failed:', e);
        reportedRef.current = false;
      });
    }

    function initPlayer() {
      if (destroyed) return;
      // Resume at stored last_position. YouTube's `start` playerVar is honored
      // reliably across browsers and survives buffering. We only seed it when
      // it's comfortably inside the video -- the caller clamps against
      // `total_seconds` to avoid seeking past-end (which would make YT loop
      // back to 0) and against rewatch-of-completed (resume from 0 then).
      const resumeAt = Math.max(0, Math.round(startSeconds ?? 0));
      playerRef.current = new window.YT.Player(containerIdRef.current, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
          ...(resumeAt > 0 ? { start: resumeAt } : {}),
        },
        events: {
          onReady: () => onReadyRef.current?.(),
          onStateChange: (event) => {
            const PS = window.YT.PlayerState;
            if (event.data === PS.PLAYING) {
              onPlayingRef.current?.();
              trackerRef.current = onPlay(trackerRef.current, pos());
              startTickCheck();
              report(true);
            }
            if (event.data === PS.PAUSED) {
              onPausedRef.current?.();
              trackerRef.current = onClose(trackerRef.current, pos());
              stopTickCheck();
              // End-of-video via PAUSED -- some YouTube configurations go
              // PLAYING -> PAUSED at the final second instead of
              // PLAYING -> ENDED (end-screen cards, annotations,
              // autoplay-disabled embeds). Without this the tick is
              // already stopped by stopTickCheck() above, so the
              // `c >= d-1` fallback in startTickCheck() never runs and
              // `videoEnded` stays false forever. Fire here too, guarded
              // by the same endedFired flag so ENDED still deduplicates.
              const d = dur();
              const c = pos();
              if (d > 0 && c >= d - 1) fireEndedOnce();
              report(true);
            }
            if (event.data === PS.BUFFERING) {
              // FIX 2.3 -- treat BUFFERING as a soft pause for tracker
              // purposes. YT's state machine fires PLAYING -> BUFFERING
              // -> PLAYING during quality switches, network re-buffer,
              // ad insertion, mobile orientation changes. The original
              // tracker ignored BUFFERING and only handled PLAYING /
              // PAUSED / ENDED, so the prior open interval wasn't
              // captured before the next PLAYING re-opened a new one.
              // Closing here AND in onPlay (FIX 2.1) is belt-and-braces
              // -- whichever fires first preserves the interval. We do
              // NOT call onPaused() (that's a real user pause) and do
              // NOT stop the tick -- when YT recovers it'll fire PLAYING
              // again which re-arms everything via onPlay.
              trackerRef.current = onClose(trackerRef.current, pos());
              report(true);
            }
            if (event.data === PS.ENDED) {
              trackerRef.current = onClose(trackerRef.current, pos());
              stopTickCheck();
              fireEndedOnce();
              report(true);
              reportCompletion();
            }
          },
        },
      });
    }

    // If YT API already loaded, init immediately
    if (window.YT?.Player) {
      initPlayer();
    } else {
      // Inject script once
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      // Queue init for when API is ready
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        initPlayer();
      };
    }

    return () => {
      destroyed = true;
      // Final close + report so the last partial interval is captured on
      // unmount. Force=true tells the parent to bypass its POST throttle
      // (FIX 2.5) -- without this the final 5-10s of every session was
      // silently dropped.
      try { trackerRef.current = onClose(trackerRef.current, playerRef.current?.getCurrentTime?.() ?? 0); } catch { /* ignore */ }
      report(true);
      stopTickCheck();
      try { playerRef.current?.destroy(); } catch { /* already gone */ }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  return (
    <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 12, background: '#000', marginBottom: 24 }}>
      <div id={containerIdRef.current} title={title} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
    </div>
  );
}

// Re-export the helper that callers serialise intervals through so they
// don't reach into the tracker module directly.
export { serializeIntervals };
