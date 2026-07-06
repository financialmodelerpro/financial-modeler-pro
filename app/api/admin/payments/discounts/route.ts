import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadAdminDiscountView, setFeaturedPromo } from '@/src/shared/payments/coupons';

// Admin discounts screen backend. Discounts are AUTO-LINKED to Paddle (single
// source of truth): this route reads the live Paddle discount list server-side
// (the API key never reaches the client) and lets the admin choose which one is
// the featured PUBLIC auto-apply promo. The only thing stored locally is that
// choice (a discount id + optional label, in cms_content). No discount data is
// duplicated. Makes NO plan/gate change (a discount affects price only).
//
//   GET  ?platform=<slug>  -> { paddleReady, discounts[], featured }
//   POST { platform?, discountId | null, label? } -> set/clear the public promo

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!session?.user && (session.user as { role?: string }).role === 'admin';
}

const DEFAULT_PLATFORM = 'real-estate';

export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const platform = req.nextUrl.searchParams.get('platform') || DEFAULT_PLATFORM;
  const sb = getServerClient();
  const view = await loadAdminDiscountView(sb, platform);
  return NextResponse.json(view);
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as { platform?: string; discountId?: string | null; label?: string | null };
    const platform = (body.platform ?? DEFAULT_PLATFORM).trim().toLowerCase();
    const sb = getServerClient();
    const discountId = (body.discountId ?? '').toString().trim();
    // Empty / null discountId clears the featured public promo.
    await setFeaturedPromo(sb, platform, discountId ? { discountId, label: body.label?.toString().trim() || null } : null);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update featured promo' }, { status: 500 });
  }
}
