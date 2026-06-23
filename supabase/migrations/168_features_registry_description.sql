-- ============================================================
--  168_features_registry_description.sql
--  Per-feature short DESCRIPTION, shown as the clickable info popover on the
--  pricing comparison (public + in-app) and edited in the admin Plan Builder.
--  ADDITIVE ONLY: adds one column to features_registry, alters/drops nothing.
--
--  Display-only: this never affects gating, coverage, or enforcement. Default
--  NULL (empty), so a feature with no description shows no info affordance.
--  Applies to module rows (module_N) and non-module rows alike (both have a
--  features_registry row; the merged catalog attaches the description by
--  feature_key).
--
--    description  text  short plain-text blurb (null = none)
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE features_registry
  ADD COLUMN IF NOT EXISTS description text;
