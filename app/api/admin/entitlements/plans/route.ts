import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

// Plan CRUD for the admin plan builder. Writes entitlement_plans only (plan
// metadata). Does NOT touch prices or the marketing pricing tables.

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user && (session.user as { role?: string }).role === 'admin';
}

// Create a plan. plan_key must be globally unique (plan_permissions is keyed by
// plan_key), enforced by the UNIQUE(platform_slug, plan_key) constraint plus a
// pre-check across platforms.
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { platform_slug = 'real-estate', plan_key, label, display_order } = await req.json();
    const key = String(plan_key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key) return NextResponse.json({ error: 'plan_key required' }, { status: 400 });
    if (!label) return NextResponse.json({ error: 'label required' }, { status: 400 });
    const sb = getServerClient();

    const { data: existing } = await sb.from('entitlement_plans').select('id').eq('plan_key', key).maybeSingle();
    if (existing) return NextResponse.json({ error: `plan_key "${key}" already exists` }, { status: 409 });

    const { error } = await sb.from('entitlement_plans').insert({
      platform_slug, plan_key: key, label, display_order: Number(display_order) || 0,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, plan_key: key });
  } catch {
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 });
  }
}

// Update a plan: rename (label), activate/deactivate (active), reorder
// (display_order). plan_key is immutable (it links plan_permissions rows).
export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, label, active, display_order } = await req.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (label !== undefined) updates.label = label;
    if (active !== undefined) updates.active = active;
    if (display_order !== undefined) updates.display_order = display_order;
    const sb = getServerClient();
    const { error } = await sb.from('entitlement_plans').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}
