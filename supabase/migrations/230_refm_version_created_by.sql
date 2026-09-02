-- ============================================================
--  230_refm_version_created_by.sql
--
--  WHO SAVED THIS VERSION. One nullable column, additive, no data change.
--
--  Module 10 Collaboration, step 1. Deliberately the smallest useful step and
--  deliberately INDEPENDENT of everything after it: it needs no membership, no
--  roles and no lock, and it is worth having on a single-user account on its
--  own. Until now `refm_project_versions` carried no author at all, so the
--  platform could not answer "who saved this" even for one user.
--
--  ── WHY NULLABLE, AND WHY IT STAYS NULLABLE ───────────────────────────────
--
--  Every existing version row predates this column, and there is no honest way
--  to fill it. The project's `user_id` is the OWNER TODAY, which is not the
--  same claim as "this person saved this version": ownership can change, and
--  from step 2 a project will have several people who can save. Backfilling
--  from `refm_projects.user_id` would manufacture an audit trail, and an
--  invented author is worse than an absent one, because it reads as evidence.
--
--  So NULL means exactly "saved before authorship was recorded", every reader
--  renders that as unknown rather than guessing, and the column is never made
--  NOT NULL.
--
--  ── ON DELETE SET NULL, NOT CASCADE ───────────────────────────────────────
--
--  A version must survive its author's account being deleted. CASCADE here
--  would delete a project's history because a former colleague closed their
--  account, which is data loss triggered by an unrelated event. SET NULL keeps
--  the version and drops only the attribution, which degrades to the same
--  "unknown author" state the pre-230 rows already use, so there is exactly
--  one way to be authorless rather than two.
--
--  (This is the mig-219 reasoning applied to versions: the record is retained,
--  the link to the deleted user is released.)
--
--  Note the interaction that is NOT changed: `refm_projects.user_id` is
--  ON DELETE CASCADE, so deleting an OWNER still removes their projects and
--  their versions with them. SET NULL protects the case that matters after
--  step 2: a MEMBER who authored a version leaves, and the owner's project
--  history stays intact.
--
--  Apply with: npx tsx scripts/apply-migration-230.ts --apply
--  Idempotent. Safe to re-run. No em dashes.
-- ============================================================

BEGIN;

ALTER TABLE refm_project_versions
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- Guarded so a re-run does not error, and so the FK is added only once.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.refm_project_versions'::regclass
      AND conname = 'refm_project_versions_created_by_fkey'
  ) THEN
    ALTER TABLE refm_project_versions
      ADD CONSTRAINT refm_project_versions_created_by_fkey
      FOREIGN KEY (created_by)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN refm_project_versions.created_by IS
  'The user who SAVED this version. NULL means the version predates authorship being recorded (migration 230) or its author has since deleted their account; both render as an unknown author, never as the project owner. Deliberately never backfilled: refm_projects.user_id is who owns the project TODAY, which is a different claim, and from Module 10 step 2 a project has several people who can save.';

-- The version list is read per project, newest first, and the author is shown
-- beside each row; this keeps that read from touching the users table twice.
CREATE INDEX IF NOT EXISTS idx_refm_versions_created_by
  ON refm_project_versions (created_by)
  WHERE created_by IS NOT NULL;

COMMIT;
