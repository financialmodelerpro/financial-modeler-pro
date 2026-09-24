'use client';

/**
 * PwaClient.tsx (2026-09-24)
 *
 * The Modeling Hub's installable-app client half. Mounted once by each Modeling
 * Hub layout. Two jobs, nothing else:
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
 *
 * No em dashes in this file.
 */
import React, { useEffect, useState } from 'react';

const APP_HOST = 'app.financialmodelerpro.com';

export default function PwaClient(): React.JSX.Element | null {
  const [offline, setOffline] = useState(false);

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
