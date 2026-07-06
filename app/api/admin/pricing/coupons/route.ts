import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  const { data } = await sb.from('coupon_codes').select('*').order('created_at', { ascending: false });
  return NextResponse.json({ coupons: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const sb = getServerClient();
    const { error } = await sb.from('coupon_codes').insert({
      code: (body.code as string).trim().toUpperCase(),
      discount_type: body.discount_type,
      discount_value: body.discount_value,
      applicable_plans: body.applicable_plans ?? [],
      applicable_platforms: body.applicable_platforms ?? [],
      max_uses: body.max_uses ?? null,
      expires_at: body.expires_at ?? null,
      is_active: body.is_active ?? true,
      // Model 1 reference fields (mig 184): the Paddle discount id this code
      // references (required to actually reduce the charge), its kind
      // (public auto-apply / private), an optional label, and a start date.
      paddle_discount_id: (body.paddle_discount_id as string | undefined)?.trim() || null,
      kind: body.kind === 'public' ? 'public' : 'private',
      display_label: (body.display_label as string | undefined)?.trim() || null,
      starts_at: body.starts_at ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to create coupon' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, ...updates } = await req.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const sb = getServerClient();
    const { error } = await sb.from('coupon_codes').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update coupon' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('coupon_codes').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
