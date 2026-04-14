import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json() as { code: string };
    if (!code?.trim()) {
      return NextResponse.json({ valid: false, message: 'Please enter a coupon code.' });
    }

    const sb = getServerClient();
    const { data: coupon } = await sb
      .from('coupon_codes')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .eq('is_active', true)
      .maybeSingle();

    if (!coupon) {
      return NextResponse.json({ valid: false, message: 'Invalid coupon code.' });
    }

    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, message: 'This coupon has expired.' });
    }

    // Check max uses
    if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
      return NextResponse.json({ valid: false, message: 'This coupon has reached its usage limit.' });
    }

    const discountText = coupon.discount_type === 'percentage'
      ? `${coupon.discount_value}% off`
      : `$${coupon.discount_value} off`;

    return NextResponse.json({
      valid: true,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      message: `Code applied: ${discountText}`,
    });
  } catch {
    return NextResponse.json({ valid: false, message: 'Failed to validate coupon.' });
  }
}
