-- ═══════════════════════════════════════════════════════════════════════════════
-- 153: REFM auto version naming + required comment (2026-06-01)
-- ═══════════════════════════════════════════════════════════════════════════════
-- The version-creation flow now auto-generates the version name and requires a
-- per-version comment explaining what changed. Three additive columns on
-- refm_project_versions (all nullable so existing rows are untouched):
--
--   version_label  text   the major.minor string, e.g. "1.5". Auto-managed
--                         (v1.0 -> v1.1 -> ... -> v1.9 -> v2.0). The numeric
--                         `version_number` column stays as the sequential row
--                         counter; this is the user-facing X.Y label.
--   task_name      text   short task label entered by the user (max 50 chars,
--                         letters / numbers / spaces / underscores). Part of
--                         the generated version name.
--   comment        text   required free-text note (max 1000 chars) describing
--                         what changed in this version.
--
-- The generated version name itself
--   ({ProjectName}_v{version_label}_{MMDDYYYY}_{task_name})
-- is stored in the existing `label` column, so no new column is needed for it.
--
-- Additive + idempotent: safe to re-run, and existing versions (label/comment
-- NULL) keep working. The server tolerates these columns being absent until the
-- migration is applied (try-FULL-first, fall back to BASE), per the project's
-- manual-migration convention.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE refm_project_versions
  ADD COLUMN IF NOT EXISTS version_label text,
  ADD COLUMN IF NOT EXISTS task_name     text,
  ADD COLUMN IF NOT EXISTS comment       text;
