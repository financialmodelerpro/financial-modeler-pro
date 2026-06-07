-- 156_refm_modules_clean_names.sql
--
-- The public REFM page renders each card title as "Module {number}: {name}".
-- Several platform_modules rows have a stale "Module N" prefix baked into the
-- name column (hand-edited at some point), so the title doubled, e.g.
--   number 4, name "Module 5, Financials"  ->  "Module 4: Module 5, Financials"
-- (the embedded number was also stale: financials carried "Module 5", returns
-- "Module 4", from before 154 fixed the ordering).
--
-- This strips the leading "Module <n>" prefix (with a ":" / "," / space
-- separator) from the name so the template renders cleanly, e.g.
--   number 4, name "Financials"  ->  "Module 4: Financials".
-- The genuine module name is preserved; only the redundant prefix is removed.
-- Idempotent: a cleaned name no longer matches the prefix, so a re-run no-ops.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'platform_modules'
    ) THEN
        RAISE NOTICE 'platform_modules table not present; skipping (run 150 first).';
        RETURN;
    END IF;

    UPDATE public.platform_modules
       SET name = regexp_replace(name, '^Module\s*\d+\s*[:,]?\s*', '', 'i')
     WHERE platform_slug = 'real-estate'
       AND name ~* '^Module\s*\d+';
END $$;
