import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const INACTIVITY_MS = 60 * 60 * 1000; // 1 hour

interface Options {
  /** API route to POST for logout - used when onLogout is not provided */
  logoutUrl?: string;
  /** Custom async logout function - takes priority over logoutUrl */
  onLogout?: () => Promise<void>;
  /** Where to navigate after logout */
  redirectUrl: string;
}

/**
 * Auto-signs out the user after INACTIVITY_MS of no interaction.
 * Resets the timer on any mousedown / keydown / scroll / touchstart event.
 */
export function useInactivityLogout({ logoutUrl, onLogout, redirectUrl }: Options) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          if (onLogout) {
            await onLogout();
          } else if (logoutUrl) {
            await fetch(logoutUrl, { method: 'POST' });
          }
        } catch { /* ignore */ }
        router.push(redirectUrl);
      }, INACTIVITY_MS);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset(); // start timer on mount

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [logoutUrl, onLogout, redirectUrl, router]);
}
