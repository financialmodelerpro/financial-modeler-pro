/**
 * payments/coupons.ts (SERVER ONLY)
 *
 * Discounts, AUTO-LINKED to Paddle (single source of truth). Paddle OWNS every
 * discount and all of its rules (percentage/amount, checkout code, expiry,
 * redemption limit, product scope, status). The platform reads the live discount
 * list from Paddle's API and REFERENCES it, it never re-enters or duplicates the
 * discount data.
 *
 * The ONLY thing stored locally is the admin's CHOICE of which Paddle discount is
 * the active PUBLIC auto-apply promo (a discount id + an optional display label),
 * kept in cms_content (no migration, no duplicated discount data). Everything else
 * comes from Paddle live (cached briefly to avoid hammering the API).
 *
 * This module makes NO entitlement decisions and never writes plan/gate state: a
 * discount affects PRICE only. All calls are server-side (the API key never
 * leaves the server). Degrades to "no promo / code not found" when Paddle is not
 * configured or unreachable.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPaymentSettings, providerConfigFrom } from './config';
import { listDiscounts, type PaddleDiscount } from './paddleApi';

const PLATFORM_DEFAULT = 'real-estate';

// ── Public promo choice (the ONLY local storage): cms_content ───────────────
const PROMO_SECTION = 'payments';
const promoKey = (platform: string): string => `public_promo:${platform}`;

export interface FeaturedPromo {
  discountId: string;
  label: string | null;
}

export interface PublicPromo {
  code: string;                 // the discount's checkout code ("" when code-less)
  label: string;                // marketing label (admin override or Paddle description)
  discountType: 'percentage' | 'fixed';
  discountValue: number;        // percent (e.g. 20) or major-unit amount for fixed
  /** The Paddle discount id passed to checkout. Always present (a promo with no
   *  live Paddle discount is never returned). */
  paddleDiscountId: string;
}

export type CouponResolution =
  | { ok: true; paddleDiscountId: string; label: string; code: string }
  | { ok: false; reason: string };

// ── Live Paddle discount list, cached briefly (server-side) ─────────────────
interface CacheEntry { at: number; discounts: PaddleDiscount[] }
const discountCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60s: discounts change rarely; keeps marketing-page loads cheap

/** Load the account's ACTIVE Paddle discounts for a platform, cached for 60s.
 *  Empty when Paddle is not the active provider / has no API key / is unreachable
 *  (degrades gracefully; falls back to a stale cache entry on a transient error). */
async function loadDiscounts(sb: SupabaseClient, platform: string): Promise<PaddleDiscount[]> {
  const settings = await loadPaymentSettings(sb, platform).catch(() => null);
  if (!settings) return [];
  const cfg = providerConfigFrom(settings, 'paddle');
  if (settings.active_provider !== 'paddle' || !cfg.apiKey) return [];
  const key = `${platform}:${cfg.sandbox ? 'sb' : 'live'}`;
  const now = Date.now();
  const hit = discountCache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.discounts;
  const res = await listDiscounts(cfg, { status: 'active' });
  if (!res.ok) return hit?.discounts ?? []; // transient error: serve stale, else empty
  discountCache.set(key, { at: now, discounts: res.data });
  return res.data;
}

/** Percentage / fixed + numeric value from a Paddle discount (for display). */
function promoAmount(d: PaddleDiscount): { discountType: 'percentage' | 'fixed'; discountValue: number } {
  const v = Number(d.amount);
  if (d.type === 'percentage') return { discountType: 'percentage', discountValue: Number.isFinite(v) ? v : 0 };
  // Flat discounts store minor units; show the major amount (display only).
  return { discountType: 'fixed', discountValue: Number.isFinite(v) ? v / 100 : 0 };
}

/** "20% off" / "USD 50 off" marketing text from a discount. */
function discountText(d: PaddleDiscount): string {
  const { discountType, discountValue } = promoAmount(d);
  if (!discountValue) return 'discount';
  return discountType === 'percentage'
    ? `${discountValue}% off`
    : `${d.currencyCode ? d.currencyCode.toUpperCase() + ' ' : ''}${discountValue} off`;
}

/** A discount is usable at checkout when Paddle marks it active, enabled for
 *  checkout, and it has not hit its own expiry / redemption limit. Paddle is the
 *  authority (it re-checks at checkout); we mirror the obvious cases for a clearer
 *  message and to never feature a spent/expired promo. */
function isLiveDiscount(d: PaddleDiscount): boolean {
  if (d.status !== 'active' || !d.enabledForCheckout) return false;
  if (d.expiresAt && Date.parse(d.expiresAt) <= Date.now()) return false;
  if (d.usageLimit != null && d.timesUsed != null && d.timesUsed >= d.usageLimit) return false;
  return true;
}

