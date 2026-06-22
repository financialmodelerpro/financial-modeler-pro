-- ============================================================
--  160_user_plan_reconciliation.sql
--  ONE-TIME plan-key reconciliation, run BEFORE entitlement
--  enforcement goes live. ADDITIVE/UPDATE only: it rewrites
--  users.subscription_plan values, drops/creates nothing.
--
--  The entitlement system (migs 158/159, plan_permissions) is keyed by
--  the new plan set: trial / solo / pro / firm. Production users still
--  carry the legacy keys free / professional / enterprise. Resolution
--  keyed on the new set would resolve a legacy user to ZERO features and
--  lock them out. This migration maps every legacy user onto the new
--  keys so the gate resolves correctly the moment it ships.
--
--  Mapping (founder-approved):
--    professional -> pro
--    enterprise   -> firm
--    free         -> trial, with a FRESH trial window: trial_ends_at =
--                    now() + the configured trial length. The duration is
--                    read from platform_pricing.trial_days (the same config
--                    src/shared/entitlements/trialConfig.resolveTrialDays
--                    uses), falling back to 14 days if none is configured.
--    trial/solo/pro/firm -> unchanged (idempotent re-run safe).
--
--  subscription_status is set consistently with the new plan: trial users
--  get 'trial', everyone else 'active' (unless already 'cancelled', which
--  is preserved so a cancelled account is not silently reactivated).
--
--  After this runs the system uses ONLY trial/solo/pro/firm. The old keys
--  are no longer referenced by resolution. Any user left on an unknown key
--  is NOT touched here and is caught by the application safety net
--  (resolveUserEntitlements logs the user id + unknown value and grants a
--  safe access-preserving default; it never locks out).
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

-- The configured trial length, sourced from platform_pricing like the app
-- does. CTE picks the first active plan with a positive trial_days; COALESCE
-- falls back to 14 so the migration is self-contained even on a fresh DB.
DO $$
DECLARE
  v_trial_days integer;
BEGIN
  SELECT trial_days INTO v_trial_days
  FROM platform_pricing
  WHERE COALESCE(is_active, true) = true
    AND COALESCE(trial_days, 0) > 0
  ORDER BY display_order
  LIMIT 1;

  IF v_trial_days IS NULL OR v_trial_days <= 0 THEN
    v_trial_days := 14;
  END IF;

  -- professional -> pro
  UPDATE users
     SET subscription_plan   = 'pro',
         subscription_status  = CASE WHEN subscription_status = 'cancelled' THEN 'cancelled' ELSE 'active' END,
         updated_at           = now()
   WHERE subscription_plan = 'professional';

  -- enterprise -> firm
  UPDATE users
     SET subscription_plan   = 'firm',
         subscription_status  = CASE WHEN subscription_status = 'cancelled' THEN 'cancelled' ELSE 'active' END,
         updated_at           = now()
   WHERE subscription_plan = 'enterprise';

  -- free -> trial, fresh trial window starting now.
  UPDATE users
     SET subscription_plan   = 'trial',
         subscription_status  = CASE WHEN subscription_status = 'cancelled' THEN 'cancelled' ELSE 'trial' END,
         trial_ends_at        = now() + make_interval(days => v_trial_days),
         updated_at           = now()
   WHERE subscription_plan = 'free';

  RAISE NOTICE 'Plan reconciliation complete. Trial window = % days.', v_trial_days;
END $$;

-- Note: users.subscription_plan may carry a CHECK constraint
-- (free/professional/enterprise) from src/lib/schema.sql. If the UPDATEs
-- above fail with a check-violation, the constraint must be relaxed first.
-- Production (post-migration-144) is expected to allow the new keys already
-- (the admin users + Phase C trial-approval paths write them). If a
-- constraint blocks it, run:
--   ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subscription_plan_check;
-- then re-run this migration. We do not force-drop it here to avoid
-- silently removing a guard the founder may want re-created with the new set.
