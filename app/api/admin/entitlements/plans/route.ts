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
// (display_order), and pricing (price_monthly / price_annual / currency /
// contact_sales). plan_key is immutable (it links plan_permissions rows).
export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, label, active, display_order, price_monthly, price_annual, currency, contact_sales, popular, badge_text, trial_days } = await req.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (label !== undefined) updates.label = label;
    if (active !== undefined) updates.active = active;
    if (display_order !== undefined) updates.display_order = display_order;
    if (popular !== undefined) updates.popular = !!popular;
    if (badge_text !== undefined) updates.badge_text = badge_text === '' || badge_text === null ? null : String(badge_text);
    // Trial length in days (single source). Empty / non-positive coerces to null
    // so resolveTrialDays falls back to the default.
    if (trial_days !== undefined) {
      const n = trial_days === '' || trial_days === null ? null : Number(trial_days);
      updates.trial_days = n !== null && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
    // Prices are nullable (null = unpriced). Empty string / NaN coerces to null.
    const toNum = (v: unknown): number | null =>
      v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
    if (price_monthly !== undefined) updates.price_monthly = toNum(price_monthly);
    if (price_annual !== undefined) updates.price_annual = toNum(price_annual);
    if (currency !== undefined) updates.currency = String(currency || 'SAR').toUpperCase().slice(0, 8);
    if (contact_sales !== undefined) updates.contact_sales = !!contact_sales;
    const sb = getServerClient();
    const { error } = await sb.from('entitlement_plans').update(updates).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}
