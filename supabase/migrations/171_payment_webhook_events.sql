-- ============================================================
--  171_payment_webhook_events.sql
--  Webhook IDEMPOTENCY ledger. Records each provider event id that has been
--  applied, so a replayed / redelivered webhook is never applied twice (the
--  definitive replay guard for the payment webhook). The webhook route checks
--  this table before calling setUserPlan and records the id only after a
--  successful apply, so a failed apply can still be retried by redelivery.
--
--  SECURITY: read / written ONLY server-side with the service-role client (the
--  webhook route). RLS is ENABLED with NO policies, so anon / authenticated keys
--  can never read or write it; the service role bypasses RLS.
--
--  ADDITIVE ONLY: new table, alters/drops nothing. Idempotent.
--  Apply manually via the Supabase dashboard. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  provider     text NOT NULL,
  event_id     text NOT NULL,
  event_type   text,
  plan_key     text,
  user_id      uuid,
  status       text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;
