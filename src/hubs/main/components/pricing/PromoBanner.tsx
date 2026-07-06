/**
 * PromoBanner.tsx (server component)
 *
 * A thin site-wide banner for the active PUBLIC auto-apply promo, read LIVE from
 * Paddle (loadActivePublicPromo, server-side). Used on the main marketing site so
 * the promo shows there too, not only on the pricing page (where LivePlanCards
 * already renders it). Renders nothing when no public promo is active, so it is
 * safe to drop in unconditionally. Only the label / percent reach the client; the
 * Paddle discount id stays server-side.
 *
 * No em dashes in this file.
 */
import Link from 'next/link';
import { getServerClient } from '@/src/core/db/supabase';
import { loadActivePublicPromo } from '@/src/shared/payments/coupons';

const GOLD = '#C9A84C';
const GOLD_DARK = '#92400E';
const GOLD_LIGHT = '#FDF6E3';

export default async function PromoBanner({ platform = 'real-estate', pricingHref = '/pricing' }: { platform?: string; pricingHref?: string }) {
  let promo: Awaited<ReturnType<typeof loadActivePublicPromo>> = null;
  try {
    promo = await loadActivePublicPromo(getServerClient(), platform);
  } catch {
    promo = null; // never break the page for a promo lookup
  }
  if (!promo) return null;

  const offText = promo.discountType === 'percentage' && promo.discountValue > 0 ? `${promo.discountValue}% off` : promo.label;

  return (
    <div data-testid="site-promo-banner"
      // position + zIndex 501 so the banner always paints ABOVE the fixed navbar
      // (zIndex 100) and is never clipped under it, regardless of the configured
      // header height / admin edit-bar stack. Stays below the admin bar (9999).
      style={{ position: 'relative', zIndex: 501, background: GOLD_LIGHT, borderBottom: `1px solid ${GOLD}`, color: GOLD_DARK, textAlign: 'center', padding: '10px 20px', fontSize: 14, fontWeight: 700 }}>
      {promo.label}
      <span style={{ fontWeight: 800, marginLeft: 8 }}>{offText}</span>
      <span style={{ fontWeight: 600, marginLeft: 8 }}>applied automatically at checkout.</span>
      <Link href={pricingHref} style={{ marginLeft: 12, color: GOLD_DARK, fontWeight: 800, textDecoration: 'underline' }}>
        See plans
      </Link>
    </div>
  );
}
