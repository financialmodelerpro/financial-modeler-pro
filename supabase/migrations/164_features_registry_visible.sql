-- ============================================================
--  164_features_registry_visible.sql
--  Per-feature CUSTOMER-FACING visibility toggle for non-module features.
--  ADDITIVE ONLY: adds one column to features_registry, alters/drops nothing.
--
--    visible  boolean  default true. When false the feature is hidden from
--                      customer-facing surfaces (public marketing pricing page,
--                      in-app pricing page, comparison table). It is NOT removed
--                      from the catalog and its GATING/ENFORCEMENT is unchanged:
--                      a hidden feature that is still assigned keeps working,
--                      it just is not advertised.
--
--  This controls DISPLAY only and applies to NON-MODULE features. Module rows
--  are derived live from the platform_modules registry, and module visibility
--  stays controlled by the Modules tab (status hidden) -- this column does not
--  introduce a second module visibility control.
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE features_registry
  ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;
