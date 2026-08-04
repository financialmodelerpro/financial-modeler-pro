-- 209_refm_fund_terms_extended.sql
-- Fund layer Step 2 (extended): the real fee set and the per-party fee
-- distribution matrix.
--
-- ADDITIVE ONLY. Every statement is ADD COLUMN IF NOT EXISTS. Nothing is
-- dropped, nothing is renamed, no existing value is rewritten, and a project
-- with fund_enabled = false behaves exactly as it does today. Idempotent: safe
-- to run more than once. See docs/FUND_LAYER_GUIDELINE.md.
--
-- WHY MORE COLUMNS. Migration 208 modelled ONE management fee on a choice of
-- two bases. A real fund carries several fees with different TIMINGS (one time
-- versus annual) and different BASES, and splits several different fee types
-- across the parties in the deal. That cannot be expressed as one rate.
--
-- COLUMNS 208 CREATED THAT THIS MIGRATION RETIRES BUT KEEPS:
--   management_fee_pct, fee_base, committed_capital, fee_shares
-- They are no longer read by the Fund Terms tab. They are deliberately NOT
-- dropped: the platform rule is additive-only, prod may already hold values a
-- user typed, and a dropped column cannot be un-dropped. Treat them as legacy.
--
-- COLUMNS 208 CREATED THAT KEEP THEIR EXACT MEANING, so no data moves:
--   carry_pct        = the Performance fee percentage (carry IS the
--                      performance fee; giving it a second column would create
--                      two sources of truth for one number).
--   hurdle_rate_pct  = the hurdle rate, expressed as an IRR.
--
-- THE LINEARITY RULE, which is the whole reason these particular bases were
-- chosen. A fee is a cash outflow, so paying it RAISES the funding requirement.
-- If a fee were charged on anything that the funding solve moves within the
-- same period, the fee would feed its own base and the fund layer would land
-- inside the M4 circular block. Every base here is therefore known BEFORE the
-- period's cash moves:
--
--   fund_size       user input (target or committed), never a solved output
--   facility_limit  user input (the facility's limit), never drawn balance
--   opening NAV     NAV at the START of the period, fixed before any cash moves
--   flat amount     a typed currency figure per annum
--
-- Closing NAV, average NAV, drawn debt, total sources and the funding
-- requirement itself are all FORBIDDEN as fee bases in v1 for that reason.
-- src/hubs/modeling/platforms/refm/lib/fundTerms.ts encodes this as
-- FUND_FEE_SPECS + LINEAR_FEE_BASES and scripts/verify-fund-terms.ts fails if a
-- fee ever declares a circular base, so the rule is enforced rather than
-- described.
--
-- Reads stay schema-tolerant (prod lags the repo): the server probes for these
-- columns and falls back to the migration-208 column set when they are absent,
-- so the Fund Terms tab keeps working before this is applied.
BEGIN;

-- ── Fee bases that are USER INPUTS, never solved outputs ────────────────────
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS fund_size numeric NOT NULL DEFAULT 0;
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS facility_limit numeric NOT NULL DEFAULT 0;

-- ── Fund management fees ────────────────────────────────────────────────────
-- Rates are DECIMAL FRACTIONS (0.02 = 2%), matching every other rate in the
-- platform (returns.discountRate, dividendPolicy.payoutRatio, tax rate) rather
-- than percent-valued columns some caller would eventually forget to divide.
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS fund_structure_fee_pct numeric NOT NULL DEFAULT 0;   -- one time, % of fund size
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS fund_management_fee_pct numeric NOT NULL DEFAULT 0;  -- annual, % of OPENING NAV
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS custody_admin_fee_pct numeric NOT NULL DEFAULT 0;    -- annual, % of OPENING NAV
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS debt_arranging_fee_pct numeric NOT NULL DEFAULT 0;   -- one time, % of facility limit
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS other_expenses_per_annum numeric NOT NULL DEFAULT 0; -- flat currency per annum

-- ── Fee distribution matrix ────────────────────────────────────────────────
-- [{ "partyId": "...", "partyName": "...", "performanceFeePct": 0.5,
--    "developerFeePct": 0, "commissionPct": 0.25 }, ...]
--
-- Rows key on a party from refm_parties (mig 190) AND carry a snapshot of the
-- party NAME, the same shape an M5 equity partner uses: the id is the link, the
-- name is what survives if the party is later renamed or removed, so no engine
-- or report ever has to join back to a mutable side table to render a row.
--
-- jsonb rather than a child table: this is a short matrix edited as one unit,
-- always read whole, and never queried by party. Shares are validated in the
-- app and the API, matching how refm_parties.roles and refm_fund_terms.fee_shares
-- are handled (Postgres cannot cleanly CHECK inside an array of objects).
ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS fee_distribution jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── Range constraints, added only if absent ────────────────────────────────
-- Separate DO blocks rather than inline CHECKs because ADD COLUMN IF NOT EXISTS
-- silently skips its CHECK when the column already exists, which would leave a
-- re-run with an unconstrained column and no error to say so.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refm_fund_terms_rates_0_1') THEN
    ALTER TABLE refm_fund_terms ADD CONSTRAINT refm_fund_terms_rates_0_1 CHECK (
      fund_structure_fee_pct  >= 0 AND fund_structure_fee_pct  <= 1 AND
      fund_management_fee_pct >= 0 AND fund_management_fee_pct <= 1 AND
      custody_admin_fee_pct   >= 0 AND custody_admin_fee_pct   <= 1 AND
      debt_arranging_fee_pct  >= 0 AND debt_arranging_fee_pct  <= 1
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refm_fund_terms_amounts_non_negative') THEN
    ALTER TABLE refm_fund_terms ADD CONSTRAINT refm_fund_terms_amounts_non_negative CHECK (
      fund_size >= 0 AND facility_limit >= 0 AND other_expenses_per_annum >= 0
    );
  END IF;
END $$;

COMMENT ON COLUMN refm_fund_terms.fund_size IS
  'Fund size as a USER INPUT (target or committed), never a solved output. Base for the one-time fund structure fee. Deliberately not derived from equity plus debt, which would move with the funding solve and make the fee circular.';

COMMENT ON COLUMN refm_fund_terms.facility_limit IS
  'Debt facility LIMIT as a user input, not the drawn balance. Base for the one-time debt arranging fee. The limit is fixed up front; the drawn balance moves with the funding solve.';

COMMENT ON COLUMN refm_fund_terms.fund_management_fee_pct IS
  'Annual fund management fee, charged on OPENING (beginning of period) NAV so the fee is known before the period cash moves. Never closing or average NAV, both of which are circular.';

COMMENT ON COLUMN refm_fund_terms.custody_admin_fee_pct IS
  'Annual custody and administration fee, charged on OPENING NAV, same rationale as fund_management_fee_pct.';

COMMENT ON COLUMN refm_fund_terms.fee_distribution IS
  'jsonb matrix [{partyId, partyName, performanceFeePct, developerFeePct, commissionPct}] splitting each fee type across the project parties (refm_parties). partyId links, partyName is snapshotted so a renamed or deleted party never blanks a saved row. Shares validated in-app.';

COMMIT;

-- Verification after applying (behavioural, not a grep of this file):
--   1. An existing row must still read, with every new column defaulted to 0
--      and fee_distribution defaulted to [].
--   2. UPDATE fund_management_fee_pct = 1.5 must FAIL with 23514.
--   3. UPDATE fund_size = -1 must FAIL with 23514.
--   4. A fee_distribution jsonb array must round-trip with partyId and
--      partyName intact.
--   5. Re-running this whole migration must be a no-op (no error, no
--      duplicate constraint).
