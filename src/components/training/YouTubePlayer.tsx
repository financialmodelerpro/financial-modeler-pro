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
  onEnded?: () => void;
  onNearEnd?: () => void;
  /**
   * Fires periodically (≈10s during playback + on pause/end) with interval-merged
   * watched seconds. `totalSeconds` may be 0 before metadata loads.
   */
  onProgress?: (watchedSec: number, totalSec: number, currentPos: number) => void;
}

export function YouTubePlayer({ videoId, title, sessionId, studentEmail, studentRegId, baselineWatchedSeconds, onReady, onPlaying, onPaused, onEnded, onNearEnd, onProgress }: YouTubePlayerProps) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerIdRef = useRef(`yt-player-${videoId}`);
  const reportedRef = useRef(false);

  useEffect(() => {
    let destroyed = false;
    let nearEndInterval: ReturnType<typeof setInterval> | null = null;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let nearEndFired = false;
    let tracker: WatchTrackerState = makeWatchTracker(baselineWatchedSeconds ?? 0);
    let lastReportAt = 0;

    function pos(): number { try { return playerRef.current?.getCurrentTime?.() ?? 0; } catch { return 0; } }
    function dur(): number { try { return playerRef.current?.getDuration?.() ?? 0; } catch { return 0; } }

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
        report();
      }, 1000);
    }
    function stopTickCheck() {
      if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    }

    function startNearEndCheck() {
      if (nearEndFired || !onNearEnd || nearEndInterval) return;
      nearEndInterval = setInterval(() => {
        const p = playerRef.current;
        if (!p?.getDuration || !p?.getCurrentTime) return;
        const d = p.getDuration();
        const cur = p.getCurrentTime();
        if (d > 0 && (d - cur) <= 20) {
          nearEndFired = true;
          onNearEnd();
          if (nearEndInterval) { clearInterval(nearEndInterval); nearEndInterval = null; }
        }
      }, 1000);
    }

    function stopNearEndCheck() {
      if (nearEndInterval) { clearInterval(nearEndInterval); nearEndInterval = null; }
    }

    function reportCompletion() {
      if (!sessionId || !studentEmail || reportedRef.current) return;
      reportedRef.current = true;
      fetch(`/api/training/live-sessions/${sessionId}/watched`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: studentEmail, regId: studentRegId ?? '' }),
      }).catch(() => { reportedRef.current = false; });
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
              startNearEndCheck();
              report(true);
            }
            if (event.data === PS.PAUSED) {
              onPaused?.();
              tracker = onClose(tracker, pos());
              stopTickCheck();
              stopNearEndCheck();
              report(true);
            }
            if (event.data === PS.ENDED) {
              tracker = onClose(tracker, pos());
              stopTickCheck();
              stopNearEndCheck();
              onEnded?.();
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
      stopNearEndCheck();
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
