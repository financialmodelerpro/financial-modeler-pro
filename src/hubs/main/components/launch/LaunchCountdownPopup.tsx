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
import { isLaunchBannerPath, launchDismissKey } from './launchCountdown';

const NAVY_DARKEST = '#0D2E5A';
const NAVY = '#1B4F8A';
const GOLD = '#C9A84C';

export default function LaunchCountdownPopup({ targetIso, headline, subline }: {
  targetIso: string;
  /** Admin-editable, platform-resolved. Never built in this component. */
  headline: string;
  subline: string;
}): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const storageKey = launchDismissKey(targetIso);

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

  // Reaching zero hides it WITHOUT writing the dismissal flag: the banner is
  // over for everyone, not dismissed by this visitor.
  const onComplete = useCallback(() => setVisible(false), []);

  if (!visible) return null;

  // Square on every screen: the side is the smaller of 400px, the viewport
  // width minus a gutter, and the viewport height minus a gutter.
  const side = 'min(400px, calc(100vw - 32px), calc(100vh - 32px))';

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
        aria-label="Launch countdown"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 701,
          width: side, height: side,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center',
          padding: 'clamp(16px, 4.5vmin, 28px)',
          borderRadius: 18,
          background: `linear-gradient(135deg, #0A1F3D 0%, ${NAVY_DARKEST} 55%, ${NAVY} 100%)`,
          border: `1px solid rgba(201,168,76,0.45)`,
          boxShadow: '0 28px 70px -20px rgba(0,0,0,0.65)',
          fontFamily: "'Inter', sans-serif",
          overflow: 'hidden',
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
          fontSize: 'clamp(9px, 2.4vmin, 11px)', fontWeight: 800, color: GOLD,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          marginBottom: 'clamp(8px, 2.5vmin, 14px)',
        }}>
          Launching soon
        </div>

        <div data-testid="launch-countdown-headline" style={{
          fontSize: 'clamp(17px, 4.8vmin, 25px)', fontWeight: 800, color: '#fff',
          lineHeight: 1.2, letterSpacing: '-0.02em',
          marginBottom: 'clamp(5px, 1.6vmin, 8px)',
        }}>
          {headline}
        </div>

        {subline && (
          <div data-testid="launch-countdown-subline" style={{
            fontSize: 'clamp(11px, 2.9vmin, 13.5px)', fontWeight: 500,
            color: 'rgba(255,255,255,0.72)', lineHeight: 1.5,
            marginBottom: 'clamp(10px, 3vmin, 18px)',
            maxWidth: '92%',
          }}>
            {subline}
          </div>
        )}

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
          marginTop: 'clamp(10px, 3vmin, 18px)',
          fontSize: 'clamp(10px, 2.6vmin, 12.5px)',
          color: 'rgba(255,255,255,0.62)', letterSpacing: '0.02em',
        }}>
          {new Date(targetIso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}
        </div>
      </div>
    </>
  );
}
