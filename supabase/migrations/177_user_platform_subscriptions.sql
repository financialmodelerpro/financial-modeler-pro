-- ============================================================
--  177_user_platform_subscriptions.sql
--  Per-platform subscription store. A user can hold one subscription PER
--  platform (today only real-estate exists, but the billing tab renders one
--  section per platform the user has, so this scales with no code change). Keyed
--  by (user_id, platform_slug); carries the Paddle subscription id + customer id
--  + the plan_key for that platform.
--
--  ENFORCEMENT UNCHANGED: this table is NOT read by the resolver / gate /
--  setUserPlan. The global users.subscription_plan / subscription_status /
--  trial_ends_at that the gate reads are untouched. This table only powers the
--  in-dashboard billing tab + the Paddle management API calls, per platform.
--
--  Backfills the existing global ids (mig 176) into the real-estate row so a
--  user who already subscribed shows up immediately without a webhook replay.
--
--  SECURITY: RLS ENABLED with NO policies, so anon / authenticated keys can
--  never read or write it; only the service role (server routes) touches it.
--
--  ADDITIVE ONLY: new table, alters/drops nothing. Idempotent. Apply manually
--  via the Supabase dashboard. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_platform_subscriptions (
  user_id                uuid NOT NULL,
  platform_slug          text NOT NULL,
  paddle_subscription_id text,
  paddle_customer_id     text,
  plan_key               text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform_slug)
);

ALTER TABLE user_platform_subscriptions ENABLE ROW LEVEL SECURITY;

-- Fast lookup by Paddle subscription id (webhook redelivery / reconciliation).
CREATE INDEX IF NOT EXISTS idx_ups_paddle_subscription_id
  ON user_platform_subscriptions (paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

-- Backfill the real-estate row from the existing global columns (mig 176), so
-- the current subscribed user(s) render in the new per-platform billing tab
-- without needing a webhook replay. ON CONFLICT keeps any row already present.
INSERT INTO user_platform_subscriptions (user_id, platform_slug, paddle_subscription_id, paddle_customer_id, plan_key)
SELECT id, 'real-estate', paddle_subscription_id, paddle_customer_id, subscription_plan
  FROM users
 WHERE paddle_subscription_id IS NOT NULL
ON CONFLICT (user_id, platform_slug) DO NOTHING;
