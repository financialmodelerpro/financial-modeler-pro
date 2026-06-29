/**
 * payments/manualConversion.ts (SERVER ONLY)
 *
 * Applies a scheduled convert-to-manual (mig 180). Shared by BOTH the
 * subscription.canceled webhook (the primary trigger, firing at the Paddle
 * period end) and the apply-scheduled-changes cron (a backstop). Reuses
 * setUserPlan (the single plan path) so no plan logic is duplicated; logs the
 * manual payment to the revenue ledger; then clears the schedule.
 *
 * Kept in its own module (not config.ts) because it imports setUserPlan, and
 * setUserPlan imports config: this avoids an import cycle.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { setUserPlan } from '@/src/shared/entitlements/setUserPlan';
import {
  type ScheduledManualConversion,
  recordPaymentTransaction,
  clearScheduledManualConversion,
} from './config';

/**
 * Apply a pending convert-to-manual: set the user's plan to the manual plan
 * (source manual, with start/expiry/amount), log the manual payment, and clear
 * the schedule. Returns true on success.
 */
export async function applyScheduledManualConversion(
  sb: SupabaseClient, userId: string, platform: string, conv: ScheduledManualConversion,
): Promise<boolean> {
  const startedAt = new Date().toISOString();
  const res = await setUserPlan(sb, userId, conv.planKey, {
    platform,
    subscription: {
      source: 'manual',
      startedAt,
      expiresAt: conv.expiresAt,
      amountMinor: conv.amountMinor,
      currency: conv.currency,
      note: conv.note,
    },
  });
  if (!res.ok) return false;

  if (conv.amountMinor && conv.amountMinor > 0) {
    await recordPaymentTransaction(sb, {
      source: 'manual', externalId: null, userId, platform, planKey: conv.planKey,
      amountMinor: conv.amountMinor, currency: conv.currency, status: 'manual', billedAt: startedAt,
    });
  }
  await clearScheduledManualConversion(sb, userId, platform);
  return true;
}
