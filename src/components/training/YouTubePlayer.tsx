'use client';

import { useEffect, useRef } from 'react';

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
  onReady?: () => void;
  onPlaying?: () => void;
  onPaused?: () => void;
  onEnded?: () => void;
  onNearEnd?: () => void;
}

export function YouTubePlayer({ videoId, title, sessionId, studentEmail, studentRegId, onReady, onPlaying, onPaused, onEnded, onNearEnd }: YouTubePlayerProps) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerIdRef = useRef(`yt-player-${videoId}`);
  const reportedRef = useRef(false);

  useEffect(() => {
    let destroyed = false;
    let nearEndInterval: ReturnType<typeof setInterval> | null = null;
    let nearEndFired = false;

    function startNearEndCheck() {
      if (nearEndFired || !onNearEnd || nearEndInterval) return;
      nearEndInterval = setInterval(() => {
        const p = playerRef.current;
        if (!p?.getDuration || !p?.getCurrentTime) return;
        const dur = p.getDuration();
        const cur = p.getCurrentTime();
        if (dur > 0 && (dur - cur) <= 20) {
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
            if (event.data === PS.PLAYING) { onPlaying?.(); startNearEndCheck(); }
            if (event.data === PS.PAUSED) { onPaused?.(); stopNearEndCheck(); }
            if (event.data === PS.ENDED) { stopNearEndCheck();
              onEnded?.();
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
