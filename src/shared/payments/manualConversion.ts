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
import { sendManualPlanWelcomeEmail, issueManualInvoice } from '@/src/shared/email/subscriptionEmails';

/**
 * Apply a pending convert-to-manual: set the user's plan to the manual plan
 * (source manual, with start/expiry/amount), log the manual payment, issue the
 * branded receipt + welcome email (same as the immediate-conversion path so the
 * period-end path is no longer silent), and clear the schedule. Returns true on
 * success.
 *
 * The manual plan begins when the Paddle access ends, so we anchor startedAt to
 * the schedule's effectiveAt (the period end) when present. That also makes the
 * email dedupe key STABLE across the two callers that can fire this (the
 * subscription.canceled webhook AND the apply-scheduled-changes cron backstop),
 * so a race between them never double-sends the welcome or double-issues the
 * receipt (both keyed per-event on this startedAt/amount). Emails are
 * self-contained and never throw, so a send failure cannot block the conversion.
 */
export async function applyScheduledManualConversion(
  sb: SupabaseClient, userId: string, platform: string, conv: ScheduledManualConversion,
): Promise<boolean> {
  const startedAt = conv.effectiveAt ?? new Date().toISOString();
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
    // Branded receipt PDF (stored + emailed + listed in billing). Deduped per
    // event on (startedAt + amount), so the webhook/cron race issues one receipt.
    await issueManualInvoice(sb, {
      userId, platform, planKey: conv.planKey, amountMinor: conv.amountMinor,
      currency: conv.currency, issuedAt: startedAt, periodEnd: conv.expiresAt,
    });
  }
  // Welcome / plan-active email for the now-manual plan (skips none/trial
  // internally; deduped per event on startedAt so the race sends one email).
  await sendManualPlanWelcomeEmail(sb, {
    userId, platform, planKey: res.planKey ?? conv.planKey,
    startedAt, expiresAt: conv.expiresAt,
  });
  await clearScheduledManualConversion(sb, userId, platform);
  return true;
}
