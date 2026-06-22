import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadMergedFeatures } from '@/src/shared/entitlements/serverCatalog';
import { resolveTrialDays } from '@/src/shared/entitlements/trialConfig';

// Per-user entitlement override data source (Phase C). Reads the LIVE
// entitlement tables (features_registry + live module registry, plan_permissions
// for the user's plan, and the user's user_permissions overrides). Writes
// user_permissions only. This is ADMIN UI + writes; it does NOT touch canAccess
// or any gate, module, export, or pricing behavior (enforcement is Phase D).

async function checkAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') return null;
  return session;
}

// ── GET: one user's plan + resolved-data inputs + existing overrides ──────────
export async function GET(req: NextRequest) {
  if (!await checkAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = req.nextUrl.searchParams.get('userId');
  const platform = req.nextUrl.searchParams.get('platform') || 'real-estate';
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  const sb = getServerClient();

  const { data: user, error: uErr } = await sb
    .from('users')
    .select('id, email, name, role, subscription_plan, subscription_status, trial_ends_at')
    .eq('id', userId)
    .single();
  if (uErr || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Same merged module + catalog list the Plan Builder uses.
  const catalog = await loadMergedFeatures(sb, platform);
  if (!catalog.migrationApplied) {
    return NextResponse.json({ migrationApplied: false, user, features: [], permissions: [], overrides: [], trialDays: 0 }, { status: 200 });
  }

  // Plan coverage for THIS user's plan key. user.subscription_plan is used as
  // the plan_key; if it is not an entitlement plan, no rows come back and the
  // baseline is "nothing included" (overrides still apply on top).
  const planKey = user.subscription_plan ?? '';
  const { data: permissions } = planKey
    ? await sb.from('plan_permissions').select('plan_key, feature_key, included, limit_value').eq('plan_key', planKey)
    : { data: [] as unknown[] };

  const { data: overrides } = await sb
    .from('user_permissions')
    .select('feature_key, mode, override_value, reason, expires_at, created_at')
    .eq('user_id', userId);

  const trialDays = await resolveTrialDays(sb, platform);

  return NextResponse.json({
    migrationApplied: true,
    user,
    features: catalog.features,
    permissions: permissions ?? [],
    overrides: overrides ?? [],
    trialDays,
  });
}

// ── POST: grant or revoke a single feature for a user (upsert override) ───────
export async function POST(req: NextRequest) {
  const session = await checkAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as {
      user_id: string;
      feature_key: string;
      mode: 'grant' | 'revoke';
      override_value?: number | null;
      reason?: string | null;
      expires_at?: string | null;
    };
    const { user_id, feature_key, mode } = body;
    if (!user_id || !feature_key) return NextResponse.json({ error: 'user_id and feature_key required' }, { status: 400 });
    if (mode !== 'grant' && mode !== 'revoke') return NextResponse.json({ error: 'mode must be grant or revoke' }, { status: 400 });

    const ov = body.override_value;
    const adminId = (session.user as { id?: string }).id ?? null;
    const sb = getServerClient();

    const { error } = await sb.from('user_permissions').upsert({
      user_id,
      feature_key,
      mode,
      override_value: ov === null || ov === undefined || Number.isNaN(ov) ? null : Number(ov),
      reason: body.reason?.trim() ? body.reason.trim() : null,
      expires_at: body.expires_at ? new Date(body.expires_at).toISOString() : null,
      created_by: adminId,
    }, { onConflict: 'user_id,feature_key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save override' }, { status: 500 });
  }
}

// ── DELETE: remove a single override ──────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!await checkAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    const featureKey = req.nextUrl.searchParams.get('featureKey');
    if (!userId || !featureKey) return NextResponse.json({ error: 'userId and featureKey required' }, { status: 400 });
    const sb = getServerClient();
    const { error } = await sb.from('user_permissions').delete().eq('user_id', userId).eq('feature_key', featureKey);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete override' }, { status: 500 });
  }
}
