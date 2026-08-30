-- 220_deprecate_legacy_projects.sql
--
-- DEPRECATES the legacy `projects` table. NO DATA CHANGE, NO DROP: this adds
-- a COMMENT and nothing else, guarded so it is a no-op in an environment where
-- the table never existed (it predates this migration log and is created by no
-- migration in this repo).
--
-- Why deprecated rather than dropped:
--   * The table holds zero rows on prod (probed 2026-08-30) and NOTHING in the
--     application reads or writes it any more: the admin Projects Browser was
--     rebuilt against the per-platform project tables via the PROJECT_SOURCES
--     registry (src/shared/admin/projectSources.ts), the CMS overview stat and
--     the profile projectsCount were repointed the same way, and the dead
--     /api/projects CRUD route + useProject hook (its only caller, itself
--     imported nowhere) were removed.
--   * It is kept because dropping a table is irreversible and buys nothing:
--     an empty, unreferenced table costs no space and no correctness, while a
--     drop would be the one operation this cleanup cannot take back.
--   * Real projects live in refm_projects (mig 149); future platforms (ERM,
--     BVM) bring their own tables and join the registry, never this table.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'projects'
  ) THEN
    COMMENT ON TABLE public.projects IS
      'DEPRECATED 2026-08-30. Pre-migration-log artifact, zero rows, no application reader or writer. Real projects live in the per-platform tables (refm_projects, ...) listed in src/shared/admin/projectSources.ts. Kept, not dropped, because a drop is irreversible and an empty unreferenced table is harmless. Do not add new readers or writers.';
  END IF;
END $$;
