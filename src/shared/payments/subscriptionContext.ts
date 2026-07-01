/**
 * payments/subscriptionContext.ts (SERVER ONLY)
 *
 * Resolves the signed-in user's Paddle context FOR ONE PLATFORM for the
 * subscription-management API routes: the server-side provider config (with the
 * secret API key, per-platform via payment_settings) plus the Paddle
 * subscription / customer ids stored for that platform (mig 177
 * user_platform_subscriptions). One place so every billing route loads it the
 * same way. Never returns a secret to a caller that forwards it to the client
 * (routes only forward normalized data).
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPaymentSettings, providerConfigFrom, loadPlatformSubscriptionRow } from './config';
import type { ProviderConfig } from './types';

export const DEFAULT_PAYMENTS_PLATFORM = 'real-estate';

/** A deferred (next-cycle) downgrade stored on the per-platform row (mig 178). */
export interface ScheduledChange {
  planKey: string;
  interval: 'monthly' | 'annual' | null;
  priceId: string;
  effectiveAt: string | null;
}

/** A manual (admin-assigned, offline-paid) subscription's display fields (mig 179). */
export interface ManualSubscription {
  status: string | null;
  startedAt: string | null;
  currentPeriodEnd: string | null;
  expiresAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  note: string | null;
}

export interface UserPaddleContext {
  /** 'ok' = a live Paddle sub + api key; 'manual' = an admin-assigned plan (no
   *  Paddle); otherwise no subscription / not configured. */
  state: 'ok' | 'manual' | 'no_subscription' | 'not_paddle' | 'not_configured';
  platform: string;
  cfg: ProviderConfig;
  source: 'paddle' | 'manual' | null;
  subscriptionId: string | null;
  customerId: string | null;
  /** The plan key stored for this platform (mig 177), for display + change-plan. */
  planKey: string | null;
  /** Manual-plan display fields (mig 179) when source is manual. */
  manual: ManualSubscription | null;
  /** A pending deferred downgrade (mig 178), or null. */
  scheduled: ScheduledChange | null;
}

/**
 * Load the user's Paddle context for a platform. Reads the per-platform store
 * (mig 177) first; for real-estate it falls back to the global columns (mig 176)
 * so a user backfilled or stored only globally still resolves. Schema-tolerant:
 * a missing table / column degrades to the no-subscription state, never an error.
 */
export async function loadUserPaddleContext(
  sb: SupabaseClient, userId: string, platform = DEFAULT_PAYMENTS_PLATFORM,
): Promise<UserPaddleContext> {
  const settings = await loadPaymentSettings(sb, platform);
  const cfg = providerConfigFrom(settings, 'paddle');

  // Per-platform row (mig 177 + 179), schema-tolerant. Carries the plan + source
  // + (for manual) the dates/amount.
  const row = await loadPlatformSubscriptionRow(sb, userId, platform);
  let subscriptionId: string | null = row?.paddle_subscription_id ?? null;
  let customerId: string | null = row?.paddle_customer_id ?? null;
  let planKey: string | null = row?.plan_key ?? null;
  const source: 'paddle' | 'manual' | null = row?.source ?? null;
  const manual: ManualSubscription | null = row && row.source === 'manual'
    ? { status: row.status, startedAt: row.started_at, currentPeriodEnd: row.current_period_end, expiresAt: row.expires_at, amountMinor: row.amount_minor, currency: row.currency, note: row.note }
    : null;

  // Global fallback for the original single platform (mig 176), so a user stored
  // only globally (or before the per-platform backfill) still resolves.
  if (!subscriptionId && source !== 'manual' && platform === DEFAULT_PAYMENTS_PLATFORM) {
    try {
      const { data } = await sb
        .from('users')
        .select('paddle_subscription_id, paddle_customer_id, subscription_plan')
        .eq('id', userId)
        .maybeSingle();
      const row = data as { paddle_subscription_id?: string | null; paddle_customer_id?: string | null; subscription_plan?: string | null } | null;
      subscriptionId = row?.paddle_subscription_id ?? null;
      customerId = row?.paddle_customer_id ?? null;
      planKey = planKey ?? row?.subscription_plan ?? null;
    } catch {
      // columns absent pre mig 176: treat as no subscription on record.
    }
  }

  // Pending deferred downgrade (mig 178). Separate query so a pre-migration
  // schema (columns absent) degrades to "no schedule" without breaking the read.
  let scheduled: ScheduledChange | null = null;
  if (subscriptionId) {
    try {
      const { data } = await sb
        .from('user_platform_subscriptions')
        .select('scheduled_plan_key, scheduled_interval, scheduled_price_id, scheduled_effective_at')
        .eq('user_id', userId)
        .eq('platform_slug', platform)
        .maybeSingle();
      const row = data as { scheduled_plan_key?: string | null; scheduled_interval?: string | null; scheduled_price_id?: string | null; scheduled_effective_at?: string | null } | null;
      if (row?.scheduled_plan_key && row.scheduled_price_id) {
        const iv = row.scheduled_interval;
        scheduled = {
          planKey: row.scheduled_plan_key,
          interval: iv === 'annual' || iv === 'monthly' ? iv : null,
          priceId: row.scheduled_price_id,
          effectiveAt: row.scheduled_effective_at ?? null,
        };
      }
    } catch {
      // columns absent pre mig 178: no schedule.
    }
  }

  let state: UserPaddleContext['state'];
  if (source === 'manual' && planKey && !subscriptionId) {
    // Manual (offline) plan: rendered from the local row, no Paddle needed. An
    // ACTIVE Paddle subscription takes precedence: if a Paddle subscription id is
    // present, resolve the live Paddle state even on a row still tagged manual
    // (self-heals a stale manual-over-Paddle row without a data migration).
    state = 'manual';
  } else if (settings.active_provider !== 'paddle') {
    state = 'not_paddle';
  } else if (!cfg.apiKey) {
    state = 'not_configured';
  } else if (!subscriptionId) {
    state = 'no_subscription';
  } else {
    state = 'ok';
  }

  return { state, platform, cfg, source, subscriptionId, customerId, planKey, manual, scheduled };
}
