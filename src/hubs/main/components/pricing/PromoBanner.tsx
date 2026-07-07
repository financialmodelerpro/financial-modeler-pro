/**
 * PromoBanner.tsx (server component)
 *
 * Loads the active PUBLIC auto-apply promo LIVE from Paddle (server-side) and, when
 * one is active, renders it as a FLOATING, dismissible popup (PromoPopup). The
 * popup is position:fixed, so it overlays the page WITHOUT taking layout space,
 * i.e. it never cuts / whitens the hero the way an in-flow banner did. Renders
 * nothing when no promo is active, so it is safe to drop in unconditionally. Only
 * the label / percent reach the client; the Paddle discount id stays server-side.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';
import { loadActivePublicPromo } from '@/src/shared/payments/coupons';
import PromoPopup from './PromoPopup';

export default async function PromoBanner({ platform = 'real-estate', pricingHref = '/pricing' }: { platform?: string; pricingHref?: string }) {
  let promo: Awaited<ReturnType<typeof loadActivePublicPromo>> = null;
  try {
    promo = await loadActivePublicPromo(getServerClient(), platform);
  } catch {
    promo = null; // never break the page for a promo lookup
  }
  if (!promo) return null;

  const offText = promo.discountType === 'percentage' && promo.discountValue > 0 ? `${promo.discountValue}% off` : promo.label;

  // Pass the Paddle discount id as the dismissal key so a code-less auto-apply
  // promo has its OWN dismissal memory (not the shared code-less "promo" key). The
  // discount id is client-safe (it already flows to Paddle.Checkout.open).
  return <PromoPopup code={promo.code} label={promo.label} offText={offText} href={pricingHref} dismissKey={promo.paddleDiscountId} />;
}
