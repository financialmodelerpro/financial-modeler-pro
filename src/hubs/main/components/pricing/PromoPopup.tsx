'use client';

/**
 * PromoPopup.tsx (client)
 *
 * A FLOATING, dismissible promo popup for the active public promo. Rendered by the
 * server PromoBanner (which fetches the promo). It is position:fixed, so it does
 * NOT take layout space and never cuts / whitens the hero the way an in-flow
 * banner did. Dismissal is remembered per promo code in localStorage, so closing
 * it does not nag the user, while a NEW promo (new code) shows again.
 *
 * No em dashes in this file.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const GOLD = '#C9A84C';
const GOLD_DARK = '#92400E';
const GOLD_LIGHT = '#FDF6E3';
const NAVY = '#0D2E5A';

// Show the promo popup on PUBLIC MARKETING pages only. Hidden on:
//  - /pricing (the pricing page already shows the offer in the plan cards), and
//  - app / admin / training / auth surfaces (a marketing promo does not belong on
//    the workspace, admin panel, dashboard, sign-in, etc.).
// Marketing pages (home, about, articles, contact, ...) are NOT in this list, so
// the popup shows there.
const HIDE_ON_PREFIXES = [
  '/pricing', '/admin', '/dashboard', '/refm', '/modeling', '/modeling-hub',
  '/training', '/settings', '/account', '/choose-plan',
  '/signin', '/register', '/login', '/forgot', '/set-password', '/confirm-email', '/verify',
];

export default function PromoPopup({
  code, label, offText, href,
}: { code: string; label: string; offText: string; href: string }) {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const storageKey = `fmp_promo_dismissed:${code || 'promo'}`;

  // Show only after mount (avoids SSR flash), only on a public marketing page, and
  // only if not previously dismissed for THIS promo code. Re-evaluates on client
  // navigation (pathname dep), so it hides when moving into an excluded surface.
  useEffect(() => {
    const path = pathname || '/';
    const hidden = HIDE_ON_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
    if (hidden) { setVisible(false); return; }
    try {
      if (localStorage.getItem(storageKey) !== '1') setVisible(true);
    } catch {
      setVisible(true);
    }
  }, [storageKey, pathname]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
  };

  return (
    <div
      data-testid="site-promo-banner"
      role="dialog"
      aria-label="Promotional offer"
      style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 600,
        maxWidth: 340, width: 'calc(100% - 40px)',
        background: GOLD_LIGHT, border: `1.5px solid ${GOLD}`, borderRadius: 14,
        boxShadow: '0 16px 40px -12px rgba(146,64,14,0.45)',
        padding: '16px 18px 16px', color: GOLD_DARK,
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss offer"
        data-testid="promo-dismiss"
        style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 'none', color: GOLD_DARK, fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4, opacity: 0.7 }}
      >
        &times;
      </button>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.85, marginBottom: 4 }}>
        Limited time offer
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, lineHeight: 1.3, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>
        {offText} <span style={{ fontWeight: 600 }}>applied automatically at checkout.</span>
      </div>
      <Link
        href={href}
        data-testid="promo-see-plans"
        style={{ display: 'inline-block', background: NAVY, color: '#fff', fontWeight: 800, fontSize: 13, padding: '9px 18px', borderRadius: 9, textDecoration: 'none' }}
      >
        See plans
      </Link>
    </div>
  );
}
