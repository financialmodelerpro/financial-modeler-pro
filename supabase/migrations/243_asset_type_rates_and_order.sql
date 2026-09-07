-- 243_asset_type_rates_and_order.sql
--
-- THE ASSET TYPE REGISTRY CARRIES RATES AND AN ORDER (2026-09-07, land
-- planning step 1b).
--
-- Migration 242 gave the firm's asset type registry the two area standards
-- (average unit size, parking ratio + basis). The registry is the firm's
-- data-entry surface for a type, so it now also carries what a type COSTS to
-- build and what it EARNS:
--
--   construction_cost_per_sqm  the build rate, per sqm.
--   revenue_rate + its UNIT    one number whose unit NAMES the basis, so the
--                              single column serves per sqm, per unit, per
--                              sqm per year (lease) and ADR per key per night
--                              (hospitality) without four half-empty columns.
--   sort_order                 the list is the firm's to arrange.
--
-- SORT_ORDER IS NULLABLE ON PURPOSE, the mig-229 rule: NULL means "never
-- reordered" and falls back to label order, while 0 is a real top-of-list
-- position. A dense whole-list write on reorder keeps the two apart.
--
-- STILL NOT READ BY THE CALCULATION ENGINE, and that is the point of the
-- whole design: selecting a type STAMPS these values onto the asset, and the
-- engine reads the asset. Capex and revenue keep taking their rates exactly
-- as they do today. A firm editing its standards can therefore never change
-- a saved model, which is the invariant 242 established and this migration
-- extends to the rates.
--
-- A BLANK AND A TYPED ZERO REMAIN DIFFERENT ANSWERS (242's rule): every new
-- numeric is NULLABLE with a CHECK that forbids negatives and deliberately
-- admits both NULL and 0.
--
-- revenue_rate_unit is TEXT with a CHECK, not an enum, per the mig 214
-- rationale: the union lives in code (lib/state/assetTypeStandards.ts) and
-- the API route validates against it, so a vocabulary change stays a code
-- change. It is NULLABLE because a type with no rate has no basis to name.
--
-- Idempotent: guarded per statement. No em dashes in this file.

BEGIN;

ALTER TABLE refm_asset_types
  ADD COLUMN IF NOT EXISTS construction_cost_per_sqm NUMERIC,
  ADD COLUMN IF NOT EXISTS revenue_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS revenue_rate_unit TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refm_asset_types_construction_cost_nonneg'
  ) THEN
    ALTER TABLE refm_asset_types
      ADD CONSTRAINT refm_asset_types_construction_cost_nonneg
      CHECK (construction_cost_per_sqm IS NULL OR construction_cost_per_sqm >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refm_asset_types_revenue_rate_nonneg'
  ) THEN
    ALTER TABLE refm_asset_types
      ADD CONSTRAINT refm_asset_types_revenue_rate_nonneg
      CHECK (revenue_rate IS NULL OR revenue_rate >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refm_asset_types_revenue_rate_unit_known'
  ) THEN
    ALTER TABLE refm_asset_types
      ADD CONSTRAINT refm_asset_types_revenue_rate_unit_known
      CHECK (revenue_rate_unit IS NULL OR revenue_rate_unit IN (
        'per_sqm', 'per_unit', 'per_sqm_year', 'adr_per_key_night'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refm_asset_types_account_order
  ON refm_asset_types (account_id, sort_order NULLS LAST, label);

COMMENT ON COLUMN refm_asset_types.construction_cost_per_sqm IS
  'Build rate per sqm for this asset type. NULL means not decided; 0 is a decision. Never read by the calculation engine: it stamps onto the asset at selection time.';
COMMENT ON COLUMN refm_asset_types.revenue_rate IS
  'Revenue rate for this asset type, in the unit named by revenue_rate_unit. NULL means not decided; 0 is a decision. Never read by the calculation engine: it stamps onto the asset at selection time.';
COMMENT ON COLUMN refm_asset_types.revenue_rate_unit IS
  'What revenue_rate is per: per_sqm | per_unit | per_sqm_year (lease) | adr_per_key_night (hospitality). NULL when no rate is set.';
COMMENT ON COLUMN refm_asset_types.sort_order IS
  'The firm''s own order for its type list. NULLABLE on purpose (mig 229 rule): NULL is "never reordered" and falls back to label order, 0 is a real first position.';

COMMIT;
