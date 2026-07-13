-- 197_report_ic_deck_case_money_scale.sql
-- REFM Module 7 Reports: two IC deck settings on refm_report_inputs.
--   ic_deck_case  : which case drives the IC deck numbers. 'management' (base
--                   case, DEFAULT) keeps the base deck stable regardless of the
--                   active case; 'active' follows the topbar case selection.
--   ic_money_scale: IC money display scale, 'millions' (DEFAULT) or 'thousands',
--                   driving both tables/tiles and chart axes.
-- Additive, non-destructive, idempotent. Reads/writes are schema-tolerant
-- (tiered fallback to mig 193/192/191), so the Reports tab defaults to
-- Management + millions until this migration is applied.
BEGIN;

ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS ic_deck_case  text NOT NULL DEFAULT 'management';
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS ic_money_scale text NOT NULL DEFAULT 'millions';

COMMIT;

-- Additive only. Drops nothing. Existing rows inherit the defaults (Management
-- case, millions scale), matching the code default.
