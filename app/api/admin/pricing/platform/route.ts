import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = getServerClient();
  const { data } = await sb.from('platform_pricing').select('*').order('platform_slug').order('display_order');
  return NextResponse.json({ plans: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, featureAccess, ...updates } = await req.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const sb = getServerClient();

    // Update plan fields
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await sb.from('platform_pricing').update(updates).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Bulk update feature access
    if (Array.isArray(featureAccess)) {
      for (const fa of featureAccess as { feature_id: string; is_included: boolean; override_text?: string | null }[]) {
        await sb.from('plan_feature_access').upsert({
          plan_id: id,
          feature_id: fa.feature_id,
          is_included: fa.is_included,
          override_text: fa.override_text ?? null,
        }, { onConflict: 'plan_id,feature_id' });
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const sb = getServerClient();
    const { error } = await sb.from('platform_pricing').insert(body);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 });
  }
}
