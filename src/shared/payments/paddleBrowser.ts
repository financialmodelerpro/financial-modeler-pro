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

interface PaddleCheckoutOpen {
  items: { priceId: string; quantity: number }[];
  customer?: { email: string };
  customData?: Record<string, string>;
  settings?: { displayMode?: 'overlay' | 'inline' };
}
interface PaddleGlobal {
  Environment?: { set: (env: 'sandbox' | 'production') => void };
  Initialize: (opts: { token: string }) => void;
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

export interface OpenPaddleArgs {
  clientToken: string;
  priceId: string;
  sandbox: boolean;
  email?: string | null;
  customData?: Record<string, string>;
}

/** Load Paddle.js, initialize (sandbox-aware), and open the overlay checkout. */
export async function openPaddleCheckout(args: OpenPaddleArgs): Promise<void> {
  const Paddle = await loadPaddleScript();
  const initKey = `${args.sandbox ? 'sandbox' : 'production'}:${args.clientToken}`;
  if (initializedFor !== initKey) {
    if (args.sandbox && Paddle.Environment?.set) Paddle.Environment.set('sandbox');
    Paddle.Initialize({ token: args.clientToken });
    initializedFor = initKey;
  }
  Paddle.Checkout.open({
    items: [{ priceId: args.priceId, quantity: 1 }],
    customer: args.email ? { email: args.email } : undefined,
    customData: args.customData,
    settings: { displayMode: 'overlay' },
  });
}
