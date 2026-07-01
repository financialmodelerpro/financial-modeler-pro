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
import { runSubscriptionReminderScan } from '@/src/shared/email/subscriptionEmails';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  try {
    const result = await runSubscriptionReminderScan(sb);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'scan_failed' }, { status: 500 });
  }
}
