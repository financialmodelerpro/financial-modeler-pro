-- ============================================================
--  186_platform_modules_include_in_pdf.sql
--  Add a per-module "include in PDF export" flag to platform_modules (mig 150),
--  so the admin controls which modules a user may pick in the PDF Full Financial
--  Model export. This is a DISPLAY / export-scope flag only: it never touches
--  entitlements, the gate, or the sidebar (those read status / gating_tier).
--
--    - include_in_pdf : true  => the module appears as an export option (a live
--                                module is selectable; a not-yet-live one shows
--                                greyed, mirroring the sidebar).
--                       false => the module is hidden from the export options
--                                entirely (e.g. Reports, Collaborate, API Access,
--                                which are not part of the financial model PDF).
--
--  Default true so existing modules keep appearing. The non-core modules
--  (reports, portfolio, market-data, collaborate, api-access) are seeded OFF as a
--  sensible starting point for the "Full Financial Model" report; the admin can
--  toggle any of them in the Module Manager. Additive column only. Idempotent.
--  Apply manually via the Supabase dashboard. No em dashes.
-- ============================================================

ALTER TABLE platform_modules
  ADD COLUMN IF NOT EXISTS include_in_pdf BOOLEAN NOT NULL DEFAULT true;

-- Seed the non-core (non financial-model) modules OFF for the real-estate
-- platform. Keyed by the stable slug so re-running is safe and numbering-neutral.
UPDATE platform_modules
  SET include_in_pdf = false
  WHERE platform_slug = 'real-estate'
    AND slug IN ('reports', 'portfolio', 'market-data', 'collaborate', 'api-access');
