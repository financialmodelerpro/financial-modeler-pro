-- ============================================================
--  238_project_delete_requests.sql
--
--  DELETE BECOMES A REQUEST FOR AN EDITOR. Module 10 step 9.
--
--  The Owner keeps direct delete: it is their project and their plan, and it
--  is already a SOFT delete with a 30-day window an admin can restore from.
--  An EDITOR, who today cannot delete at all, gains a way to ASK. Reviewers
--  and Viewers get neither. So this is not a restriction on anybody: it is a
--  new, supervised path for a role that previously had none.
--
--  ── PLATFORM AGNOSTIC, AND THAT COSTS THE FOREIGN KEY ─────────────────────
--
--  `platform` + `project_id` is a POLYMORPHIC reference: the row it points at
--  lives in `refm_projects` today and in ERM's or BVM's table tomorrow.
--  Postgres cannot foreign-key one column at several tables, so there is no FK
--  on project_id and there cannot be one.
--
--  The consequence is that the CASCADE has to be built rather than declared,
--  and it is built with a TRIGGER on the project table rather than in
--  application code. That is deliberate: `refm_projects` rows are deleted by
--  the retention purge, by the admin hard delete, by the create and duplicate
--  rollbacks, AND by the `users` cascade when an account closes. The last one
--  runs entirely inside Postgres, so no application code sees it. Only a
--  trigger catches every route.
--
--  A NEW PLATFORM ADDS ONE TRIGGER, two lines, next to its PROJECT_SOURCES
--  entry. `verify-delete-requests` fails if a platform declares membership and
--  has no cascade trigger, so this cannot be forgotten quietly.
--
--  ── THE REQUESTER OUTLIVES THEIR OWN ACCESS ───────────────────────────────
--
--  `requested_by` is ON DELETE SET NULL, the same reasoning as `created_by` in
--  230 and `version_id` in 234: the FACT that a delete was asked for is true
--  whether or not the asker still has an account. Losing MEMBERSHIP does not
--  touch the row at all (membership lives in another table), so a request
--  raised by someone since removed still stands, and the admin screen shows
--  whether they are still a member rather than hiding it.
--
--  ── ONE OPEN REQUEST PER PROJECT ──────────────────────────────────────────
--
--  The partial unique index is on the PROJECT, not on the requester. Two
--  editors on one project must not be able to queue two deletes for the same
--  thing; the second one joins the first request rather than creating a
--  duplicate the admin has to reconcile. Copied from `trial_requests`, which
--  keys its own partial index on the user because there the user is the
--  subject.
--
--  ── THE DECLINE SURVIVES A LATER APPROVAL ─────────────────────────────────
--
--  `decided_at` / `decided_by` always hold the LATEST decision. `declined_at`,
--  `declined_by` and `decline_reason` are written at decline time and never
--  overwritten, so a row reads "declined by A at T1, approved by B at T2" with
--  both halves intact. Exactly the problem migration 218 had to fix for
--  trial_requests after the fact; it is designed in here instead.
--
--  Apply with: npx tsx scripts/apply-migration-238.ts --apply
--  Idempotent. Safe to re-run. No em dashes.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS project_delete_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform       text        NOT NULL DEFAULT 'refm',
  project_id     uuid        NOT NULL,
  requested_by   uuid                 REFERENCES users(id) ON DELETE SET NULL,
  status         text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'declined')),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at     timestamptz,
  decided_by     uuid                 REFERENCES users(id) ON DELETE SET NULL,
  declined_at    timestamptz,
  declined_by    uuid                 REFERENCES users(id) ON DELETE SET NULL,
  decline_reason text
);

COMMENT ON TABLE project_delete_requests IS
  'An Editor asking for a project to be deleted, for an admin to approve or decline (migration 238, Module 10 step 9). Platform agnostic: platform + project_id is a polymorphic reference, so there is no FK on project_id and the cascade is a per-platform trigger instead. The Owner does not use this table; they delete directly.';

COMMENT ON COLUMN project_delete_requests.requested_by IS
  'Who asked. ON DELETE SET NULL, so the request outlives a closed account: that a delete was asked for stays true. Losing MEMBERSHIP does not touch this row at all; the admin screen shows whether they are still a member.';

COMMENT ON COLUMN project_delete_requests.decline_reason IS
  'Why it was declined, shown to the requester on their own project card. There is no notification system, so this text is the only way they learn the outcome.';

COMMENT ON COLUMN project_delete_requests.declined_at IS
  'When it was declined. Written at decline time and NEVER overwritten, so a later approval leaves both halves readable (decided_at then holds the approval). Migration 218 had to add this to trial_requests after the fact.';

-- ONE OPEN REQUEST PER PROJECT. Two editors must not queue two deletes for the
-- same project; the second joins the first rather than creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS project_delete_requests_one_pending
  ON project_delete_requests (platform, project_id) WHERE status = 'pending';

-- The admin queue reads pending, newest first.
CREATE INDEX IF NOT EXISTS idx_delete_requests_status
  ON project_delete_requests (status, created_at DESC);

-- A project's own card asks "is there a request on me".
CREATE INDEX IF NOT EXISTS idx_delete_requests_project
  ON project_delete_requests (platform, project_id, created_at DESC);

-- ── THE CASCADE, BUILT BECAUSE IT CANNOT BE DECLARED ─────────────────────
--
-- One function, parameterised by the platform key through TG_ARGV, so every
-- platform reuses it and only supplies its own trigger.
CREATE OR REPLACE FUNCTION project_delete_requests_cascade()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM project_delete_requests
   WHERE platform = TG_ARGV[0] AND project_id = OLD.id;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION project_delete_requests_cascade() IS
  'Removes a project''s delete requests when the project row is HARD deleted. A trigger rather than application code because refm_projects rows are also deleted by the users cascade, which runs entirely inside Postgres where no route can see it. TG_ARGV[0] is the platform key, so one function serves every platform.';

DROP TRIGGER IF EXISTS trg_refm_projects_delete_requests ON refm_projects;
CREATE TRIGGER trg_refm_projects_delete_requests
  AFTER DELETE ON refm_projects
  FOR EACH ROW EXECUTE FUNCTION project_delete_requests_cascade('refm');

COMMIT;
