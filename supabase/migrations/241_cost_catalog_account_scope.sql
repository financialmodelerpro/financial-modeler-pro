-- 241_cost_catalog_account_scope.sql
--
-- THE COST CATALOG BELONGS TO THE ACCOUNT (2026-09-05).
--
-- Migration 214 keyed the catalog per USER, the right scope in a world with
-- no accounts: per project would rebuild the list every time, and global
-- would leak one tenant's vocabulary into another. Accounts exist now (mig
-- 239), projects are shared (steps 2-7), and per-user became the defect: two
-- members of one project saw different pickers, and a line could stamp a
-- catalogId its other readers did not hold, degrading its identity to a raw
-- slug. The ACCOUNT is the scope 214 was reaching for: the vocabulary is a
-- firm's cost taxonomy, it survives across the firm's projects, and since
-- the step-2 boundary everyone who can open a project is on the owning
-- account, so every member resolves the same identities by construction.
--
-- WHAT MOVES: the OWNING key becomes `account_id` (CASCADE with the account:
-- a firm's vocabulary dies with the firm). `user_id` STAYS as the AUTHOR,
-- released to NULL when the author's login goes (the 230/234/238 rule: the
-- entry outlives the person, and a member leaving no longer deletes
-- vocabulary the team still uses, which the old users CASCADE did).
-- Uniqueness moves to (account_id, entry_id).
--
-- ZERO ROWS EXIST at write time (probed 2026-09-05), so there is no data to
-- migrate and no merge to resolve; the backfill UPDATE below is present so a
-- re-run against a database that somehow has rows is still correct (each
-- entry joins its author's account), and SET NOT NULL then proves it.
--
-- Idempotent: guarded per statement.
--
-- No em dashes in this file.

BEGIN;

ALTER TABLE refm_cost_catalog
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

-- Any pre-existing entry joins its author's account.
UPDATE refm_cost_catalog c
   SET account_id = u.account_id
  FROM users u
 WHERE u.id = c.user_id
   AND c.account_id IS NULL;

ALTER TABLE refm_cost_catalog ALTER COLUMN account_id SET NOT NULL;

-- The author outlives nothing; the entry outlives the author.
ALTER TABLE refm_cost_catalog ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE refm_cost_catalog
  DROP CONSTRAINT IF EXISTS refm_cost_catalog_user_id_fkey;
ALTER TABLE refm_cost_catalog
  ADD CONSTRAINT refm_cost_catalog_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- One entry id per ACCOUNT now, not per person.
ALTER TABLE refm_cost_catalog
  DROP CONSTRAINT IF EXISTS refm_cost_catalog_user_entry_unique;
ALTER TABLE refm_cost_catalog
  DROP CONSTRAINT IF EXISTS refm_cost_catalog_account_entry_unique;
ALTER TABLE refm_cost_catalog
  ADD CONSTRAINT refm_cost_catalog_account_entry_unique UNIQUE (account_id, entry_id);

DROP INDEX IF EXISTS idx_refm_cost_catalog_user;
CREATE INDEX IF NOT EXISTS idx_refm_cost_catalog_account
  ON refm_cost_catalog (account_id, label);

COMMENT ON TABLE refm_cost_catalog IS
  'Account-scoped REFM cost catalog entries (mig 241): the firm''s own cost vocabulary, shared by every member across the account''s projects. user_id is the AUTHOR (SET NULL when they leave). Built-in entries live in code (lib/state/costCatalog.ts). Nothing here is read by the calculation engine: an entry stamps method/stage/phasing onto a cost line at selection time and the engine reads the line.';

COMMIT;
