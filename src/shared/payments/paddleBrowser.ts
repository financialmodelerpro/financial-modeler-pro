/**
 * payments/paddleBrowser.ts (client)
 *
 * Loads Paddle.js (Paddle Billing) on demand and opens the hosted overlay
 * checkout. Driven entirely by the 'open_overlay' result the checkout API
 * returns, so the only Paddle value that reaches the browser is the publishable
 * client-side token (never a secret).
 *
 * Sandbox: when `sandbox` is true we call Paddle.Environment.set('sandbox')
 * BEFORE Initialize, so all calls hit Paddle's sandbox. Live endpoints are only
 * used when sandbox is false (not used now).
 *
 * No em dashes in this file.
 */

import { paddleEnvMismatch } from './paddleEnv';

interface PaddleCheckoutOpen {
  items: { priceId: string; quantity: number }[];
  customer?: { email: string };
  customData?: Record<string, string>;
  settings?: { displayMode?: 'overlay' | 'inline' };
}
/** Shape of the events Paddle.js delivers to Initialize's eventCallback. The
 *  fields vary by Paddle version, so every field is optional and read defensively. */
interface PaddleEvent {
  name?: string;
  type?: string;
  error?: { detail?: string; message?: string; code?: string } | string;
  detail?: { detail?: string; message?: string } | string;
  data?: unknown;
}
interface PaddleGlobal {
  Environment?: { set: (env: 'sandbox' | 'production') => void };
  Initialize: (opts: { token: string; eventCallback?: (e: PaddleEvent) => void }) => void;
  Checkout: { open: (opts: PaddleCheckoutOpen) => void };
}
declare global {
  interface Window { Paddle?: PaddleGlobal }
}

const PADDLE_JS_SRC = 'https://cdn.paddle.com/paddle/v2/paddle.js';

function loadPaddleScript(): Promise<PaddleGlobal> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('not in browser')); return; }
    if (window.Paddle) { resolve(window.Paddle); return; }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PADDLE_JS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js failed to load')));
      existing.addEventListener('error', () => reject(new Error('Paddle.js failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = PADDLE_JS_SRC;
    s.async = true;
    s.onload = () => window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle.js failed to load'));
    s.onerror = () => reject(new Error('Paddle.js failed to load'));
    document.head.appendChild(s);
  });
}

// One initialization per token+environment, so reopening checkout is cheap.
let initializedFor: string | null = null;

// The currently open checkout's promise hooks. Initialize's eventCallback is
// registered once and persists, so it routes lifecycle events (loaded / error /
// closed) to whichever checkout is open right now.
let pendingResolve: (() => void) | null = null;
let pendingReject: ((e: Error) => void) | null = null;

/** Pull a human message out of a Paddle error event, with a clear fallback that
 *  names the two most common causes (unknown price id / environment mismatch). */
function paddleErrorMessage(e: PaddleEvent): string {
  const pick = (v: PaddleEvent['error'] | PaddleEvent['detail']): string | undefined => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v.detail ?? v.message;
    return undefined;
  };
  const msg = pick(e.error) ?? pick(e.detail);
  if (msg && msg.trim()) return `Paddle checkout error: ${msg}`;
  return 'Paddle could not open this checkout. The price may not exist in this Paddle '
    + 'environment, or the sandbox/live setting may not match the configured token.';
}

function settleClear(): void { pendingResolve = null; pendingReject = null; }

export interface OpenPaddleArgs {
  clientToken: string;
  priceId: string;
  sandbox: boolean;
  email?: string | null;
  customData?: Record<string, string>;
}

/**
 * Load Paddle.js, initialize (sandbox-aware), and open the overlay checkout.
 *
 * The returned promise now tracks the REAL checkout lifecycle via Initialize's
 * eventCallback instead of resolving blindly after calling open():
 *  - resolves on `checkout.loaded` / `checkout.completed` (overlay is up), and
 *  - REJECTS on `checkout.error` with the actual Paddle message, so an in-overlay
 *    failure surfaces a specific error instead of Paddle's generic dialog.
 * A preflight environment-mismatch guard rejects before opening at all.
 */
export async function openPaddleCheckout(args: OpenPaddleArgs): Promise<void> {
  // Preflight: a token whose environment does not match the sandbox flag opens
  // the overlay then fails generically. Surface it clearly up front.
  const mismatch = paddleEnvMismatch(args.clientToken, args.sandbox);
  if (mismatch) throw new Error(mismatch);

  const Paddle = await loadPaddleScript();
  const initKey = `${args.sandbox ? 'sandbox' : 'production'}:${args.clientToken}`;
  if (initializedFor !== initKey) {
    if (args.sandbox && Paddle.Environment?.set) Paddle.Environment.set('sandbox');
    Paddle.Initialize({
      token: args.clientToken,
      eventCallback: (e: PaddleEvent) => {
        const name = (e?.name ?? e?.type ?? '').toString();
        if (name === 'checkout.error') {
          pendingReject?.(new Error(paddleErrorMessage(e)));
          settleClear();
        } else if (name === 'checkout.loaded' || name === 'checkout.completed') {
          pendingResolve?.();
          settleClear();
        } else if (name === 'checkout.closed') {
          // User closed the overlay before completing: nothing to surface.
          settleClear();
        }
      },
    });
    initializedFor = initKey;
  }

  return new Promise<void>((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
    try {
      Paddle.Checkout.open({
        items: [{ priceId: args.priceId, quantity: 1 }],
        customer: args.email ? { email: args.email } : undefined,
        customData: args.customData,
        settings: { displayMode: 'overlay' },
      });
    } catch (err) {
      settleClear();
      reject(err instanceof Error ? err : new Error('Could not open Paddle checkout.'));
      return;
    }
    // Safety net: if neither loaded nor error arrives (e.g. blocked network), do
    // not hang the caller's spinner forever. The overlay is visually open by now.
    setTimeout(() => { if (pendingResolve === resolve) { resolve(); settleClear(); } }, 8000);
  });
}
