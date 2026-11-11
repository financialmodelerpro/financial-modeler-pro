'use client';

/**
 * The logo intro overlay. The server renders only the navy layer and Skip (hidden
 * by CSS unless the pre-paint script chose the intro); the video is added after
 * hydration, and only when the intro is showing, so no other visitor downloads
 * it and the page underneath is untouched.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INTRO_ASSETS, INTRO_BG, INTRO_FADE_MS, INTRO_FAIL_MS, INTRO_HTML_ATTR, INTRO_MAX_MS, INTRO_OVERLAY_ID, INTRO_SKIP_ATTR,
} from './introScope';

export function IntroOverlay() {
  const [active, setActive] = useState(false);
  const [fading, setFading] = useState(false);
  const done = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const dismiss = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setFading(true);
    timers.current.push(setTimeout(() => {
      document.documentElement.removeAttribute(INTRO_HTML_ATTR);
      setActive(false);
    }, INTRO_FADE_MS));
  }, []);

  const failSoon = useCallback(() => {
    timers.current.push(setTimeout(dismiss, INTRO_FAIL_MS));
  }, [dismiss]);

  useEffect(() => {
    const t = timers.current;
    // Deferred so the state change is not synchronous inside the effect.
    t.push(setTimeout(() => {
      if (document.documentElement.getAttribute(INTRO_HTML_ATTR) !== '1') return;
      setActive(true);
      t.push(setTimeout(dismiss, Math.max(0, INTRO_MAX_MS - performance.now())));
    }, 0));
    return () => { t.forEach(clearTimeout); };
  }, [dismiss]);

  // Once the video is in the page: play it (muted autoplay can still be refused).
  useEffect(() => {
    if (!active || !videoRef.current) return;
    const v = videoRef.current;
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(failSoon);
  }, [active, failSoon]);

  return (
    <div
      id={INTRO_OVERLAY_ID}
      data-testid="site-intro"
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000, background: INTRO_BG,
        opacity: fading ? 0 : 1, transition: `opacity ${INTRO_FADE_MS}ms ease`,
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      {active && (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            preload="auto"
            poster={INTRO_ASSETS.poster}
            onEnded={dismiss}
            onError={failSoon}
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: INTRO_BG }}
          >
            <source src={INTRO_ASSETS.webm} type="video/webm" />
            {/* The last source's error is the one that means "nothing here can play". */}
            <source src={INTRO_ASSETS.mp4} type="video/mp4" onError={failSoon} />
          </video>
        </>
      )}
      {/* In the server HTML, so Skip works from first paint (the pre-paint script listens for it). */}
      <button
        type="button"
        {...{ [INTRO_SKIP_ATTR]: '' }}
        onClick={dismiss}
        aria-label="Skip intro"
        style={{
          position: 'absolute', right: 'max(16px, env(safe-area-inset-right))', bottom: 'max(16px, env(safe-area-inset-bottom))',
          padding: '8px 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.55)',
          background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}
      >
        Skip
      </button>
    </div>
  );
}
