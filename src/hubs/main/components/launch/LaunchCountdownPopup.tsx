'use client';

/**
 * LaunchCountdownPopup.tsx (client)
 *
 * The square launch countdown, centred over the page. Rendered only by the
 * server LaunchCountdownBanner, which has already decided the launch date is
 * real and still in the future, so this component owns three things only:
 * WHERE it may appear, WHETHER the visitor has dismissed it this session, and
 * the live tick down to zero.
 *
 * Behaviour worth knowing:
 *  - It stays SQUARE by sizing off the smaller of the two viewport axes, so it
 *    shrinks on a phone (and in landscape) instead of overflowing. The inner
 *    type scales with it via clamp.
 *  - Dismissal is sessionStorage keyed on the launch date, so it stays gone for
 *    the session but returns for a genuinely new announcement.
 *  - It disappears BY ITSELF the moment the countdown reaches zero, via the
 *    CountdownTimer onComplete hook, so a visitor sitting on the page at launch
 *    is not left staring at a stale banner.
 *  - It renders only after mount, so the server never emits it. That avoids a
 *    hydration mismatch on the date formatting (which is locale and timezone
 *    dependent) and matches how PromoPopup already behaves.
 *
 * Palette is the brand navy from globals.css (navy-darkest #0D2E5A through
 * navy #1B4F8A) with the gold accent #C9A84C on the digits.
 *
 * No em dashes in this file.
 */
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CountdownTimer } from '@/src/shared/components/CountdownTimer';
import { isLaunchBannerPath, launchDismissKey, type LaunchMode, type LaunchCopy, type LaunchedCopy } from './launchCountdown';

const NAVY_DARKEST = '#0D2E5A';
const NAVY = '#1B4F8A';
const GOLD = '#C9A84C';

