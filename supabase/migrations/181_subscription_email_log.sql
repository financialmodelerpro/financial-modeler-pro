-- ============================================================
--  181_subscription_email_log.sql
--  A dedupe ledger for the subscription-lifecycle emails (welcome / active,
--  canceled, trial started, and the time-based reminders: trial ending,
--  auto-renewal charge notice, ending-plan expiry, grace started, grace ending).
--
--  The daily reminder cron is IDEMPOTENT because of this table: before sending an
--  email it CLAIMS a row (an insert that the UNIQUE index turns into a no-op on a
--  replay), and only sends when the claim wins. The key includes anchor_day (the
--  date the email is ABOUT: trial end / renewal / expiry / grace end), so a
--  reminder naturally re-fires for a NEW billing period (a different period end)
--  while never sending twice for the same one.
--
--  ENFORCEMENT: unchanged. This is send-tracking only; it touches no plan/gate
--  state. Additive: new table only. Idempotent. Apply manually via the Supabase
--  dashboard. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_email_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  platform_slug text NOT NULL DEFAULT 'real-estate',
  email_type    text NOT NULL,                 -- 'welcome_paddle' | 'welcome_manual' | 'canceled' | 'trial_started' | 'trial_ending' | 'renewal_reminder' | 'expiry_reminder' | 'grace_started' | 'grace_ending'
  threshold     text NOT NULL DEFAULT 'once',  -- '7d' | '1d' | 'once' (once = transactional / one-shot)
  anchor_day    date NOT NULL,                 -- the date the email is about (or the event day for transactional)
  sent_at       timestamptz NOT NULL DEFAULT now()
);

-- One send per (user, platform, type, threshold, anchor day). All columns NOT
-- NULL so the uniqueness is reliable (Postgres treats NULLs as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_email_log
  ON subscription_email_log (user_id, platform_slug, email_type, threshold, anchor_day);

CREATE INDEX IF NOT EXISTS idx_subscription_email_log_user
  ON subscription_email_log (user_id, platform_slug);

ALTER TABLE subscription_email_log ENABLE ROW LEVEL SECURITY;
