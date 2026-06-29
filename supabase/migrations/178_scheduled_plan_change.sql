-- ============================================================
--  178_scheduled_plan_change.sql
--  Deferred (next-billing-cycle) DOWNGRADES. A downgrade keeps the user on their
--  current higher plan until the period ends, then moves them to the lower plan
--  at renewal. Paddle Billing has no native scheduled item swap (scheduled_change
--  is only cancel/pause/resume, and every proration mode swaps the item
--  immediately), so the deferral is stored app-side here and applied at the
--  effective date by the apply-scheduled-changes route; the subscription.updated
--  webhook then syncs the app plan as built.
--
--  Upgrades stay immediate (prorated now) and clear any pending schedule. These
--  columns are NOT read by the resolver / gate / setUserPlan, so enforcement is
--  unchanged.
--
--  ADDITIVE ONLY: adds four nullable columns to user_platform_subscriptions
--  (mig 177), alters/drops nothing. Idempotent. Apply manually via the Supabase
--  dashboard. No em dashes.
-- ============================================================

ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_plan_key     text;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_interval     text;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_price_id     text;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_effective_at timestamptz;

-- Fast lookup of due schedules for the apply-scheduled-changes worker.
CREATE INDEX IF NOT EXISTS idx_ups_scheduled_effective_at
  ON user_platform_subscriptions (scheduled_effective_at)
  WHERE scheduled_price_id IS NOT NULL;
