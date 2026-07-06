/**
 * payments/coupons.ts (SERVER ONLY)
 *
 * Model 1 coupon resolution: the platform REFERENCES a Paddle discount, it does
 * not compute the discount itself. A coupon reduces the real charge ONLY when it
 * carries a paddle_discount_id (a discount that already exists in Paddle); that
 * id is what gets passed to Paddle.Checkout.open({ discountId }), where Paddle
 * validates + applies it. discount_type / discount_value are marketing TEXT only.
 *
 * This module makes NO entitlement decisions and never writes plan/gate state: a
 * discount affects PRICE only. Reads are schema-tolerant (select '*') so a
 * pre-mig-184 schema degrades to "no promo / code not found" instead of throwing.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublicPromo {
  code: string;
  /** Marketing label, e.g. "Launch offer". Falls back to a "X% off" string. */
  label: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  /** The Paddle discount id passed to checkout. Always present for a returned
   *  promo (a promo with no Paddle id never displays and never auto-applies). */
  paddleDiscountId: string;
}

export type CouponResolution =
  | { ok: true; paddleDiscountId: string; label: string; code: string }
  | { ok: false; reason: string };

interface CouponRow {
  code?: string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
  applicable_platforms?: unknown;
  max_uses?: number | null;
  used_count?: number | null;
  expires_at?: string | null;
  starts_at?: string | null;
  is_active?: boolean | null;
  kind?: string | null;
  display_label?: string | null;
  paddle_discount_id?: string | null;
}

/** "20% off" / "USD 50 off" marketing text from the type + value. */
export function couponDiscountText(type: string | null | undefined, value: number | string | null | undefined): string {
  const v = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!v || !Number.isFinite(v)) return 'discount';
  return type === 'percentage' ? `${v}% off` : `${v} off`;
}

/** Platform scope: an empty / absent applicable_platforms array means "all
 *  platforms"; otherwise the platform must be listed. */
function platformMatches(row: CouponRow, platform: string): boolean {
  const arr = row.applicable_platforms;
  if (!Array.isArray(arr) || arr.length === 0) return true;
  return arr.map((s) => String(s).toLowerCase()).includes(platform.toLowerCase());
}

/** Validity: active, within any start/end window, under any usage cap. */
function withinValidity(row: CouponRow, nowMs: number): boolean {
  if (row.is_active === false) return false;
  if (row.starts_at && Date.parse(row.starts_at) > nowMs) return false;
  if (row.expires_at && Date.parse(row.expires_at) <= nowMs) return false;
  if (row.max_uses != null && (row.used_count ?? 0) >= row.max_uses) return false;
  return true;
}

/**
 * Resolve a customer-entered code to a Paddle discount id for checkout. Returns a
 * clear reason on every failure so the checkout route can surface it verbatim.
 * Requires paddle_discount_id: a code with none is "not fully set up" (it would
 * not reduce the Paddle charge, so we refuse rather than silently charge full).
 */
export async function resolveCouponForCheckout(
  sb: SupabaseClient, args: { code: string; platform: string },
): Promise<CouponResolution> {
  const code = (args.code ?? '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'Please enter a coupon code.' };
  let row: CouponRow | null = null;
  try {
    const { data } = await sb.from('coupon_codes').select('*').eq('code', code).maybeSingle();
    row = (data as CouponRow | null) ?? null;
  } catch {
    return { ok: false, reason: 'Coupon codes are not available right now.' };
  }
  if (!row) return { ok: false, reason: 'That coupon code is not valid.' };
  if (!withinValidity(row, Date.now())) return { ok: false, reason: 'That coupon code has expired or is no longer available.' };
  if (!platformMatches(row, args.platform)) return { ok: false, reason: 'That coupon code does not apply to this platform.' };
  if (!row.paddle_discount_id) {
    // Referenced but not wired to Paddle: it cannot reduce the charge, so do not
    // proceed as if it worked. The admin UI flags this state.
    return { ok: false, reason: 'That coupon is not available for online checkout yet.' };
  }
  const label = row.display_label?.trim() || couponDiscountText(row.discount_type, row.discount_value);
  return { ok: true, paddleDiscountId: row.paddle_discount_id, label, code };
}

/**
 * The active PUBLIC auto-apply promo for a platform (newest active public coupon
 * within its validity window that HAS a paddle_discount_id). Only such a promo is
 * returned, so the marketing display and the auto-apply always reference a real
 * Paddle discount (never a promo that would fail to reduce the charge). Null when
 * none is active. Schema-tolerant: a pre-mig-184 schema returns null.
 */
export async function loadActivePublicPromo(
  sb: SupabaseClient, platform: string,
): Promise<PublicPromo | null> {
  let rows: CouponRow[] = [];
  try {
    const { data } = await sb
      .from('coupon_codes').select('*')
      .eq('kind', 'public').eq('is_active', true)
      .order('created_at', { ascending: false });
    rows = (data as CouponRow[] | null) ?? [];
  } catch {
    return null; // kind column absent (pre mig 184) or table unavailable
  }
  const now = Date.now();
  for (const row of rows) {
    if (!row.paddle_discount_id) continue;           // must reference a real Paddle discount
    if (!withinValidity(row, now)) continue;
    if (!platformMatches(row, platform)) continue;
    const dv = typeof row.discount_value === 'string' ? Number(row.discount_value) : (row.discount_value ?? 0);
    return {
      code: (row.code ?? '').toUpperCase(),
      label: row.display_label?.trim() || couponDiscountText(row.discount_type, dv),
      discountType: row.discount_type === 'fixed' ? 'fixed' : 'percentage',
      discountValue: Number.isFinite(dv) ? Number(dv) : 0,
      paddleDiscountId: row.paddle_discount_id,
    };
  }
  return null;
}
