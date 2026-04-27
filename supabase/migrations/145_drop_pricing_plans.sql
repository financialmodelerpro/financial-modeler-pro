-- ═══════════════════════════════════════════════════════════════════════════════
-- 145: Drop pricing_plans table
--
-- Companion to the Plans tab removal in /admin/pricing. The table backed the
-- generic "Free / Starter / Professional / Enterprise" plan list that was
-- never wired into pay-walls or feature gating - the canonical pricing model
-- is per-platform via `platform_pricing` + `platform_features` +
-- `plan_feature_access` (introduced by migrations 076 + 077).
--
-- Pre-removal consumers (now gone in the same commit):
--   * /admin/pricing → Plans tab UI (the create/edit/delete form)
--   * /api/admin/pricing/plans/route.ts (CRUD endpoint)
--   * app/(portal)/page.tsx pricing-teaser plan-name pill row
--   * src/lib/shared/cms.ts → getPublicPlanNames() (orphan helper, no importers)
--
-- CASCADE so any leftover FKs go too. IF EXISTS so re-runs are no-ops.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS pricing_plans CASCADE;
