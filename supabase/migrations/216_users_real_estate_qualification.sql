-- 216_users_real_estate_qualification.sql
-- Signup qualification, 2026-08-20: WHO IS ACTUALLY IN THE INDUSTRY.
--
-- Two answers taken at registration so a pending trial request can be
-- qualified BEFORE it is approved, rather than after somebody has already
-- been given the platform:
--
--   works_in_real_estate   yes / no. Deliberately NULLABLE BOOLEAN and not
--                          `boolean not null default false`, because there
--                          are three states and they are different: yes, no,
--                          and "registered before this question existed".
--                          Defaulting the third to false would silently
--                          record an answer nobody gave, and the admin list
--                          filters on this, so it would filter on a fiction.
--   real_estate_role_note  short free text, what they do. Shown IN FULL on
--                          the request card, so nothing here is truncated at
--                          the database.
--
-- ADDITIVE AND NON-DESTRUCTIVE. No column is dropped, nothing moves, and
-- every existing row keeps NULL for both, which reads as "not asked".
--
-- The registration route is schema-tolerant in the same way it is for
-- company / job_title (mig 172): if these columns are not yet applied it
-- retries without them, so a deploy landing before this migration does not
-- break signup.
--
-- Deliberately NOT added to `trial_requests`. That table already snapshots
-- company and job_title, which is a duplicate of the same answer in two
-- places; the request card reads these two from the user row instead, so
-- there is one copy and it cannot drift. See CLAUDE-REFM.md 2026-08-20g.

ALTER TABLE users ADD COLUMN IF NOT EXISTS works_in_real_estate  boolean;
ALTER TABLE users ADD COLUMN IF NOT EXISTS real_estate_role_note text;

COMMENT ON COLUMN users.works_in_real_estate IS
  'Signup qualification: is the user actively working in the real estate industry. NULL means the question was never asked (registered before 2026-08-20), which is distinct from a deliberate false.';

COMMENT ON COLUMN users.real_estate_role_note IS
  'Signup qualification: short free text describing what the user does. Shown in full on the pending trial request card and on the admin user record.';

-- The admin user list filters and sorts on the yes/no, so it gets an index.
-- Partial on NOT NULL: the rows that carry no answer are the ones nobody
-- filters for, and excluding them keeps the index small.
CREATE INDEX IF NOT EXISTS idx_users_works_in_real_estate
  ON users (works_in_real_estate)
  WHERE works_in_real_estate IS NOT NULL;
