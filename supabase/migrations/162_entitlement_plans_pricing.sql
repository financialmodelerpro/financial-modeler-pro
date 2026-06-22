-- ============================================================
--  162_entitlement_plans_pricing.sql
--  Price + billing-interval data for the admin Plan Builder, so ONE screen
--  (/admin/plans) owns a plan end to end: features + limits + price.
--  ADDITIVE ONLY: adds columns to entitlement_plans, alters/drops nothing.
--
--  These are DATA on entitlement_plans (not the marketing platform_pricing
--  table, which stays the source for the PUBLIC marketing page only). The
--  in-app REFM pricing page reads these columns.
--
--    price_monthly  numeric  per-month price in `currency` (null = unpriced)
--    price_annual   numeric  per-year price in `currency` (null = unpriced)
--    currency       text     ISO code, default 'SAR'
--    contact_sales  boolean  when true the plan shows "Contact sales" instead
--                            of a number (Firm / Enterprise), regardless of price
--
--  Trial stays unpriced (free to the user): both prices null, contact_sales
--  false. `active` already exists (mig 159).
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE entitlement_plans
  ADD COLUMN IF NOT EXISTS price_monthly numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_annual  numeric(10,2),
  ADD COLUMN IF NOT EXISTS currency      text NOT NULL DEFAULT 'SAR',
  ADD COLUMN IF NOT EXISTS contact_sales boolean NOT NULL DEFAULT false;

-- Seed sensible starting prices for the four REFM plans so the in-app pricing
-- page renders immediately. ON CONFLICT-free UPDATEs guarded by plan_key, and
-- only applied when prices are still NULL so an admin edit is never overwritten
-- on a re-run.
UPDATE entitlement_plans SET price_monthly = 0,    price_annual = 0
  WHERE platform_slug = 'real-estate' AND plan_key = 'trial' AND price_monthly IS NULL;
UPDATE entitlement_plans SET price_monthly = 99,   price_annual = 990
  WHERE platform_slug = 'real-estate' AND plan_key = 'solo'  AND price_monthly IS NULL;
UPDATE entitlement_plans SET price_monthly = 299,  price_annual = 2990
  WHERE platform_slug = 'real-estate' AND plan_key = 'pro'   AND price_monthly IS NULL;
UPDATE entitlement_plans SET contact_sales = true
  WHERE platform_slug = 'real-estate' AND plan_key = 'firm'  AND contact_sales = false AND price_monthly IS NULL;
