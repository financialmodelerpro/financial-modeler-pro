-- ============================================================
--  237_seats_live.sql
--
--  SEATS BECOME REAL. Module 10 Collaboration, step 8.
--
--  Two things, both data, no schema change:
--
--  1. THE PLAN SEAT LIMITS ARE DECLARED AUTHORITATIVELY, which corrects the
--     seed in migration 158 WITHOUT EDITING IT. 158 seeded pro = 3. That was
--     changed to 1 in the admin panel on 2026-09-01h, for a stated reason: Pro
--     gets three seats while `rbac` and `module_10` (Collaborate) are both
--     Firm-only, so it was selling three seats with no roles and no
--     collaboration module. Production has read 1 ever since.
--
--     An APPLIED migration is never edited (TRAPS 2.9 and the standing rule in
--     CLAUDE-DB.md), so 158 keeps saying 3 forever and a database rebuilt from
--     the migration log alone would have disagreed with production. This
--     migration is the correction: it states the true values, so the log and
--     the live rows agree from here on.
--
--       trial 1, solo 1, pro 1, firm 10
--
--     PRO IS 1 AND THAT MEANS NO COLLABORATION. The owner consumes the seat,
--     so a Pro account is exactly one person. That is the intended product
--     shape, not an oversight: collaboration is a Firm feature.
--
--  2. THE `seats` FEATURE STOPS SAYING "COMING SOON". It has carried
--     `build_status: 'needs_build'` and a description beginning "Coming soon:"
--     since 158, which was honest while nothing enforced it. Step 8 enforces
--     it in `/api/admin/project-members`, so the label would now be false.
--     `build_status` does not gate rendering (only `visible` does, see
--     `visibleForCustomers`), so this is about telling the truth on a page
--     customers read, not about making a row appear.
--
--  Idempotent: keyed by plan_key / feature_key, and re-running sets the same
--  values. Safe to re-run. No em dashes.
--
--  Apply with: npx tsx scripts/apply-migration-237.ts --apply
-- ============================================================

BEGIN;

-- 1. The authoritative seat limits. `included` stays true for every plan:
--    every account has at least the owner's own seat.
UPDATE plan_permissions SET included = true, limit_value = 1  WHERE feature_key = 'seats' AND plan_key = 'trial';
UPDATE plan_permissions SET included = true, limit_value = 1  WHERE feature_key = 'seats' AND plan_key = 'solo';
UPDATE plan_permissions SET included = true, limit_value = 1  WHERE feature_key = 'seats' AND plan_key = 'pro';
UPDATE plan_permissions SET included = true, limit_value = 10 WHERE feature_key = 'seats' AND plan_key = 'firm';

-- 2. The feature is built. The description loses "Coming soon" and gains what
--    the rule actually is, including who counts (the owner does) and how a
--    client gets more (an admin raises it; extra seats are invoiced manually,
--    there is no self-serve purchase yet).
UPDATE features_registry
   SET build_status = 'live',
       description  = 'The number of distinct people who can reach this account''s projects, counted across all of them. The account owner uses one seat, so a one-seat plan is a single-person plan. Need more? Contact us and we will raise your limit.'
 WHERE feature_key = 'seats';

COMMIT;
