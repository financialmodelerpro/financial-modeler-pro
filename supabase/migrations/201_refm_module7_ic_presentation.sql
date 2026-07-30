-- 201_refm_module7_ic_presentation.sql
--
-- Corrects the REFM Module 7 row in platform_modules.
--
-- Background: Module 6 and Module 7 were swapped when Scenario Analysis shipped
-- (M6 used to be "Reports"). The row at position 6 was renamed to
-- "Scenario Analysis" at that time, but position 7 kept the old "Reports" name,
-- so the public marketing page, the admin panel and the workspace sidebar (all
-- three read platform_modules) showed "Module 7: Reports" while the canonical
-- code list in src/hubs/modeling/platforms/refm/lib/modules-config.ts had
-- Module 7 as the IC Presentation Builder.
--
-- This is a DISPLAY/CONTENT correction only. It touches no gating: the feature
-- key (module_7) and gating_tier are unchanged, and no entitlement, plan or
-- engine behaviour depends on the display name of this row.
--
-- The SLUG IS DELIBERATELY LEFT AS 'reports'. Entitlement gating resolves the
-- feature key through SLUG_TO_COMPONENT_NUMBER in
-- src/shared/entitlements/moduleCatalog.ts, which maps 'reports' -> 7 -> the
-- module_7 feature key. Renaming the slug here would silently drop that row out
-- of the lookup (it would fall through to the number, which happens to be 7
-- today, but only by luck). Names are display; the slug is an identifier.
--
-- Idempotent: matched on number = 7 for the real-estate platform, and safe to
-- re-run. Guarded so it cannot fail on an environment where the row is already
-- correct, is absent, or where the table does not exist yet.

DO $$
BEGIN
  IF to_regclass('public.platform_modules') IS NULL THEN
    RAISE NOTICE '201: platform_modules table absent, nothing to do';
    RETURN;
  END IF;

  UPDATE public.platform_modules
     SET name        = 'IC Presentation Builder',
         short_name  = 'Presentation',
         description = 'A PowerPoint-style slide editor whose figures stay linked to the model, '
                       'so the investment committee deck updates itself as Modules 1 to 6 change. '
                       'Exports to editable PowerPoint and PDF.',
         updated_at  = now()
   WHERE platform_slug = 'real-estate'
     AND number = 7
     AND name IS DISTINCT FROM 'IC Presentation Builder';

  IF NOT FOUND THEN
    RAISE NOTICE '201: REFM module 7 already correct or not present, no rows updated';
  END IF;
END $$;
