-- ============================================================
--  231_refm_project_members.sql
--
--  PROJECT MEMBERSHIP. Module 10 Collaboration, step 2: the pivot.
--
--  One table. Every existing project gains exactly one Owner row, so nothing
--  changes for a single-user account: the person who could see a project
--  before is its Owner after, with the same rights.
--
--  ── THIS BACKFILL IS LEGITIMATE, UNLIKE MIGRATION 230's ───────────────────
--
--  230 refused to fill `created_by` from `refm_projects.user_id`, because that
--  column says who OWNS the project today, which is a different claim from who
--  SAVED a particular version. Here the claim being written is exactly the one
--  the column already makes: `user_id` IS the owner. So seeding one Owner
--  membership per project restates a fact rather than inventing one, and it is
--  the only way the switch from an owner check to a membership check can be
--  invisible to existing users.
--
--  `refm_projects.user_id` STAYS, and stays authoritative for ownership. It is
--  not replaced by this table: it drives the project cap, the soft-delete
--  purge, the admin browser and the FK cascade. Membership says who else can
--  reach the project, and with what rights.
--
--  ── ROLE VOCABULARY ───────────────────────────────────────────────────────
--
--  owner | editor | reviewer | viewer, matching `src/core/collab/projectRoles.ts`
--  exactly. NOT 'admin': `users.role = 'admin'` is the PLATFORM administrator,
--  a property of the user, and a project role must never be able to spell it
--  (see the note at the top of projectRoles.ts, and migration 229 for what
--  happens when one word means two things).
--
--  ── CASCADES, EACH CHOSEN ─────────────────────────────────────────────────
--
--  project_id -> refm_projects   CASCADE. A membership of a deleted project is
--                                meaningless; there is nothing to be a member
--                                of. Note refm_projects rows are hard deleted
--                                only by the mig-224 purge, so a SOFT deleted
--                                project keeps its members and a restore keeps
--                                the team intact.
--  user_id    -> users           CASCADE. A membership of a deleted account is
--                                meaningless. This deletes the ROW, not the
--                                project: an owner's projects are already
--                                removed by refm_projects.user_id's own
--                                CASCADE, and a member leaving takes only
--                                their access.
--  added_by   -> users           SET NULL. Who granted access is an audit
--                                fact that must outlive the granter, exactly
--                                as version authorship does (mig 230).
--
--  ── ONE ROW PER PERSON PER PROJECT ────────────────────────────────────────
--
--  The primary key is (project_id, user_id). Two rows for one person on one
--  project would mean two roles, and every reader would have to pick one; the
--  database refuses the situation instead.
--
--  Apply with: npx tsx scripts/apply-migration-231.ts --apply
--  Idempotent. Safe to re-run. No em dashes.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS refm_project_members (
  project_id  uuid        NOT NULL REFERENCES refm_projects(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'viewer'
                          CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer')),
  added_by    uuid        REFERENCES users(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

COMMENT ON TABLE refm_project_members IS
  'Who can reach a project, and with what rights (migration 231, Module 10 step 2). One row per person per project. refm_projects.user_id REMAINS authoritative for ownership and still drives the project cap, the purge and the FK cascade; this table says who ELSE can reach it. Roles match src/core/collab/projectRoles.ts and deliberately cannot spell "admin", which is a platform-wide property of a user, not a project role.';

-- The membership lookup is "what is this user's role on this project", which
-- the primary key already serves. This index serves the other direction,
-- "which projects can this user reach", which the project list needs.
CREATE INDEX IF NOT EXISTS idx_refm_members_user
  ON refm_project_members (user_id, project_id);

-- ── Seed one Owner row per existing project. ─────────────────────────────
--
-- ON CONFLICT DO NOTHING so a re-run is a no-op and so an already-adjusted
-- membership is never overwritten back to owner. Soft-deleted projects are
-- INCLUDED deliberately: they can be restored by an admin (mig 224), and a
-- restored project with no owner would be unreachable by anyone.
INSERT INTO refm_project_members (project_id, user_id, role, added_by)
SELECT p.id, p.user_id, 'owner', p.user_id
FROM refm_projects p
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── Guard: every project must end up with exactly one owner. ─────────────
--
-- If this fails, the switch from an owner check to a membership check would
-- silently make some project unreachable by the person who owns it, which is
-- the one outcome this step must never produce. Refusing the transaction is
-- the correct response; a partially seeded membership table is worse than no
-- membership table.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM refm_projects p
  WHERE NOT EXISTS (
    SELECT 1 FROM refm_project_members m
    WHERE m.project_id = p.id AND m.user_id = p.user_id AND m.role = 'owner'
  );
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to complete: % project(s) have no owner membership after seeding. Switching to a membership check would make them unreachable by their owner.',
      orphan_count;
  END IF;
END $$;

COMMIT;
