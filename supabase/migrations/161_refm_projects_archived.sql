-- ============================================================
--  161_refm_projects_archived.sql
--  Project archive flag for the entitlement project cap.
--  ADDITIVE ONLY: adds one boolean column, alters/drops nothing.
--
--  The project cap counts ACTIVE (non-archived) projects only. Archiving
--  frees a slot without deleting any data; archived projects are view-only
--  until unarchived (enforced in the API choke points: versions POST +
--  project PATCH). Unarchive is treated exactly like create (must fit under
--  the cap).
--
--  This is a DEDICATED flag, intentionally separate from the existing
--  refm_projects.status enum value 'Archived' (a workflow status). The two
--  concepts never conflate: a project can be workflow-status 'Approved' yet
--  archived for cap purposes, or vice versa. Resolution + cap counting use
--  THIS column only.
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

ALTER TABLE refm_projects
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- Partial index to make the active-count query (WHERE user_id = ? AND
-- archived = false) cheap as histories grow.
CREATE INDEX IF NOT EXISTS refm_projects_active_idx
  ON refm_projects (user_id)
  WHERE archived = false;
