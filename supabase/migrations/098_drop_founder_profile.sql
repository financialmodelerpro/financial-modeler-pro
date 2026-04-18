-- ============================================================================
-- Migration 098 — Drop legacy founder_profile table
-- ----------------------------------------------------------------------------
-- All founder data now lives in page_sections (section_type='team' on the
-- home page). The old key-value table is no longer read or written by any
-- part of the application after the Page Builder team section replaced the
-- standalone /admin/founder editor.
--
-- Run this AFTER the code deploy that removes:
--   - app/admin/founder/
--   - app/api/admin/founder/
--   - getFounderProfile() from src/lib/shared/cms.ts
--   - All callers of getFounderProfile() in the three consumer pages.
--
-- CASCADE is used for defensive safety — the table has no foreign-key
-- dependents in the current schema, but the flag is included in case a
-- stale policy or view references it.
-- ============================================================================

DROP TABLE IF EXISTS founder_profile CASCADE;
