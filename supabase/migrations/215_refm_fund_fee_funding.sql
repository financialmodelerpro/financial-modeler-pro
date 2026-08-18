-- 215_refm_fund_fee_funding.sql
-- Fund layer, 2026-08-18: HOW THE MANAGEMENT FEE IS FUNDED.
--
-- Two ways, and until now the model did neither cleanly: the fee simply fell
-- into the undifferentiated deficit draw.
--
--   'deficit'  the fee sits inside cash from operations, lowers cash
--              available, and is funded through cash deficit funding at the
--              project debt/equity ratio like any other outflow. This is the
--              DEFAULT, it is what every existing project does, and it is what
--              the reference model does (its fee row feeds "total operating
--              inflows" and from there the development funding need).
--   'equity'   the fee is funded 100% by equity: removed from the deficit
--              sizing and drawn by the financing engine as a dedicated equity
--              draw on top of the ratio split, so total equity is equity capex
--              plus the management fee.
--
-- ADDITIVE AND NON-DESTRUCTIVE. No column is dropped, no data moves, and the
-- default is 'deficit' so every existing row keeps today's behaviour exactly.
--
-- The server reads in tiers (215 -> 211 -> 210 -> 209 -> 208) and steps down
-- on a missing column, so the application keeps working before this is
-- applied; the setting simply rides in the version snapshot instead, which is
-- what the engine reads.

ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS management_fee_funding TEXT NOT NULL DEFAULT 'deficit'
  CHECK (management_fee_funding IN ('deficit', 'equity'));

COMMENT ON COLUMN refm_fund_terms.management_fee_funding IS
  'deficit = the fee is funded through cash deficit funding at the project debt/equity ratio (default, matches the reference model); equity = the fee is funded 100% by a dedicated equity draw removed from the deficit.';
