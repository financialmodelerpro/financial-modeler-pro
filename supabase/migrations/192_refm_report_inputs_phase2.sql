-- 192_refm_report_inputs_phase2.sql
-- REFM Module 7 Reports, Phase 2 (Lender Package + Investor One-Pager). Adds the
-- three NEW narrative fields those report types need, to the existing per-project
-- refm_report_inputs table (mig 191). Additive, non-destructive, idempotent.
-- Presentation / narrative ONLY: the model engine never reads this table.
--
--   security_collateral : Lender Package "Security & Collateral" notes
--   covenant_commentary : Lender Package covenant commentary
--   thesis_line         : Investor One-Pager short thesis line
--
-- The existing columns (executive_summary / disclaimers / header_text /
-- footer_text / font_body / font_heading) are SHARED across all three report
-- types. section_config stays jsonb and now holds a per-report-type object
-- { ic, lender, onepager } (a value-shape change, NOT a schema change, so no
-- column migration is needed for it; reads migrate a legacy bare array to `ic`).
BEGIN;

ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS security_collateral text;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS covenant_commentary text;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS thesis_line          text;

COMMIT;

-- Additive only. Drops nothing. Reads tolerate these columns being absent
-- (pre-apply) by treating them as empty, so the Phase 2 report tabs render before
-- this migration is applied.
