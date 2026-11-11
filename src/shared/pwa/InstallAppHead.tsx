'use client';

/**
 * InstallAppHead (2026-11-11): makes a page installable, and ONLY when it may
 * be (installApps.offersInstall: signed in to this hub, on one of its
 * signed-in pages). Then, and only then, it adds to <head>:
 *   - the manifest link (what Chrome, Edge and Android install from);
 *   - the iOS home-screen tags (capable, title, touch icon);
 * and registers the hub's service worker on its own host.
 *
 * When the page stops qualifying (signed out, or a client-side move to a
 * public page) the tags are removed again, so a page never keeps offering an
 * install it should not. Nothing is in the server HTML, so a public page, a
 * sign-in page or a signed-out visit offers no install at all.
 *
 * No em dashes in this file.
 */
import { useEffect } from 'react';
import { startInstallCapture } from './installPrompt';
import { swHostAllowed, type InstallApp } from './installApps';

const MARK = 'data-fmp-install';

function addTag(tag: 'link' | 'meta', attrs: Record<string, string>): void {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute(MARK, '');
  document.head.appendChild(el);
}

export function InstallAppHead({ app, enabled }: { app: InstallApp; enabled: boolean }): null {
  useEffect(() => {
    if (!enabled) return;
    // Listen BEFORE the manifest appears: the browser's install event follows it.
    startInstallCapture();
    addTag('link', { rel: 'manifest', href: app.manifestHref });
    addTag('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    addTag('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    addTag('meta', { name: 'apple-mobile-web-app-title', content: app.label });
    addTag('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
    addTag('link', { rel: 'apple-touch-icon', href: app.appleTouchIcon });
    if ('serviceWorker' in navigator && swHostAllowed(app, window.location.hostname)) {
      navigator.serviceWorker.register(app.swPath, { scope: '/' }).catch(() => {
        // Registration failing costs the install prompt, nothing else.
      });
    }
    return () => { document.head.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove()); };
  }, [app, enabled]);
  return null;
}
