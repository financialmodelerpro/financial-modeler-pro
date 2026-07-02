-- ============================================================
--  183_scheduled_cancel_at.sql
--  Durable "this subscription is set to cancel" marker on the per-platform store
--  (mig 177). When a user cancels AT PERIOD END (self-service, convert-to-manual
--  period-end, or a cancel scheduled directly in Paddle), the scheduled cancel
--  date is written here so the admin views can show a Canceling / Canceled status
--  + the date access ends WITHOUT a per-user live Paddle call. It is cleared on
--  (re)activation so a resubscribe shows clean.
--
--  Why a dedicated column (not the existing status): the subscription.updated
--  webhook re-converges store-B status to the active plan value, so status is not
--  a reliable canceling signal. scheduled_cancel_at is owned by the cancel paths
--  only and survives the webhook, so the admin signal is stable + durable.
--
--  ENFORCEMENT UNCHANGED: this column is NOT read by the resolver / gate /
--  setUserPlan. It only powers the admin Canceling/Canceled display + filter.
--
--  ADDITIVE ONLY: adds one nullable column to user_platform_subscriptions,
--  alters/drops nothing. Idempotent. Apply manually via the Supabase dashboard.
--  No em dashes.
-- ============================================================

ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_cancel_at timestamptz;

-- Fast lookup of canceling / recently-canceled subscriptions (admin filter).
CREATE INDEX IF NOT EXISTS idx_ups_scheduled_cancel_at
  ON user_platform_subscriptions (scheduled_cancel_at)
  WHERE scheduled_cancel_at IS NOT NULL;
