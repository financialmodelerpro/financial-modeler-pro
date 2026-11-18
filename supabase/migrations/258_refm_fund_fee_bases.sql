-- ═══════════════════════════════════════════════════════════════════════════════
-- 258: the fund structure and debt arranging fees each choose their basis
-- (founder, 2026-11-18)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Two columns on refm_fund_terms, the Fund Terms tab's durable store:
--   structure_fee_basis  'fund_size' (default: debt + equity funding need)
--                        or 'total_development_cost' (excl. IDC)
--   arranging_fee_basis  'total_facility' (default: capex debt + IDC)
--                        or 'debt_share_cash_cost' (debt share x cash development cost)
--
-- ADDITIVE and idempotent; drops nothing. The defaults are the platform's
-- defaults, so every existing row reads exactly as before.
--
-- The application works before this is applied: the server reads in tiers
-- (258 -> 215 -> 211 -> 210 -> 209 -> 208) and steps down on a missing column,
-- and the choice rides in the version snapshot, which is what the engine reads
-- (the table only fills a snapshot that carries no fund terms at all).

ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS structure_fee_basis TEXT NOT NULL DEFAULT 'fund_size'
  CHECK (structure_fee_basis IN ('fund_size', 'total_development_cost'));

ALTER TABLE refm_fund_terms
  ADD COLUMN IF NOT EXISTS arranging_fee_basis TEXT NOT NULL DEFAULT 'total_facility'
  CHECK (arranging_fee_basis IN ('total_facility', 'debt_share_cash_cost'));

COMMENT ON COLUMN refm_fund_terms.structure_fee_basis IS
  'fund_size = the debt plus equity funding need with no fund fee in it (default); total_development_cost = capex including all land, excluding capitalised interest.';
COMMENT ON COLUMN refm_fund_terms.arranging_fee_basis IS
  'total_facility = the capex debt plus the interest capitalised on it, fee-free (default); debt_share_cash_cost = the debt share x the capex paid in cash.';
