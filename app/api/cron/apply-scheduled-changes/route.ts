/**
 * GET /api/cron/apply-scheduled-changes
 *
 * Applies DEFERRED downgrades (mig 178) whose effective date has arrived. For
 * each user_platform_subscriptions row with a scheduled change due now, it
 * swaps the Paddle subscription item to the scheduled (lower) price, then clears
 * the schedule. Paddle then emits subscription.updated and the existing webhook
 * syncs the app plan (the single enforcement path), unchanged.
 *
 * WHY app-side: Paddle Billing has no native scheduled item swap (scheduled_change
 * is only cancel/pause/resume), so a downgrade-at-next-cycle is stored locally on
 * confirm (no charge, user keeps the higher plan) and applied here at renewal.
 *
 * Secured by CRON_SECRET Authorization header (same pattern as the other crons).
 * Wire a daily Vercel cron to this path; it can also be triggered manually with
 * the CRON_SECRET to apply due downgrades on demand (sandbox testing).
 *
 * No em dashes in this file.
 */
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { loadPaymentSettings, providerConfigFrom, clearScheduledChange } from '@/src/shared/payments/config';
import { changeSubscriptionPlan } from '@/src/shared/payments/paddleApi';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface DueRow {
  user_id: string;
  platform_slug: string;
  paddle_subscription_id: string | null;
  scheduled_price_id: string | null;
  scheduled_effective_at: string | null;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const nowIso = new Date().toISOString();

  let rows: DueRow[] = [];
  try {
    const { data, error } = await sb
      .from('user_platform_subscriptions')
      .select('user_id, platform_slug, paddle_subscription_id, scheduled_price_id, scheduled_effective_at')
      .not('scheduled_price_id', 'is', null)
      .lte('scheduled_effective_at', nowIso);
    if (error) return Response.json({ ok: true, applied: 0, note: 'table or columns absent' });
    rows = (data ?? []) as DueRow[];
  } catch {
    return Response.json({ ok: true, applied: 0, note: 'lookup failed' });
  }

  let applied = 0;
  const failures: string[] = [];
  for (const row of rows) {
    if (!row.paddle_subscription_id || !row.scheduled_price_id) continue;
    const settings = await loadPaymentSettings(sb, row.platform_slug);
    const cfg = providerConfigFrom(settings, 'paddle');
    if (settings.active_provider !== 'paddle' || !cfg.apiKey) { failures.push(`${row.user_id}:not_configured`); continue; }

    // At renewal there is no proration; this just moves the item to the lower
    // price. The subscription.updated webhook then syncs the plan.
    const res = await changeSubscriptionPlan(cfg, row.paddle_subscription_id, row.scheduled_price_id);
    if (res.ok) {
      await clearScheduledChange(sb, row.user_id, row.platform_slug);
      applied += 1;
    } else {
      // Leave the schedule in place so a later run retries.
      failures.push(`${row.user_id}:${res.error}`);
    }
  }

  return Response.json({ ok: true, due: rows.length, applied, failures });
}
