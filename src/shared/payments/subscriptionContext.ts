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
import { loadPaymentSettings, providerConfigFrom } from './config';
import type { ProviderConfig } from './types';

export const DEFAULT_PAYMENTS_PLATFORM = 'real-estate';

export interface UserPaddleContext {
  /** 'ok' once a paddle subscription id is on record and the api key is set. */
  state: 'ok' | 'no_subscription' | 'not_paddle' | 'not_configured';
  platform: string;
  cfg: ProviderConfig;
  subscriptionId: string | null;
  customerId: string | null;
  /** The plan key stored for this platform (mig 177), for display + change-plan. */
  planKey: string | null;
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

  let subscriptionId: string | null = null;
  let customerId: string | null = null;
  let planKey: string | null = null;

  // Per-platform store (mig 177).
  try {
    const { data } = await sb
      .from('user_platform_subscriptions')
      .select('paddle_subscription_id, paddle_customer_id, plan_key')
      .eq('user_id', userId)
      .eq('platform_slug', platform)
      .maybeSingle();
    const row = data as { paddle_subscription_id?: string | null; paddle_customer_id?: string | null; plan_key?: string | null } | null;
    subscriptionId = row?.paddle_subscription_id ?? null;
    customerId = row?.paddle_customer_id ?? null;
    planKey = row?.plan_key ?? null;
  } catch {
    // table absent pre mig 177: fall through to the global fallback below.
  }

  // Global fallback for the original single platform (mig 176), so a user stored
  // only globally (or before the per-platform backfill) still resolves.
  if (!subscriptionId && platform === DEFAULT_PAYMENTS_PLATFORM) {
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

  let state: UserPaddleContext['state'];
  if (settings.active_provider !== 'paddle') state = 'not_paddle';
  else if (!cfg.apiKey) state = 'not_configured';
  else if (!subscriptionId) state = 'no_subscription';
  else state = 'ok';

  return { state, platform, cfg, subscriptionId, customerId, planKey };
}
