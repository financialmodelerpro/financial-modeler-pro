-- 244_asset_type_values_move_to_project.sql
--
-- THE NAMES ARE THE FIRM'S, THE VALUES ARE THE PROJECT'S (2026-09-07, land
-- planning step 1c).
--
-- Migrations 242 and 243 put both halves of an asset type on the ACCOUNT: the
-- vocabulary (name, category, order) and the standards (unit size, parking
-- ratio and its basis, build cost, revenue rate and its unit). Keeping the
-- VALUES there forced a stamping scheme, because an account table must never
-- be read by the calculation engine: selecting a type copied its values onto
-- the asset so a later edit could not move a saved model.
--
-- The values are not firm-wide facts. A firm's schemes genuinely differ, so a
-- unit size or a build rate belongs to the PROJECT that assumes it. Moving
-- them into the project SNAPSHOT (`project.assetTypeValues`, keyed by this
-- table's entry_id, plus `project.parkingAreaPerSlotSqm`) makes each one an
-- ordinary model input: it versions, it diffs, the change log records it, and
-- nothing can go stale because nothing is copied. The whole stamping concept
-- goes with it (`Asset.assetTypeStandards` is deleted in the same change;
-- zero assets carried one, measured across every live project).
--
-- WHAT THIS TABLE KEEPS: entry_id, label, category, sort_order, author. It
-- becomes a pure vocabulary table, which is exactly what refm_cost_catalog is.
-- `Asset.assetTypeId` stays and becomes load-bearing: it is the key the
-- project's values are looked up by.
--
-- WHAT IS DISCARDED, stated rather than silently dropped. Probed immediately
-- before writing this migration: 10 rows exist, on ONE account, and exactly
-- ONE carried any value:
--   Branded Villas: avg_unit_size 200, parking_ratio 2 (slots_per_unit),
--                   construction_cost_per_sqm 11000, revenue_rate 21500 per_sqm.
-- No row used a non-default parking_ratio_basis, and refm_account_standards
-- held NO rows at all. That one row is re-entered on the project, which is one
-- row of typing and the reason this drops rather than deprecates: six unread
-- columns would be a second place values could live, and one rule with two
-- homes is the defect this whole change removes.
--
-- Idempotent: guarded per statement. No em dashes in this file.

BEGIN;

ALTER TABLE refm_asset_types
  DROP CONSTRAINT IF EXISTS refm_asset_types_construction_cost_nonneg,
  DROP CONSTRAINT IF EXISTS refm_asset_types_revenue_rate_nonneg,
  DROP CONSTRAINT IF EXISTS refm_asset_types_revenue_rate_unit_known;

ALTER TABLE refm_asset_types
  DROP COLUMN IF EXISTS avg_unit_size,
  DROP COLUMN IF EXISTS parking_ratio,
  DROP COLUMN IF EXISTS parking_ratio_basis,
  DROP COLUMN IF EXISTS construction_cost_per_sqm,
  DROP COLUMN IF EXISTS revenue_rate,
  DROP COLUMN IF EXISTS revenue_rate_unit;

-- The account-wide scalar moves to the project for the same reason as the
-- rest: a scheme's parking layout (basement against surface) is a project
-- assumption, not a firm-wide constant. The table held zero rows.
DROP TABLE IF EXISTS refm_account_standards;

COMMENT ON TABLE refm_asset_types IS
  'Account-scoped REFM asset type VOCABULARY (migs 242-244): the firm''s own type names, categories and order, shared by every member across the account''s projects. user_id is the AUTHOR (SET NULL when they leave). The VALUES that were here (unit size, parking ratio and basis, build cost, revenue rate and unit) moved to the project snapshot in mig 244 (project.assetTypeValues, keyed by entry_id) so they version, diff and change-log like any other model input; nothing is stamped onto an asset any more. Still never read by the calculation engine: this table holds names, not numbers.';

COMMIT;
