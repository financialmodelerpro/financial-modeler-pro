-- ============================================================
--  232_refm_member_ordering.sql
--
--  ORDERING AND URGENCY BECOME PER USER. Module 10 Collaboration, step 3.
--
--  `refm_projects.sort_order` and `refm_projects.priority` (migration 229) are
--  one value per PROJECT. That was correct while a project had exactly one
--  owner and is wrong the moment it has members: two people would fight over
--  one column, and the second to drag would silently rearrange the first one's
--  page. Both move to `refm_project_members`, which is exactly the scope of
--  "my order" and "urgent to me".
--
--  ── STATUS DOES NOT MOVE ──────────────────────────────────────────────────
--
--  `refm_projects.status` stays where it is, and stays one value per project.
--  It is a property of the PROJECT: a building under construction is under
--  construction for everyone looking at it. Ordering and urgency are properties
--  of the RELATIONSHIP between a person and a project, which is why they move
--  and status does not. Do not "finish the job" by moving status too.
--
--  ── NOTHING TO MIGRATE, AND THAT WAS MEASURED ─────────────────────────────
--
--  Probed on production immediately before writing this (2026-09-02): 4
--  projects, none archived, none soft deleted, `sort_order IS NOT NULL` on ZERO
--  rows and `priority IS TRUE` on ZERO rows. Nobody has dragged a card or
--  flagged one since 229 shipped, so this is a schema change with no data
--  behind it and no copy step. The guard below re-checks that at apply time
--  rather than trusting the measurement: if anyone has ordered or flagged a
--  project in the meantime, this migration REFUSES rather than silently
--  stranding their arrangement on a column nothing reads any more.
--
--  ── THE OLD COLUMNS ARE DEPRECATED, NOT DROPPED ───────────────────────────
--
--  They keep their data (there is none), keep their index, and gain a COMMENT
--  saying what replaced them. Dropping a column is the one migration that
--  cannot be undone by a later one, and the platform reads these through a
--  schema-tolerant fallback: on a database with 229 but not 232 the code still
--  reads them, so removing them would break exactly the deployment order this
--  repo is careful about. They can be dropped later, deliberately, once no
--  deployed build reads them.
--
--  Apply with: npx tsx scripts/apply-migration-232.ts --apply
--  Idempotent. Safe to re-run. No em dashes.
-- ============================================================

BEGIN;

-- ── 1. Refuse if anyone has ordered or flagged a project. ────────────────
DO $$
DECLARE
  ordered_count integer;
  flagged_count integer;
BEGIN
  SELECT count(*) FILTER (WHERE sort_order IS NOT NULL),
         count(*) FILTER (WHERE priority IS TRUE)
    INTO ordered_count, flagged_count
    FROM refm_projects;
  IF ordered_count > 0 OR flagged_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to move ordering to the membership row: % project(s) carry a manual order and % carry an urgent flag. Moving now would strand that arrangement on columns nothing reads. Copy it to refm_project_members first (one row per OWNER), then re-run.',
      ordered_count, flagged_count;
  END IF;
END $$;

-- ── 2. The per-member columns, same shapes and same meanings as 229's. ───
ALTER TABLE refm_project_members
  ADD COLUMN IF NOT EXISTS priority boolean NOT NULL DEFAULT false;

ALTER TABLE refm_project_members
  ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN refm_project_members.priority IS
  'This MEMBER''s urgent flag for this project. One flag, not a scale. Per person: a project one member finds urgent is not urgent for everyone. Sorts within a status group, never across one (migration 232, replacing refm_projects.priority).';

COMMENT ON COLUMN refm_project_members.sort_order IS
  'This MEMBER''s manual card position WITHIN the project''s status group. NULL means never dragged, and those fall back to recency; nullable on purpose so an un-dragged project stays distinguishable from one dragged to position 0 (migration 232, replacing refm_projects.sort_order).';

-- The card query reads one member's whole list in group / priority / manual
-- order, so the index leads with the member.
CREATE INDEX IF NOT EXISTS idx_refm_members_card_order
  ON refm_project_members (user_id, priority DESC, sort_order);

-- ── 3. Deprecate the project-level columns. Kept, not dropped. ───────────
COMMENT ON COLUMN refm_projects.priority IS
  'DEPRECATED (migration 232). Superseded by refm_project_members.priority, because urgency is a property of a PERSON''s relationship to a project, not of the project. Retained, not dropped: a database with 229 but not 232 still reads it through the schema-tolerant fallback. Nothing writes it. Do not reintroduce a reader.';

COMMENT ON COLUMN refm_projects.sort_order IS
  'DEPRECATED (migration 232). Superseded by refm_project_members.sort_order, because a manual order is per person and two members would otherwise overwrite each other''s arrangement. Retained, not dropped: a database with 229 but not 232 still reads it through the schema-tolerant fallback. Nothing writes it. Do not reintroduce a reader.';

-- refm_projects.status is deliberately untouched: it is a property of the
-- project and stays one value for everyone. See the header.

COMMIT;