// ── cms_content read/write for the featured public promo ────────────────────
export async function getFeaturedPromo(sb: SupabaseClient, platform = PLATFORM_DEFAULT): Promise<FeaturedPromo | null> {
  try {
    const { data } = await sb
      .from('cms_content').select('value')
      .eq('section', PROMO_SECTION).eq('key', promoKey(platform)).maybeSingle();
    const raw = (data as { value?: string | null } | null)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { discountId?: string; label?: string | null };
    if (!parsed.discountId) return null;
    return { discountId: parsed.discountId, label: parsed.label ?? null };
  } catch {
    return null;
  }
}

/** Set (or clear, with null) the featured public promo. Upsert on (section,key). */
export async function setFeaturedPromo(sb: SupabaseClient, platform: string, value: FeaturedPromo | null): Promise<void> {
  const key = promoKey(platform);
  const payload = value ? JSON.stringify({ discountId: value.discountId, label: value.label ?? null }) : '';
  const { data: existing } = await sb
    .from('cms_content').select('id').eq('section', PROMO_SECTION).eq('key', key).maybeSingle();
  if (existing) {
    await sb.from('cms_content').update({ value: payload }).eq('section', PROMO_SECTION).eq('key', key);
  } else {
    await sb.from('cms_content').insert({ section: PROMO_SECTION, key, value: payload });
  }
}

// ── The two functions checkout + pricing already call (signatures unchanged) ─

/**
 * Resolve a customer-entered code to a Paddle discount id for checkout, matching
 * against the LIVE Paddle discount list (auto-linked). Returns a clear reason on
 * failure. Paddle does the final validation at checkout (limits/expiry/scope).
 */
export async function resolveCouponForCheckout(
  sb: SupabaseClient, args: { code: string; platform: string },
): Promise<CouponResolution> {
  const code = (args.code ?? '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'Please enter a coupon code.' };
  const discounts = await loadDiscounts(sb, args.platform);
  if (discounts.length === 0) return { ok: false, reason: 'Coupon codes are not available right now.' };
  const match = discounts.find((d) => (d.code ?? '').trim().toUpperCase() === code);
  if (!match) return { ok: false, reason: 'That coupon code is not valid.' };
  if (!isLiveDiscount(match)) return { ok: false, reason: 'That coupon code has expired or is no longer available.' };
  return { ok: true, paddleDiscountId: match.id, label: match.description?.trim() || discountText(match), code };
}

/**
 * The active PUBLIC auto-apply promo for a platform: the admin's featured Paddle
 * discount, read LIVE from Paddle. Applied at checkout by its id with NO code
 * required. Null when none is featured or the featured discount is no longer live
 * in Paddle (so a displayed promo always references a real, active discount).
 */
export async function loadActivePublicPromo(
  sb: SupabaseClient, platform: string,
): Promise<PublicPromo | null> {
  const featured = await getFeaturedPromo(sb, platform);
  if (!featured) return null;
  const discounts = await loadDiscounts(sb, platform);
  const d = discounts.find((x) => x.id === featured.discountId);
  if (!d || !isLiveDiscount(d)) return null;
  const { discountType, discountValue } = promoAmount(d);
  return {
    code: d.code ?? '',
    label: featured.label?.trim() || d.description?.trim() || discountText(d),
    discountType,
    discountValue,
    paddleDiscountId: d.id,
  };
}

// ── Admin view: live Paddle discount list + the current featured choice ──────
export interface AdminDiscountView {
  paddleReady: boolean;
  discounts: PaddleDiscount[];
  featured: FeaturedPromo | null;
}

/** Everything the admin discount screen needs: the live Paddle discount list and
 *  which one is currently the featured public promo. paddleReady is false when
 *  Paddle is not the active provider or has no API key (the UI then explains it). */
export async function loadAdminDiscountView(sb: SupabaseClient, platform = PLATFORM_DEFAULT): Promise<AdminDiscountView> {
  const settings = await loadPaymentSettings(sb, platform).catch(() => null);
  const cfg = settings ? providerConfigFrom(settings, 'paddle') : null;
  const paddleReady = !!cfg?.apiKey && settings?.active_provider === 'paddle';
  const featured = await getFeaturedPromo(sb, platform);
  if (!paddleReady || !cfg) return { paddleReady, discounts: [], featured };
  const res = await listDiscounts(cfg, { status: 'active' });
  return { paddleReady, discounts: res.ok ? res.data : [], featured };
}
