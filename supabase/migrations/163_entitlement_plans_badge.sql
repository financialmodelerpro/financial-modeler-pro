-- ============================================================
--  163_entitlement_plans_badge.sql
--  Marketing-card highlight for the Plan Builder, so a plan can be flagged
--  "Most Popular" (or carry a custom badge) on the pricing pages.
--  ADDITIVE ONLY: adds columns to entitlement_plans, alters/drops nothing.
--
--    popular     boolean  when true the card gets the featured highlight +
--                         a default "Most Popular" ribbon
--    badge_text  text     optional custom ribbon text (overrides the default
--                         "Most Popular" label when popular is true; can also
--                         stand alone for a plain badge)
--
--  display_order already exists (mig 159) and drives card order. Set both in
--  /admin/plans (Plan Builder); read by the public marketing page and the
--  in-app pricing page (one source of truth = entitlement_plans).
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE entitlement_plans
  ADD COLUMN IF NOT EXISTS popular    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_text text;

-- Default the Pro plan to the popular highlight so the cards have a sensible
-- default (only when not already customised).
UPDATE entitlement_plans SET popular = true
  WHERE platform_slug = 'real-estate' AND plan_key = 'pro' AND popular = false;
