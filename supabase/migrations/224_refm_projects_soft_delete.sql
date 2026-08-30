-- 224_refm_projects_soft_delete.sql
--
-- Soft delete for user project deletion (2026-08-30). ADDITIVE ONLY: one
-- nullable column plus two indexes. No data change, no drop, nothing existing
-- is altered, and every existing row reads as "not deleted" (NULL).
--
-- WHY, and how it differs from ARCHIVE (which is unchanged):
--   * archived = reversible, VISIBLE to the user, view-only, frees the cap.
--     The user manages it themselves and it never expires.
--   * deleted_at = the project leaves the user's world entirely: hidden from
--     the dashboard and the project list, out of the cap, and hard deleted
--     with its whole cascade (versions + change log, report decks and deck
--     versions, fund terms, parties) once the retention window has passed.
--     Until then the row and every version still exist, so a mistake is
--     recoverable rather than permanent.
--   The two are INDEPENDENT: a project may be archived and then deleted, and
--   a restore returns it to whatever archived state it had.
--
-- Retention is RETENTION_DAYS in src/shared/admin/projectSources.ts (30), the
-- ONE definition; nothing in SQL hardcodes the window. The purge runs from the
-- existing daily apply-scheduled-changes cron (Vercel Hobby: a new cron entry
-- is a deploy risk, and a scheduled hard delete IS a scheduled change).
--
-- Registry driven: ERM and BVM inherit this by adding `deletedColumn` to their
-- entry in PROJECT_SOURCES once their project tables exist, with a column of
-- the same shape.

ALTER TABLE refm_projects
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The user list and the cap count both filter on "not deleted"; a partial
-- index keeps that the cheap path on the common case.
CREATE INDEX IF NOT EXISTS idx_refm_projects_live
  ON refm_projects (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- The purge scans by deletion age across all users.
CREATE INDEX IF NOT EXISTS idx_refm_projects_deleted_at
  ON refm_projects (deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN refm_projects.deleted_at IS
  'Soft delete timestamp (mig 224, 2026-08-30). NULL = live. Non-null hides the project from the user (dashboard, project list, project cap) and starts the retention clock; the daily purge hard deletes past RETENTION_DAYS (src/shared/admin/projectSources.ts). Independent of `archived`, which stays a visible, user-reversible, never-expiring state.';
