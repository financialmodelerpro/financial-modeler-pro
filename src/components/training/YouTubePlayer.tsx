'use client';

import { useEffect, useRef } from 'react';
import { makeWatchTracker, onPlay, onTick, onClose, watchedSeconds, type WatchTrackerState } from '@/src/lib/training/watchTracker';

/* ── Minimal YT IFrame API types ────────────────────────────────────────────── */
interface YTPlayerOptions {
  videoId: string;
  playerVars?: Record<string, unknown>;
  events?: {
    onReady?: () => void;
    onStateChange?: (e: { data: number }) => void;
  };
}
interface YTPlayer { destroy(): void; getDuration?(): number; getCurrentTime?(): number }
interface YTAPI { Player: new (el: string, opts: YTPlayerOptions) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number } }

declare global {
  interface Window {
    YT: YTAPI;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

/* ── Props ──────────────────────────────────────────────────────────────────── */
interface YouTubePlayerProps {
  videoId: string;
  title: string;
  sessionId?: string;
  studentEmail?: string;
  studentRegId?: string;
  /** Seed the tracker with seconds already persisted to DB (avoids backwards drift on reload). */
  baselineWatchedSeconds?: number;
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
   * Fires periodically (≈10s during playback + on pause/end) with interval-merged
   * watched seconds. `totalSeconds` may be 0 before metadata loads.
   */
  onProgress?: (watchedSec: number, totalSec: number, currentPos: number) => void;
}

export function YouTubePlayer({ videoId, title, sessionId, studentEmail, studentRegId, baselineWatchedSeconds, onReady, onPlaying, onPaused, onEnded, onProgress }: YouTubePlayerProps) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerIdRef = useRef(`yt-player-${videoId}`);
  const reportedRef = useRef(false);

  useEffect(() => {
    let destroyed = false;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let tracker: WatchTrackerState = makeWatchTracker(baselineWatchedSeconds ?? 0);
    let lastReportAt = 0;
    // Single-fire flag so both the ENDED state change AND the tick-fallback
    // can't double-fire onEnded. Whichever arrives first wins.
    let endedFired = false;

    function pos(): number { try { return playerRef.current?.getCurrentTime?.() ?? 0; } catch { return 0; } }
    function dur(): number { try { return playerRef.current?.getDuration?.() ?? 0; } catch { return 0; } }

    function fireEndedOnce() {
      if (endedFired) return;
      endedFired = true;
      try { onEnded?.(); } catch { /* caller error is not our problem */ }
    }

    function report(force = false) {
      const now = Date.now();
      if (!force && now - lastReportAt < 9500) return;
      lastReportAt = now;
      const c = pos();
      const watched = watchedSeconds(tracker, c);
      onProgress?.(watched, dur(), c);
    }

    function startTickCheck() {
      if (tickInterval) return;
      tickInterval = setInterval(() => {
        const c = pos();
        tracker = onTick(tracker, c);
        // End-of-video fallback. YT's PlayerState.ENDED is usually reliable,
        // but some videos (those with end-screen cards, mid-playback quality
        // switches, or when the player is auto-muted) skip the event. If
        // the playhead reaches the final second of a known duration, treat
        // that as "ended" and fire. No 20-second early trigger — user must
        // actually watch to the end.
        const d = dur();
        if (d > 0 && c >= d - 1) fireEndedOnce();
        report();
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
      playerRef.current = new window.YT.Player(containerIdRef.current, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => onReady?.(),
          onStateChange: (event) => {
            const PS = window.YT.PlayerState;
            if (event.data === PS.PLAYING) {
              onPlaying?.();
              tracker = onPlay(tracker, pos());
              startTickCheck();
              report(true);
            }
            if (event.data === PS.PAUSED) {
              onPaused?.();
              tracker = onClose(tracker, pos());
              stopTickCheck();
              report(true);
            }
            if (event.data === PS.ENDED) {
              tracker = onClose(tracker, pos());
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
      // Final close + report so the last partial interval is captured on unmount
      try { tracker = onClose(tracker, playerRef.current?.getCurrentTime?.() ?? 0); } catch { /* ignore */ }
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
