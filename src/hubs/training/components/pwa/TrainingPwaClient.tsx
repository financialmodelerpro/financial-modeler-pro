'use client';

/**
 * TrainingPwaClient (2026-11-11): the Training Hub app's client half, mounted
 * once by the Training Hub layout. The Modeling Hub's PwaClient does the same
 * for its app; the two never meet (different origins, different apps).
 *
 *   1. OFFER THE INSTALL ONLY WHEN SIGNED IN: InstallAppHead adds the manifest,
 *      the iOS home-screen tags and /sw-training.js only for a signed-in
 *      student on a dashboard page (installApps.offersInstall).
 *   2. THE INSTALLED WINDOW: mark <html> (so the hiding CSS also applies on an
 *      iPhone home-screen app), title the window "FMP Training Hub", send the
 *      Training Hub home and Training Sessions listing to the dashboard, and
 *      open links that leave the app (another origin, those public pages) in a
 *      browser tab. Course and session pages stay in the window.
 *   3. The hiding rule (installedAppCss) is rendered with the page, so the
 *      installed window never shows the website header or a data-pwa-hide
 *      element, even for a frame.
 * In a browser tab nothing in 2 runs, so the site behaves exactly as before.
 *
 * No em dashes in this file.
 */
import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { InstallAppHead } from '@/src/shared/pwa/InstallAppHead';
import { INSTALL_APPS, offersInstall } from '@/src/shared/pwa/installApps';
import { installedAppCss, isInstalledWindow, INSTALLED_ATTR } from '@/src/shared/pwa/installedWindow';
import { isTrainingMarketingPath, trainingLinkTarget } from '@/src/shared/pwa/trainingAppManifest';
import { getTrainingSession } from '@/src/hubs/training/lib/session/training-session';

const APP = INSTALL_APPS.training;

export default function TrainingPwaClient(): React.JSX.Element {
  const pathname = usePathname() ?? '/';
  // Signed in to the Training Hub: the student's session (read on the client).
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSignedIn(!!getTrainingSession()), 0);
    return () => clearTimeout(t);
  }, [pathname]);
  const canOffer = offersInstall(APP, pathname, signedIn);

  useEffect(() => {
    if (!isInstalledWindow()) return;
    document.documentElement.setAttribute(INSTALLED_ATTR, '');
    const setTitle = (): void => { if (document.title !== APP.name) document.title = APP.name; };
    setTitle();
    const obs = new MutationObserver(setTitle);
    obs.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, []);

  // A public page is never the app's page: the window goes to the dashboard
  // (which sends a signed-out student to sign in and back).
  useEffect(() => {
    if (isInstalledWindow() && isTrainingMarketingPath(window.location.pathname)) window.location.replace(APP.dashboardPath);
  }, [pathname]);

  // Links that leave the app open in a browser tab (capture phase, before a
  // Next <Link> navigates).
  useEffect(() => {
    if (!isInstalledWindow()) return;
    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (trainingLinkTarget(url, window.location.origin) !== 'browser') return;
      e.preventDefault();
      e.stopPropagation();
      window.open(url.href, '_blank', 'noopener,noreferrer');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return (
    <>
      <style data-installed-app-css dangerouslySetInnerHTML={{ __html: installedAppCss() }} />
      <InstallAppHead app={APP} enabled={canOffer} />
    </>
  );
}
