import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadMergedFeatures } from '@/src/shared/entitlements/serverCatalog';
import { resolveTrialDays } from '@/src/shared/entitlements/trialConfig';
import { loadPlatformSubscriptionRow, loadPaymentSettings, providerConfigFrom } from '@/src/shared/payments/config';
import { listSubscriptionInvoices, getSubscription } from '@/src/shared/payments/paddleApi';

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

  // company / job_title are mig 172; select them when present, else fall back so
  // the panel still loads pre-migration.
  const USER_BASE = 'id, email, name, role, subscription_plan, subscription_status, trial_ends_at';
  let { data: user, error: uErr } = await sb
    .from('users').select(`${USER_BASE}, company, job_title`).eq('id', userId).single();
  if (uErr && /company|job_title/.test(uErr.message)) {
    ({ data: user, error: uErr } = await sb.from('users').select(USER_BASE).eq('id', userId).single());
  }
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

  // Per-platform subscription row (source, dates, manual amount). Drives the
  // admin "Subscription" card + the revenue summary.
  const subRow = await loadPlatformSubscriptionRow(sb, userId, platform);

  // Subscription dates + revenue. For a Paddle sub, fetch live dates + sum the
  // customer's completed transactions (reconcilable with Paddle). For a manual
  // plan, use the row's dates + amount. All Paddle calls are server-side.
  let subscription: Record<string, unknown> | null = null;
  let revenue = { paddleMinor: 0, manualMinor: 0, currency: null as string | null, totalMinor: 0, paddleTxnCount: 0, reconcilable: false };
  if (subRow) {
    if (subRow.source === 'paddle' && subRow.paddle_subscription_id) {
      const settings = await loadPaymentSettings(sb, platform);
      const cfg = providerConfigFrom(settings, 'paddle');
      if (cfg.apiKey) {
        const det = await getSubscription(cfg, subRow.paddle_subscription_id);
        if (det.ok) {
          subscription = {
            source: 'paddle', planKey: subRow.plan_key, status: det.data.status,
            startedAt: subRow.started_at, currentPeriodEnd: det.data.currentPeriodEndsAt,
            nextBilledAt: det.data.nextBilledAt, expiresAt: null,
            amountMinor: det.data.amountMinor, currency: det.data.currency, interval: det.data.billingInterval,
            // Cancel-at-period-end state (live Paddle), so the panel shows Canceling
            // + the date access ends instead of a bare "active".
            canceled: det.data.canceled, scheduledCancelAt: det.data.scheduledCancelAt,
          };
        }
        const inv = await listSubscriptionInvoices(cfg, subRow.paddle_subscription_id);
        if (inv.ok) {
          let sum = 0; let cur: string | null = null; let n = 0;
          for (const t of inv.data) {
            if ((t.status === 'completed' || t.status === 'paid') && t.amountMinor !== null) { sum += t.amountMinor; cur = cur ?? t.currency; n += 1; }
          }
          revenue = { paddleMinor: sum, manualMinor: 0, currency: cur, totalMinor: sum, paddleTxnCount: n, reconcilable: true };
        }
      }
      if (!subscription) {
        // API key absent / Paddle unreachable: still show what the row knows.
        subscription = { source: 'paddle', planKey: subRow.plan_key, status: subRow.status, startedAt: subRow.started_at, currentPeriodEnd: subRow.current_period_end, nextBilledAt: null, expiresAt: null, amountMinor: subRow.amount_minor, currency: subRow.currency, interval: null };
      }
    } else if (subRow.source === 'manual') {
      subscription = {
        source: 'manual', planKey: subRow.plan_key, status: subRow.status,
        startedAt: subRow.started_at, currentPeriodEnd: subRow.current_period_end,
        nextBilledAt: null, expiresAt: subRow.expires_at,
        amountMinor: subRow.amount_minor, currency: subRow.currency, interval: null, note: subRow.note,
      };
      const m = subRow.amount_minor ?? 0;
      revenue = { paddleMinor: 0, manualMinor: m, currency: subRow.currency, totalMinor: m, paddleTxnCount: 0, reconcilable: false };
    }
  }

  return NextResponse.json({
    migrationApplied: true,
    user,
    features: catalog.features,
    permissions: permissions ?? [],
    overrides: overrides ?? [],
    trialDays,
    subscription,
    revenue,
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
