-- 154_refm_modules_live_status.sql
--
-- Bring the public REFM module roadmap in line with reality: Modules 1 to 5 are
-- built and live. Updates the seeded rows from 150_p_sync_platform_modules.sql.
--
--   - Modules 2 to 5 status -> 'live'.
--   - Order (number + display_order) normalised to:
--       1 Project Setup, 2 Revenue, 3 Operating Expenses,
--       4 Financial Statements, 5 Returns and Valuation.
--     Financial Statements (slug 'financials') comes before Returns (slug 'returns').
--   - Modules 6 to 11 stay 'coming_soon', untouched.
--
-- Rows are UPDATED by their stable (platform_slug, slug) key. No delete + reinsert.
-- The number column carries a UNIQUE (platform_slug, number) constraint, so the
-- 1 to 5 range is first parked in a temporary high range to avoid a transient
-- collision while financials and returns swap positions, then set to final
-- values. Idempotent: re-running lands on the same final state.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'platform_modules'
    ) THEN
        RAISE NOTICE 'platform_modules table not present; skipping (run 150 first).';
        RETURN;
    END IF;

    -- Step 1: park the five module numbers in a temp range to clear the 1 to 5
    -- slots before reassigning (guards the UNIQUE (platform_slug, number)).
    UPDATE public.platform_modules
       SET number = number + 100
     WHERE platform_slug = 'real-estate'
       AND slug IN ('project-setup', 'revenue', 'opex', 'financials', 'returns');

    -- Step 2: set final number, display_order, and status by stable slug key.
    UPDATE public.platform_modules
       SET number = 1, display_order = 1
     WHERE platform_slug = 'real-estate' AND slug = 'project-setup';

    UPDATE public.platform_modules
       SET number = 2, display_order = 2, status = 'live'
     WHERE platform_slug = 'real-estate' AND slug = 'revenue';

    UPDATE public.platform_modules
       SET number = 3, display_order = 3, status = 'live'
     WHERE platform_slug = 'real-estate' AND slug = 'opex';

    UPDATE public.platform_modules
       SET number = 4, display_order = 4, status = 'live'
     WHERE platform_slug = 'real-estate' AND slug = 'financials';

    UPDATE public.platform_modules
       SET number = 5, display_order = 5, status = 'live'
     WHERE platform_slug = 'real-estate' AND slug = 'returns';
END $$;
