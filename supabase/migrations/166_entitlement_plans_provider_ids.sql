-- ============================================================
--  166_entitlement_plans_provider_ids.sql
--  Per-plan PAYMENT PROVIDER price / product IDs, so a plan can be mapped to a
--  provider's catalog item for checkout, and a provider webhook event can be
--  mapped back to the internal plan. ADDITIVE ONLY: adds columns to
--  entitlement_plans, alters/drops nothing.
--
--  One set of fields per supported provider (Paddle, PayPro). Empty by default;
--  an admin pastes the real IDs in the Plan Builder once a provider is approved.
--  These are NOT secrets (they are catalog identifiers), but they are only ever
--  read server-side (checkout handler + webhook) and in the admin Plan Builder.
--
--    paddle_price_id_monthly  text  Paddle price id for the monthly billing cycle
--    paddle_price_id_annual   text  Paddle price id for the annual billing cycle
--    paypro_product_id        text  PayPro product / plan id (single id)
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE entitlement_plans
  ADD COLUMN IF NOT EXISTS paddle_price_id_monthly text,
  ADD COLUMN IF NOT EXISTS paddle_price_id_annual  text,
  ADD COLUMN IF NOT EXISTS paypro_product_id       text;
