-- ═══════════════════════════════════════════════════════════════════════════════
-- 144: Admin cleanup — drop dead permissions + pricing-extension tables
--
-- Companion migration to the multi-phase admin cleanup (commits 4a5abe3,
-- a000fbd, ee959ad, d8405e5). Drops every table whose admin UI / API was
-- removed in those commits and that has no remaining read site in the
-- codebase. Each DROP uses CASCADE so dependent foreign keys, views, and
-- triggers go with it without manual prep.
--
-- Tables dropped:
--
--   1. user_permissions   - per-user feature override (was Permissions /
--                           User Overrides admin pages, deleted in d8405e5).
--   2. plan_permissions   - plan × feature gate (same admin UI).
--   3. features_registry  - feature catalog feeding the admin matrix.
--                           Migration 006 introduced all three; the trio is
--                           now dead because /api/permissions, useSubscription
--                           hook, and PermissionsManager are gone.
--
--   4. pricing_features   - per-plan feature checklist (Pricing → Features
--                           tab, deleted in 4a5abe3). NOT to be confused
--                           with platform_features / platform_feature_access
--                           which still drive the live Platform Pricing tab.
--   5. pricing_modules    - per-plan module gate (Pricing → Module Access
--                           tab, deleted in 4a5abe3). The Modeling Hub
--                           Modules admin (/admin/modules) uses a separate
--                           `modeling_modules` table and is unaffected.
--
-- Idempotent: every DROP uses IF EXISTS, so re-running the migration after
-- a partial apply is safe.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Permissions trio (migration 006) ──────────────────────────────────────────
DROP TABLE IF EXISTS user_permissions CASCADE;
DROP TABLE IF EXISTS plan_permissions CASCADE;
DROP TABLE IF EXISTS features_registry CASCADE;

-- ── Dead Pricing extension tables ─────────────────────────────────────────────
DROP TABLE IF EXISTS pricing_features CASCADE;
DROP TABLE IF EXISTS pricing_modules CASCADE;

-- ── Sanity (uncomment locally to verify after apply) ──────────────────────────
-- SELECT tablename FROM pg_tables WHERE schemaname='public'
--   AND tablename IN (
--     'user_permissions','plan_permissions','features_registry',
--     'pricing_features','pricing_modules'
--   );
-- Should return 0 rows.
