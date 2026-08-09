-- 211_refm_fund_size_override.sql
-- Fund layer, 2026-08-05: the fund size becomes MODEL-DERIVED.
--
-- Fund size used to be a typed input. It is now resolved from the model as
-- total equity plus total debt, computed once in the fee-free pass and FROZEN
-- before the funding solver runs (the same treatment opening NAV has had since
-- Step 3). That freeze is the only reason a solved aggregate can be a fee base
-- at all: `fund_size_solved`, meaning a live solved figure read INSIDE the
-- solver loop, remains forbidden.
--
-- This column stores the user's CHOICE to pin a target fund size instead of
-- taking the model's figure, mirroring `facility_limit_override` from
-- migration 210. The existing `fund_size` column keeps its meaning and its
-- data: it is now the target used when this flag is on, or when the model has
-- raised no capital.
--
-- ADDITIVE AND NON-DESTRUCTIVE. No column is dropped, no data moves, and the
-- default is FALSE so every existing row keeps deriving the fund size from the
-- model, which is the new intended behaviour.
--
-- The server reads in tiers (211 -> 210 -> 209 -> 208) and steps down on a
-- missing column, so the application keeps working before this is applied; the
-- flag simply rides in the version snapshot instead, which is what the engine
-- reads.

ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS fund_size_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN refm_fund_terms.fund_size_override IS
  'When true, the typed fund_size is used as the fund structure fee base instead of the model-derived total (equity + debt), which is resolved in the fee-free pass and frozen before the funding solve.';
