'use client';

/**
 * installPrompt.ts (2026-11-11): the browser's install prompt, captured ONCE
 * per page and shared by every install entry point (the sidebar item and the
 * banner).
 *
 * `beforeinstallprompt` fires once, when the browser decides the page is
 * installable (here: right after InstallAppHead adds the manifest for a
 * signed-in user). A component mounted later would miss it, so the listener
 * is installed by `startInstallCapture` (InstallAppHead calls it before it
 * adds the manifest) and the event is held here for whoever asks.
 *
 * What an entry point may offer (`installMode`):
 *   'prompt'  the browser can install (Chrome, Edge, Android): our button
 *             calls the browser's own prompt;
 *   'ios'     iPhone or iPad, not already on the home screen: show the short
 *             Add to Home Screen steps (iOS has no prompt API);
 *   'none'    already running as the installed app, already installed this
 *             visit, or a browser that cannot install: show nothing.
 *
 * No em dashes in this file.
 */
import { useEffect, useState } from 'react';
import { isInstalledWindow } from './installedWindow';
import { isIosDevice } from './installApps';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let installedThisVisit = false;
let started = false;
const listeners = new Set<() => void>();
const notify = (): void => { listeners.forEach((l) => l()); };

/** Install the listeners once per page. Safe to call many times. */
export function startInstallCapture(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's own mini-infobar from appearing; our banner and
    // sidebar item offer the same prompt.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installedThisVisit = true;
    deferred = null;
    notify();
  });
}

export type InstallMode = 'prompt' | 'ios' | 'none';

function currentMode(): InstallMode {
  if (typeof window === 'undefined') return 'none';
  if (installedThisVisit || isInstalledWindow()) return 'none';
  if (deferred) return 'prompt';
  if (isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0)) return 'ios';
  return 'none';
}

/** Run the browser's prompt. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  notify();
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  if (choice.outcome === 'accepted') { installedThisVisit = true; notify(); return true; }
  return false;
}

/** The install mode, kept current as the browser's events arrive. */
export function useInstallMode(): InstallMode {
  const [mode, setMode] = useState<InstallMode>('none');
  useEffect(() => {
    startInstallCapture();
    const update = (): void => setMode(currentMode());
    listeners.add(update);
    // Deferred so the first state change is not synchronous inside the effect.
    const t = setTimeout(update, 0);
    return () => { listeners.delete(update); clearTimeout(t); };
  }, []);
  return mode;
}
