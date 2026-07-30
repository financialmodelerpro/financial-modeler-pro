-- 202_refm_module7_features.sql
--
-- Follow-up to 201. Migration 201 corrected the REFM Module 7 name, short_name
-- and description from the pre-swap "Reports" to "IC Presentation Builder", but
-- left platform_modules.features untouched, so the module still carried the old
-- Reports feature bullets:
--
--   ["IC deck PDF export",
--    "Lender package with debt service schedules",
--    "Portfolio one-pager",
--    "Custom report builder"]
--
-- The public marketing page renders those as the tab chips under each module
-- card (app/modeling/[slug]/page.tsx maps features -> tabs), so Module 7 was
-- advertising capabilities that are not what M7 is: the Lender Package and
-- Investor One-Pager report types are PARKED, and there is no "custom report
-- builder". This replaces them with what the IC Presentation Builder actually
-- ships, matching the tab list in the platforms.ts marketing fallback.
--
-- Display/content only. No gating, no entitlement, no engine impact. The slug
-- stays 'reports' for the same reason as in 201: SLUG_TO_COMPONENT_NUMBER maps
-- 'reports' -> 7 -> the module_7 feature key.
--
-- Idempotent: the UPDATE is a no-op once features already match.

DO $$
DECLARE
  target jsonb := '["Slide navigator and 16:9 canvas editor",
                    "Every KPI, chart and table linked live to the model",
                    "Full year-by-year schedules across all statements",
                    "Editable PowerPoint export",
                    "Bookmarked PDF export"]'::jsonb;
BEGIN
  IF to_regclass('public.platform_modules') IS NULL THEN
    RAISE NOTICE '202: platform_modules table absent, nothing to do';
    RETURN;
  END IF;

  UPDATE public.platform_modules
     SET features   = target,
         updated_at = now()
   WHERE platform_slug = 'real-estate'
     AND number = 7
     AND features IS DISTINCT FROM target;

  IF NOT FOUND THEN
    RAISE NOTICE '202: REFM module 7 features already correct, no rows updated';
  END IF;
END $$;
