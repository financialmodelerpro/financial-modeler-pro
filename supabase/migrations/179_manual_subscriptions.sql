-- ============================================================
--  179_manual_subscriptions.sql
--  Make user_platform_subscriptions the single per-(user, platform) source of
--  truth for plan state, supporting BOTH Paddle-billed and admin-assigned MANUAL
--  (bank / offline) plans. A manual plan has its own start + expiry the gate
--  honors (like a trial), and an amount for the per-customer revenue summary.
--
--  source     'paddle' (default, existing rows) | 'manual'
--  status     mirror of the plan status (active / canceled / expired / trialing)
--  started_at when the (manual) subscription began
--  current_period_end / expires_at  manual period end + access expiry
--  amount_minor / currency          the manual payment amount (revenue)
--  note       free-text (e.g. "bank transfer ref 1234")
--
--  ENFORCEMENT: the gate still reads users.subscription_plan as the plan input;
--  the ONLY additive gate change is honoring expires_at (mirrors trial_ends_at).
--  setUserPlan writes BOTH users.* and this row, so admin and the billing panel
--  read consistent plan data (fixes the divergence bug).
--
--  ADDITIVE ONLY: adds nullable columns to user_platform_subscriptions (mig 177),
--  alters/drops nothing. Idempotent. Apply manually via the Supabase dashboard.
--  No em dashes.
-- ============================================================

ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'paddle';
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS status             text;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS started_at         timestamptz;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS expires_at         timestamptz;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS amount_minor       integer;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS currency           text;
ALTER TABLE user_platform_subscriptions ADD COLUMN IF NOT EXISTS note               text;

-- Existing rows came from the webhook, so they are Paddle-sourced; the column
-- default already sets 'paddle', this just makes it explicit + safe to re-run.
UPDATE user_platform_subscriptions SET source = 'paddle' WHERE source IS NULL;

-- Fast lookup of expiring manual plans (for a future expiry sweep).
CREATE INDEX IF NOT EXISTS idx_ups_expires_at
  ON user_platform_subscriptions (expires_at)
  WHERE expires_at IS NOT NULL;
