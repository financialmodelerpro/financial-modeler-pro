-- ============================================================
--  176_users_paddle_subscription.sql
--  Store the Paddle (Paddle Billing) subscription id + customer id on each user
--  so the in-dashboard subscription panel can act on a user's subscription via
--  the Paddle API (get / cancel-at-period-end / list invoices / update payment
--  method). The webhook captures and writes these when a subscription is
--  activated or updated; they are NEVER secrets (just opaque Paddle references).
--
--  ENFORCEMENT UNCHANGED: these columns are NOT read by the resolver / gate /
--  setUserPlan. They only let the server call Paddle for that user. The plan +
--  status the gate reads (subscription_plan / subscription_status /
--  trial_ends_at) are untouched here.
--
--  ADDITIVE ONLY: adds two nullable columns, alters/drops nothing. Idempotent
--  (ADD COLUMN IF NOT EXISTS). Apply manually via the Supabase dashboard.
--  No em dashes.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_subscription_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_customer_id     text;

-- Fast lookup by Paddle subscription id (webhook redelivery / reconciliation).
CREATE INDEX IF NOT EXISTS idx_users_paddle_subscription_id
  ON users (paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;
