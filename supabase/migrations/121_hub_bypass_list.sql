-- ============================================================
-- 121: Training Hub Coming-Soon bypass list
--
-- A comma-separated list of identifiers (emails OR registration
-- IDs, case-insensitive) that are allowed to sign in even while
-- the Training Hub is in Coming Soon mode. Purpose: the platform
-- owner + a small set of testers need to validate the authed UI
-- before launch without flipping the hub state for every visitor.
--
-- Modeling Hub already has an equivalent: NextAuth's admin role
-- skips the CS gate in authorize(). Training Hub uses a custom
-- cookie-based session with no role field, so this per-identifier
-- allowlist fills the same gap.
--
-- Editable from the DB; Admin UI to manage this list can be added
-- later. Match is case-insensitive so regIDs can be stored in any
-- case.
-- ============================================================

INSERT INTO training_settings (key, value) VALUES
  ('training_hub_bypass_list', 'ahmaddin.ch@gmail.com,FMP-2026-0001')
ON CONFLICT (key) DO NOTHING;
