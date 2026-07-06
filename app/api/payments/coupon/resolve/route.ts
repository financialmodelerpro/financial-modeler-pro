import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { resolveCouponForCheckout } from '@/src/shared/payments/coupons';

// POST /api/payments/coupon/resolve  body: { code, platform? }
// Immediate validation feedback for the checkout coupon field: resolves a code to
// a Paddle discount reference (Model 1) WITHOUT opening checkout. Returns the
// display label on success or a clear reason on failure. The actual discount is
// applied by Paddle at checkout (the checkout route resolves again server-side,
// the source of truth); this endpoint never charges anything or writes any state.
// Auth-gated so the coupon config is not probed anonymously.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ ok: false, message: 'Please sign in.' }, { status: 401 });
  let code = '';
  let platform = 'real-estate';
  try {
    const body = await req.json() as { code?: string; platform?: string };
    code = String(body.code ?? '').trim();
    if (body.platform) platform = String(body.platform).trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request.' }, { status: 400 });
  }
  const sb = getServerClient();
  const resolved = await resolveCouponForCheckout(sb, { code, platform });
  if (!resolved.ok) return NextResponse.json({ ok: false, message: resolved.reason });
  return NextResponse.json({ ok: true, label: resolved.label, code: resolved.code });
}
