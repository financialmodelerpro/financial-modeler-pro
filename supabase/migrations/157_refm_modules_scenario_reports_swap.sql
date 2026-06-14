-- 157_refm_modules_scenario_reports_swap.sql
--
-- Module 6 is now Scenario Analysis (built + live), Module 7 is Reports (stub).
-- The seeded platform_modules rows (150) had the prior order 6 Reports /
-- 7 Scenarios, which no longer matches the platform (modules-config.ts was
-- swapped to module6 = Scenario Analysis, module7 = Reports). This brings the
-- public roadmap + admin catalog (and the marketing /modeling-hub pages that
-- read the same table) in line:
--
--   - 'scenarios' -> number 6, display_order 6, status 'live', name 'Scenario Analysis'.
--   - 'reports'   -> number 7, display_order 7, status 'coming_soon', name 'Reports'.
--
-- Rows are UPDATED by their stable (platform_slug, slug) key (no delete +
-- reinsert). The number column carries a UNIQUE (platform_slug, number)
-- constraint, so the two rows are first parked in a temp high range to clear
-- slots 6 + 7 before the swap, then set to final values. Idempotent: re-running
-- lands on the same final state.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'platform_modules'
    ) THEN
        RAISE NOTICE 'platform_modules table not present; skipping (run 150 first).';
        RETURN;
    END IF;

    -- Step 1: park both numbers in a temp range to free slots 6 + 7 (guards the
    -- UNIQUE (platform_slug, number) while the two rows swap positions).
    UPDATE public.platform_modules
       SET number = number + 100
     WHERE platform_slug = 'real-estate'
       AND slug IN ('reports', 'scenarios');

    -- Step 2: Module 6 = Scenario Analysis (live).
    UPDATE public.platform_modules
       SET number = 6, display_order = 6, status = 'live',
           name = 'Scenario Analysis', short_name = 'Scenarios',
           description = 'Per-case input overrides on the base model with a side-by-side comparison matrix across scenarios.',
           features = '[
              "Management base case plus Downside / Upside scenarios",
              "Override any input per case; financials recompute on the active case",
              "Side-by-side KPI comparison with deltas vs the base case",
              "Base model never changes; overrides apply only to the active case"
           ]'::jsonb
     WHERE platform_slug = 'real-estate' AND slug = 'scenarios';

    -- Step 3: Module 7 = Reports (stub).
    UPDATE public.platform_modules
       SET number = 7, display_order = 7, status = 'coming_soon', name = 'Reports'
     WHERE platform_slug = 'real-estate' AND slug = 'reports';
END $$;
