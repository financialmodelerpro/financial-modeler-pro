-- ============================================================
--  180_payment_ledger_and_convert.sql
--  (1) A unified payment ledger so the admin Revenue page aggregates across ALL
--      users from the DB (no per-user Paddle calls). Paddle rows are written by
--      the transaction.completed webhook (external_id = Paddle transaction id,
--      so they are RECONCILABLE against the Paddle dashboard); manual rows are
--      written when an admin assigns/renews a manual (offline) plan.
--  (2) Scheduled CONVERT-TO-MANUAL columns on user_platform_subscriptions, so a
--      Paddle user can be converted at the END of their paid Paddle period (no
--      wasted prepaid time): Paddle is canceled at period end, and the manual
--      plan is scheduled to begin at that date. Applied by the
--      subscription.canceled webhook (primary) + the cron (backstop), reusing
--      setUserPlan (no duplicated plan logic).
--
--  ENFORCEMENT: unchanged. The ledger is reporting only; the scheduled-manual
--  columns are applied via setUserPlan (the existing single plan path). The gate
--  is untouched.
--
--  ADDITIVE ONLY: new table + nullable columns; alters/drops nothing. Idempotent.
--  Apply manually via the Supabase dashboard. No em dashes.
-- ============================================================

-- (1) Unified payment ledger.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,                 -- 'paddle' | 'manual'
  external_id   text,                          -- Paddle transaction id (null for manual)
  user_id       uuid,
  platform_slug text NOT NULL DEFAULT 'real-estate',
  plan_key      text,
  amount_minor  integer NOT NULL,
  currency      text,
  status        text,                          -- 'completed' | 'paid' | 'manual'
  billed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Reconciliation + idempotency: one ledger row per Paddle transaction id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_transactions_external
  ON payment_transactions (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_billed_at ON payment_transactions (billed_at);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_plan ON payment_transactions (plan_key);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- (2) Scheduled convert-to-manual (reuses scheduled_effective_at from mig 178 as
--     the date = the Paddle period end).
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_to_manual          boolean NOT NULL DEFAULT false;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_manual_plan_key    text;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_manual_expires_at  timestamptz;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_manual_amount_minor integer;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_manual_currency    text;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS scheduled_manual_note        text;
