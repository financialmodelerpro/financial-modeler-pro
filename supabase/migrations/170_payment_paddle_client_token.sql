-- ============================================================
--  170_payment_paddle_client_token.sql
--  Add the Paddle client-side token to the payment config. This is the ONE
--  publishable value (sandbox tokens start with `test_`): the browser needs it
--  to open Paddle.js hosted checkout. It is NOT a secret (unlike the API key /
--  API secret / webhook secret, which stay server-only).
--
--  ADDITIVE ONLY: adds one nullable column, alters/drops nothing. Idempotent.
--  Apply manually via the Supabase dashboard. No em dashes.
-- ============================================================

ALTER TABLE payment_settings
  ADD COLUMN IF NOT EXISTS paddle_client_token text;
