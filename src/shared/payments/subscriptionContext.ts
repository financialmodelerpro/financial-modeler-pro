/**
 * payments/subscriptionContext.ts (SERVER ONLY)
 *
 * Resolves the signed-in user's Paddle context for the subscription-management
 * API routes: the server-side provider config (with the secret API key) plus the
 * Paddle subscription / customer ids stored on the user (mig 176). One place so
 * every billing route loads it the same way. Never returns a secret to a caller
 * that forwards it to the client (routes only forward normalized data).
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPaymentSettings, providerConfigFrom } from './config';
import type { ProviderConfig } from './types';

export const PAYMENTS_PLATFORM = 'real-estate';

export interface UserPaddleContext {
  /** 'ok' once a paddle subscription id is on record and the api key is set. */
  state: 'ok' | 'no_subscription' | 'not_paddle' | 'not_configured';
  cfg: ProviderConfig;
  subscriptionId: string | null;
  customerId: string | null;
}

/**
 * Load the user's Paddle context. Schema-tolerant: if the id columns are absent
 * (pre mig 176) the select falls back to no ids, so the panel shows the
 * no-subscription state rather than erroring.
 */
export async function loadUserPaddleContext(
  sb: SupabaseClient, userId: string,
): Promise<UserPaddleContext> {
  const settings = await loadPaymentSettings(sb, PAYMENTS_PLATFORM);
  const cfg = providerConfigFrom(settings, 'paddle');

  let subscriptionId: string | null = null;
  let customerId: string | null = null;
  try {
    const { data } = await sb
      .from('users')
      .select('paddle_subscription_id, paddle_customer_id')
      .eq('id', userId)
      .maybeSingle();
    const row = data as { paddle_subscription_id?: string | null; paddle_customer_id?: string | null } | null;
    subscriptionId = row?.paddle_subscription_id ?? null;
    customerId = row?.paddle_customer_id ?? null;
  } catch {
    // columns absent pre-migration: treat as no subscription on record.
  }

  let state: UserPaddleContext['state'];
  if (settings.active_provider !== 'paddle') state = 'not_paddle';
  else if (!cfg.apiKey) state = 'not_configured';
  else if (!subscriptionId) state = 'no_subscription';
  else state = 'ok';

  return { state, cfg, subscriptionId, customerId };
}
