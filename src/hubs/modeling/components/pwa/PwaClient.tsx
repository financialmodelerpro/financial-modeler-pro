'use client';

/**
 * PwaClient.tsx (2026-09-24)
 *
 * The Modeling Hub's installable-app client half. Mounted once by each Modeling
 * Hub layout. Three jobs, nothing else:
 *
 *   1. REGISTER the service worker (/sw.js), only on the app host or a local
 *      dev host, so the main site and the Training Hub never get one. The
 *      worker caches the shell only and never an API response (see sw.js).
 *   2. SAY SO WHEN THE CONNECTION DROPS. A page already open keeps what it
 *      rendered, but nothing new can load or save, so a user must not read the
 *      figures on screen as current without knowing. The notice asks them to
 *      check their connection and offers a retry; it never signs them out or
 *      sends them to sign in (the guards check `isOffline` for the same
 *      reason).
 *   3. KEEP THE INSTALLED WINDOW INSIDE THE APP (2026-09-26). Only when running
 *      as the installed app (display-mode standalone, or iOS home screen): a
 *      link to another origin (the main site, the Training Hub) or to the app
 *      host's own marketing pages opens in a normal browser tab, and landing
 *      on a marketing page sends the window to the dashboard. The rule is
 *      `linkTarget` / `isMarketingPath` in lib/pwa/appManifest.ts. In a
 *      browser tab nothing here runs, so the site behaves exactly as before.
 *
 * No em dashes in this file.
 */
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isMarketingPath, linkTarget } from '@/src/hubs/modeling/lib/pwa/appManifest';

const APP_HOST = 'app.financialmodelerpro.com';

/** True when this page is running as the installed app, not in a browser tab. */
function isInstalledWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const modes = ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen'];
  if (modes.some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches)) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export default function PwaClient(): React.JSX.Element | null {
  const [offline, setOffline] = useState(false);
  const pathname = usePathname();

  // A marketing page is never the app's page: the window goes to the dashboard
  // (which sends a signed-out user to sign in).
  useEffect(() => {
    if (isInstalledWindow() && isMarketingPath(window.location.pathname)) window.location.replace('/dashboard');
  }, [pathname]);

  // Links that leave the app open in a browser tab. Capture phase on the
  // document, so it runs before a Next <Link> and its preventDefault stops the
  // client-side navigation.
  useEffect(() => {
    if (!isInstalledWindow()) return;
    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (linkTarget(url, window.location.origin) !== 'browser') return;
      e.preventDefault();
      e.stopPropagation();
      window.open(url.href, '_blank', 'noopener,noreferrer');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    const host = window.location.hostname;
    const allowed = host === APP_HOST || host === 'localhost' || host === '127.0.0.1';
    if (allowed && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Registration failing costs the install prompt, nothing else; the app
        // works exactly as it does in a tab.
      });
    }
    const sync = (): void => setOffline(navigator.onLine === false);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="alert"
      data-testid="pwa-offline-notice"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 100000,
        maxWidth: 560, margin: '0 auto', background: '#1B3A6B', color: '#FFFFFF',
        borderRadius: 10, padding: '12px 16px', boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        display: 'flex', gap: 12, alignItems: 'center', fontSize: 14, lineHeight: 1.45,
      }}
    >
      <span style={{ flex: 1 }}>
        <strong>You&apos;re offline.</strong> Please check your internet connection. Nothing can load or
        save until you&apos;re back, so the figures on screen may not be current.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          background: '#FFFFFF', color: '#1B3A6B', border: 0, borderRadius: 6,
          padding: '6px 12px', fontWeight: 700, cursor: 'pointer', flex: '0 0 auto',
        }}
      >
        Try again
      </button>
    </div>
  );
}
