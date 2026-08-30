/**
 * GET /api/cron/subscription-reminders
 *
 * Daily cron that sends the time-based subscription emails at 1 week and 1 day
 * before the relevant date:
 *   - trial ending (users.trial_ends_at)
 *   - auto-renewal charge notice (auto-renewing Paddle subs, current_period_end)
 *   - ending-plan expiry notice (manual expires_at + canceled Paddle period end)
 *   - grace started (on the first run after a plan expires)
 *   - grace ending (1 week / 1 day before grace end = expiry + 1 calendar month)
 *   - access-request reminder (a confirmed user with no plan who never filed a
 *     trial request, two days after confirmation, ONCE only)
 *
 * IDEMPOTENT: every send is guarded by the subscription_email_log claim (mig 181),
 * so running the cron more than once a day never double-sends. All Paddle API
 * calls happen server-side inside the scan. Makes NO plan/gate changes.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}, matching the other crons.
 *
 * No em dashes in this file.
 */
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { runSubscriptionReminderScan, runAccessReminderScan } from '@/src/shared/email/subscriptionEmails';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  try {
    const result = await runSubscriptionReminderScan(sb);
    // Access-request reminder: confirmed users who never requested access, two
    // days after confirmation, once only (same idempotent claim mechanism).
    const access = await runAccessReminderScan(sb);
    return Response.json({ ok: true, ...result, ...access });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'scan_failed' }, { status: 500 });
  }
}
