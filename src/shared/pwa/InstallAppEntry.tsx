'use client';

/**
 * The two install entry points in each hub's dashboard (2026-11-11), and the
 * iPhone and iPad steps they open:
 *
 *   InstallAppSidebarItem  "Install app" in the sidebar. The hub draws it in
 *                          its own sidebar style (renderItem); this decides
 *                          whether it shows and what a click does.
 *   InstallAppBanner       "Install the <Hub> app for quicker access", with
 *                          Install and a close button. A close is remembered
 *                          per user in this browser (bannerDismissKey).
 *
 * Both show only when an install is possible (useInstallMode: the browser's
 * prompt is ready, or an iPhone or iPad), never inside the installed app, and
 * both carry data-pwa-hide as a second guard. On Chrome, Edge and Android the
 * click opens the browser's own install prompt; on iOS it opens the steps.
 *
 * No em dashes in this file.
 */
import React, { useEffect, useState } from 'react';
import { useInstallMode, promptInstall } from './installPrompt';
import { bannerDismissKey, installBannerText, type InstallApp } from './installApps';

const NAVY = '#0D2E5A';

/** What a click on either entry point does. */
function useInstallAction(): { mode: ReturnType<typeof useInstallMode>; open: () => void; steps: boolean; closeSteps: () => void } {
  const mode = useInstallMode();
  const [steps, setSteps] = useState(false);
  const open = (): void => {
    if (mode === 'ios') { setSteps(true); return; }
    if (mode === 'prompt') void promptInstall();
  };
  return { mode, open, steps, closeSteps: () => setSteps(false) };
}

export function IosInstallSteps({ app, onClose }: { app: InstallApp; onClose: () => void }): React.JSX.Element {
  return (
    <div role="dialog" aria-modal="true" aria-label={`Install the ${app.label} app`} data-testid="install-ios-steps" data-pwa-hide
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100001, background: 'rgba(13,46,90,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, maxWidth: 420, width: '100%', padding: '18px 20px 16px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', fontFamily: "'Inter', sans-serif", color: '#1F2937' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 10 }}>Install the {app.label} app</div>
        {/* Numbers written out: the site's global styles remove list markers. */}
        <div style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.6, display: 'grid', gap: 6 }}>
          <div><strong>1.</strong> In Safari, tap the <strong>Share</strong> button (the square with an arrow).</div>
          <div><strong>2.</strong> Scroll down and tap <strong>Add to Home Screen</strong>.</div>
          <div><strong>3.</strong> Tap <strong>Add</strong>. The app opens from your home screen.</div>
        </div>
        <button type="button" onClick={onClose}
          style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: NAVY, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          Got it
        </button>
      </div>
    </div>
  );
}

export function InstallAppSidebarItem({ app, renderItem }: {
  app: InstallApp;
  renderItem: (p: { label: string; onClick: () => void }) => React.ReactNode;
}): React.JSX.Element | null {
  const { mode, open, steps, closeSteps } = useInstallAction();
  if (mode === 'none') return null;
  return (
    <span data-pwa-hide data-testid={`install-app-sidebar-${app.key}`} style={{ display: 'contents' }}>
      {renderItem({ label: 'Install app', onClick: open })}
      {steps && <IosInstallSteps app={app} onClose={closeSteps} />}
    </span>
  );
}

export function InstallAppBanner({ app, userKey }: { app: InstallApp; userKey: string }): React.JSX.Element | null {
  const { mode, open, steps, closeSteps } = useInstallAction();
  const key = bannerDismissKey(app, userKey);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      try { setDismissed(localStorage.getItem(key) === '1'); } catch { setDismissed(false); }
    }, 0);
    return () => clearTimeout(t);
  }, [key]);
  if (mode === 'none' || dismissed) return null;
  const dismiss = (): void => {
    setDismissed(true);
    try { localStorage.setItem(key, '1'); } catch { /* remembered for this page only */ }
  };
  return (
    <div data-pwa-hide data-testid={`install-app-banner-${app.key}`} role="region" aria-label="Install the app"
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#EEF4FB', border: '1px solid #C9DAF0', borderRadius: 10, padding: '10px 38px 10px 14px', margin: '0 0 16px', fontFamily: "'Inter', sans-serif" }}>
      <span style={{ fontSize: 18 }} aria-hidden="true">📲</span>
      <span style={{ flex: 1, minWidth: 180, fontSize: 13.5, fontWeight: 600, color: NAVY }}>{installBannerText(app)}</span>
      <button type="button" onClick={open} data-testid={`install-app-banner-${app.key}-install`}
        style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: NAVY, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
        Install
      </button>
      <button type="button" onClick={dismiss} aria-label="Dismiss" data-testid={`install-app-banner-${app.key}-dismiss`}
        style={{ position: 'absolute', top: 6, right: 8, background: 'transparent', border: 'none', color: '#6B7280', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '2px 4px' }}>
        ×
      </button>
      {steps && <IosInstallSteps app={app} onClose={closeSteps} />}
    </div>
  );
}