export default function LaunchCountdownPopup({ targetIso, mode, countdown, launched }: {
  targetIso: string;
  /** Which state the SERVER resolved. The client can advance countdown ->
   *  launched when the clock crosses the date, but never the other way. */
  mode: Exclude<LaunchMode, 'hidden'>;
  /** Both sets of copy, admin-editable and platform-resolved. Never built here. */
  countdown: LaunchCopy;
  launched: LaunchedCopy;
}): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  // Local mode, seeded from the server. It only ever moves forward, when the
  // countdown reaches zero while someone is looking at the page.
  const [current, setCurrent] = useState<Exclude<LaunchMode, 'hidden'>>(mode);
  const pathname = usePathname();
  // Keyed on the CURRENT mode, so closing the countdown does not also swallow
  // the launch announcement later in the same session.
  const storageKey = launchDismissKey(targetIso, current);

  // A server-driven mode change (a new request after the date passed) wins over
  // whatever this tab was showing.
  useEffect(() => { setCurrent(mode); }, [mode]);

  useEffect(() => {
    if (!isLaunchBannerPath(pathname)) { setVisible(false); return; }
    try {
      setVisible(sessionStorage.getItem(storageKey) !== '1');
    } catch {
      setVisible(true); // storage blocked (private mode): still announce it
    }
  }, [pathname, storageKey]);

  const dismiss = useCallback(() => {
    setVisible(false);
    try { sessionStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
  }, [storageKey]);

  // Escape closes it, the same as the close button. Bound only while visible.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, dismiss]);

  // Reaching zero SWITCHES to the launch announcement rather than hiding, so a
  // visitor sitting on the page at launch sees the news instead of the banner
  // vanishing under them. No dismissal is written: this is a state change, not
  // a dismissal, and the new state carries its own storage key.
  const onComplete = useCallback(() => setCurrent('launched'), []);

  if (!visible) return null;

  const isLaunched = current === 'launched';
  const copy: LaunchCopy = isLaunched ? launched : countdown;

  // WIDE, not square. Width leads and height follows the content, capped to the
  // viewport so a short window scrolls the card rather than overflowing it.
  const width = 'min(800px, calc(100vw - 32px))';

  return (
    <>
      {/* Backdrop. Clicking it dismisses, which is what people expect from a
          centred overlay and keeps the page reachable in one action. */}
      <div
        data-testid="launch-countdown-backdrop"
        onClick={dismiss}
        style={{
          position: 'fixed', inset: 0, zIndex: 700,
          background: 'rgba(4,14,28,0.55)', backdropFilter: 'blur(2px)',
        }}
      />
      <div
        data-testid="launch-countdown-banner"
        role="dialog"
        aria-modal="false"
        aria-label={isLaunched ? 'Launch announcement' : 'Launch countdown'}
        data-mode={current}
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 701,
          width, maxHeight: 'calc(100vh - 32px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center',
          padding: 'clamp(22px, 4vw, 44px) clamp(18px, 4vw, 52px)',
          borderRadius: 18,
          background: `linear-gradient(135deg, #0A1F3D 0%, ${NAVY_DARKEST} 55%, ${NAVY} 100%)`,
          border: `1px solid rgba(201,168,76,0.45)`,
          boxShadow: '0 28px 70px -20px rgba(0,0,0,0.65)',
          fontFamily: "'Inter', sans-serif",
          overflowY: 'auto',
        }}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss launch announcement"
          data-testid="launch-countdown-dismiss"
          style={{
            position: 'absolute', top: 10, right: 12,
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)',
            fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}
        >
          &times;
        </button>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(201,168,76,0.14)', border: '1px solid rgba(201,168,76,0.5)',
          borderRadius: 20, padding: '4px 14px',
          fontSize: 'clamp(9px, 1.5vw, 11px)', fontWeight: 800, color: GOLD,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          marginBottom: 'clamp(10px, 1.8vw, 16px)',
        }}>
          {isLaunched ? 'Now live' : 'Launching soon'}
        </div>

        <div data-testid="launch-countdown-headline" style={{
          fontSize: 'clamp(20px, 3.6vw, 34px)', fontWeight: 800, color: '#fff',
          lineHeight: 1.15, letterSpacing: '-0.02em',
          marginBottom: 'clamp(6px, 1.2vw, 10px)',
        }}>
          {copy.headline}
        </div>

        {copy.subline && (
          <div data-testid="launch-countdown-subline" style={{
            fontSize: 'clamp(12px, 1.7vw, 15px)', fontWeight: 500,
            color: 'rgba(255,255,255,0.72)', lineHeight: 1.55,
            marginBottom: 'clamp(14px, 2.4vw, 22px)',
            maxWidth: 560,
          }}>
            {copy.subline}
          </div>
        )}

        {!isLaunched && (
          <>
            {/* CountdownTimer caps its own digit grid at min(440px, 100%), so in
                a wide card the digits centre rather than stretching apart. */}
            <div style={{ width: '100%' }}>
              <CountdownTimer
                targetDate={targetIso}
                onComplete={onComplete}
                accentColor={GOLD}
                cardBackground="rgba(255,255,255,0.06)"
                cardBorder="rgba(201,168,76,0.28)"
              />
            </div>

            <div style={{
              marginTop: 'clamp(12px, 2vw, 20px)',
              fontSize: 'clamp(11px, 1.5vw, 13px)',
              color: 'rgba(255,255,255,0.62)', letterSpacing: '0.02em',
            }}>
              {new Date(targetIso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}
            </div>
          </>
        )}

        {/* Post-launch call to action. A plain anchor, not next/link, because the
            destination is an absolute app-subdomain URL while this banner also
            renders on the apex marketing pages. Rendered only when a
            destination resolved, so a cleared href degrades to no button rather
            than a dead link. */}
        {isLaunched && launched.ctaHref && launched.ctaLabel && (
          <a
            href={launched.ctaHref}
            data-testid="launch-countdown-cta"
            style={{
              display: 'inline-block',
              background: GOLD, color: NAVY_DARKEST,
              fontWeight: 800, fontSize: 'clamp(13px, 1.6vw, 15px)',
              padding: 'clamp(10px, 1.4vw, 14px) clamp(22px, 3vw, 34px)',
              borderRadius: 9, textDecoration: 'none',
              boxShadow: '0 10px 26px -10px rgba(201,168,76,0.7)',
            }}
          >
            {launched.ctaLabel}
          </a>
        )}
      </div>
    </>
  );
}
