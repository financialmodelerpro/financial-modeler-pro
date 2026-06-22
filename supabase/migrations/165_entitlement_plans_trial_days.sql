-- ============================================================
--  165_entitlement_plans_trial_days.sql
--  Trial duration as a SINGLE source in the entitlement system.
--  ADDITIVE ONLY: adds one column to entitlement_plans, alters/drops nothing.
--
--  The trial length (in days) used to be read from platform_pricing.trial_days
--  (the marketing table). It now lives on the Trial plan in entitlement_plans,
--  edited in the Plan Builder. resolveTrialDays + loadPricingCatalog read this
--  one value; trial approval (trial_ends_at) and the marketing + in-app pricing
--  pages all reflect it.
--
--    trial_days  integer  the trial length in days; meaningful on the Trial plan
--                         row (plan_key = 'trial'). NULL falls back to 14 in code.
--
--  Migration of the current value: seed the Trial plan's trial_days from the
--  existing platform_pricing.trial_days (first active plan with a positive
--  value), falling back to 14, so nothing resets. platform_pricing is NOT
--  dropped (deprecated in place); this just stops the app reading it.
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE entitlement_plans
  ADD COLUMN IF NOT EXISTS trial_days integer;

DO $$
DECLARE
  v_days integer;
BEGIN
  -- Carry over the current configured trial length from platform_pricing so the
  -- value does not reset. Guarded so re-runs never overwrite an admin edit.
  BEGIN
    SELECT trial_days INTO v_days
    FROM platform_pricing
    WHERE platform_slug = 'real-estate'
      AND COALESCE(is_active, true) = true
      AND COALESCE(trial_days, 0) > 0
    ORDER BY display_order
    LIMIT 1;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_days := NULL;
  END;

  IF v_days IS NULL OR v_days <= 0 THEN
    v_days := 14;
  END IF;

  UPDATE entitlement_plans
     SET trial_days = v_days,
         updated_at = now()
   WHERE platform_slug = 'real-estate'
     AND plan_key = 'trial'
     AND trial_days IS NULL;

  RAISE NOTICE 'Trial plan trial_days seeded to % days.', v_days;
END $$;
