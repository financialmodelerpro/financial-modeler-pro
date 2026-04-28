import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

/** GET - all features for a platform + access rows */
export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const slug = req.nextUrl.searchParams.get('platform') ?? 'real-estate';
  const sb = getServerClient();

  const { data: features } = await sb
    .from('platform_features')
    .select('*')
    .eq('platform_slug', slug)
    .eq('is_active', true)
    .order('display_order');

  const { data: access } = await sb.from('plan_feature_access').select('*');

  return NextResponse.json({ features: features ?? [], access: access ?? [] });
}

/** POST - create new platform feature */
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const sb = getServerClient();
    const { data, error } = await sb.from('platform_features').insert({
      platform_slug: body.platform_slug,
      feature_key: body.feature_key,
      feature_text: body.feature_text,
      feature_category: body.feature_category ?? 'general',
      display_order: body.display_order ?? 99,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-create access rows for all plans of this platform
    const { data: plans } = await sb.from('platform_pricing').select('id').eq('platform_slug', body.platform_slug);
    if (plans?.length && data) {
      await sb.from('plan_feature_access').insert(
        plans.map((p: { id: string }) => ({ plan_id: p.id, feature_id: data.id, is_included: false }))
      );
    }
    return NextResponse.json({ ok: true, feature: data });
  } catch {
    return NextResponse.json({ error: 'Failed to create feature' }, { status: 500 });
  }
}

/** PATCH - bulk update feature access for a plan */
export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { plan_id, updates } = await req.json() as {
      plan_id: string;
      updates: { feature_id: string; is_included: boolean; override_text?: string | null }[];
    };
    const sb = getServerClient();
    for (const u of updates) {
      await sb.from('plan_feature_access').upsert({
        plan_id,
        feature_id: u.feature_id,
        is_included: u.is_included,
        override_text: u.override_text ?? null,
      }, { onConflict: 'plan_id,feature_id' });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update features' }, { status: 500 });
  }
}
