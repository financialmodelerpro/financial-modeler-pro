-- ============================================================
--  175_migrate_free_to_none.sql
--
--  Clean up the legacy 'free' plan value. 'free' is NOT a known entitlement
--  plan, so the resolver routes it through the unknown-plan SAFETY NET (which
--  PRESERVES access). That is why users left on 'free' (e.g. ahmaddin.ch) could
--  still open REFM. Move every non-admin user on 'free' to the deliberate
--  no-access 'none' state so they are correctly locked out until they get a
--  trial or a plan.
--
--  DATA-ONLY, scoped, idempotent: touches ONLY rows where subscription_plan =
--  'free' AND role <> 'admin'. Trial / solo / pro / firm users and admins are
--  untouched. subscription_status = 'expired' matches the signup no-access
--  default + setUserPlan('none') (an allowed CHECK value; gating is plan-driven).
--  Re-running is a no-op (no 'free' rows remain).
--
--  No enforcement change: the resolver none/unknown logic is untouched; this
--  only stops users sitting on a legacy value that the safety net let through.
--
--  Apply manually via the Supabase dashboard. No em dashes.
-- ============================================================

UPDATE users
   SET subscription_plan   = 'none',
       subscription_status = 'expired',
       trial_ends_at       = NULL,
       updated_at          = now()
 WHERE subscription_plan = 'free'
   AND role <> 'admin';
