-- 210_refm_fund_manager.sql
-- Fund layer: the Fund Manager entity + the facility-limit override flag.
--
-- ADDITIVE ONLY. Two ADD COLUMN IF NOT EXISTS, nothing dropped, nothing
-- renamed, no existing value rewritten. Idempotent. A project with
-- fund_enabled = false is unaffected, as always.
--
-- WHY THE FUND MANAGER IS NOT A PARTY. Migration 190's refm_parties holds the
-- counterparties of the PROJECT: sponsor, developer, investors, lender. The
-- Fund Manager only exists when the fund layer is switched on, so putting it in
-- refm_parties would mean every standalone project carried a party that its
-- model has no concept of. It lives here, beside the terms that create it.
--
-- WHY ONLY A NAME. The Fund Manager earns:
--   * 100% of every fund management fee (structure, management, custody and
--     admin, debt arranging, other expenses), unsplit, so there is no share to
--     store: the entitlement is total by definition.
--   * its own share of the performance fee, developer fee and commission,
--     which is a ROW in the existing fee_distribution jsonb (migration 209)
--     carrying the reserved party id '__fund_manager__'. That keeps the matrix
--     one uniform structure keyed by party id rather than a special case, and
--     the reserved id is what tells the two apart.
-- So the only new fact is what the Fund Manager is CALLED.
--
-- THE FACILITY LIMIT OVERRIDE. The debt arranging fee charges on the facility
-- LIMIT. That limit is now read from the model where the model states one (a
-- tranche's absolute principal, else its LTV cap applied to capex), because
-- asking a user to retype a number the model already holds is how the two drift
-- apart. Both sources are INPUTS: the drawn balance is a solved output and is
-- never used. `facility_limit_override` lets a user pin the typed
-- `facility_limit` (migration 209) when the model's figure is not the one the
-- fee is actually charged on.
--
-- Reads stay schema-tolerant: the server probes for these columns and falls
-- back, so the Fund Terms tab keeps working before this is applied.
BEGIN;

ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS fund_manager_name text NOT NULL DEFAULT 'Fund Manager';

ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS facility_limit_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN refm_fund_terms.fund_manager_name IS
  'Display name of the Fund Manager, the entity that earns 100% of the fund management fees and holds the reserved __fund_manager__ row in fee_distribution. Exists only when the fund layer is on; deliberately NOT a refm_parties row, since a standalone project has no such counterparty.';

COMMENT ON COLUMN refm_fund_terms.facility_limit_override IS
  'When true, the typed facility_limit wins over the limit resolved from the model (a tranche stated principal, else its LTV cap applied to capex). Both model sources are INPUTS; the drawn balance is a solved output and is never used as a fee base.';

COMMIT;

-- Verification after applying (behavioural, not a grep of this file):
--   1. An existing row still reads, with fund_manager_name defaulting to
--      'Fund Manager' and facility_limit_override to false.
--   2. A fee_distribution array containing a row with
--      partyId = '__fund_manager__' round-trips intact.
--   3. Re-running this migration is a clean no-op.
