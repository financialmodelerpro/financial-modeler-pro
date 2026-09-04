-- 239_accounts.sql
--
-- THE ACCOUNT BOUNDARY, step 1 of the account model (2026-09-04).
--
-- Every paying client is an ACCOUNT. Today the platform's real model is one
-- user = one account, implicit; this migration makes it a row. Nothing reads
-- users.account_id yet: the platform behaves exactly as before, and later
-- steps (the membership boundary, seats by account, invites) read it one at a
-- time, deliberately.
--
-- THE ACCOUNT IS ITS OWN ROW, NEVER A POINTER TO A PERSON'S ROW. A
-- self-referencing users.account_owner_id was rejected by design: it makes an
-- organisation's identity a person's row, the same mistake refm_projects
-- .user_id already makes for projects. The org gets its own identity here;
-- owner_user_id is a pointer that a future ownership transfer can move.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   - No plan columns. An account's plan IS its holder's plan, reached through
--     owner_user_id. Moving billing off the users row would rewrite setUserPlan
--     and everything downstream of it for zero behaviour change.
--   - No NOT NULL on users.account_id. The pair is circular (accounts needs the
--     user, the user needs the account), so the invariant "every user has an
--     account" is enforced by the AFTER INSERT trigger below plus the live
--     verifier (verify-accounts), not by a constraint that would need deferred
--     checking in every insert path.
--   - No constraint tying refm_project_members.user_id's account to the project
--     owner's account. That boundary lands in the route (step 2), because the
--     future FMP-advisor case is a member from ANOTHER (internal) account and a
--     DB constraint here would make it impossible.
--
-- DELETION SEMANTICS, chosen here because only the DB sees every delete path:
--   - accounts.owner_user_id is ON DELETE CASCADE: a holder's personal account
--     dies with them (probe users in apply scripts clean up for free).
--   - users.account_id is ON DELETE NO ACTION (the default): a MEMBER pointing
--     at an account BLOCKS that account's deletion, so deleting a holder whose
--     account still has members fails inside Postgres no matter which route
--     tried it. The engine (deleteUserAccount) refuses first with a clear
--     message; this is the backstop for the paths it cannot see.
--
-- BACKFILL: one personal account per existing user, holder = self. The
-- platform admin's account is FMP's own, kind 'internal'; every other account
-- is 'client'. Name comes from users.company where present, else the person's
-- name, else the email. 8 users live at write time; measured 2026-09-04.
--
-- Idempotent: IF NOT EXISTS everywhere, the backfill inserts only what is
-- missing, and the trigger is dropped and recreated.
--
-- No em dashes in this file.

BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'client' CHECK (kind IN ('client', 'internal')),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);

-- ── Backfill: a personal account for every user that lacks one ──────────────
INSERT INTO accounts (name, kind, owner_user_id)
SELECT
  COALESCE(NULLIF(trim(u.company), ''), NULLIF(trim(u.name), ''), u.email),
  CASE WHEN u.role = 'admin' THEN 'internal' ELSE 'client' END,
  u.id
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.owner_user_id = u.id)
  AND u.account_id IS NULL;

-- Every holder points back at their own account. This also REPAIRS a holder
-- whose pointer went astray, which is exactly the corruption the invariant
-- forbids (a future invited MEMBER holds no accounts row, so this cannot
-- touch them).
UPDATE users u SET account_id = a.id
FROM accounts a
WHERE a.owner_user_id = u.id
  AND u.account_id IS DISTINCT FROM a.id;

-- ── Every future user gets a personal account, at the DB, not in a route ────
-- A users row is born in exactly one app path today (self-signup), but probe
-- scripts and the SQL console also create them, and the invariant must hold
-- for ALL of them. AFTER INSERT because owner_user_id needs the users row to
-- exist. A row arriving WITH an account_id already set is a future invited
-- member joining an existing account: they hold no account of their own, so
-- none is created.
CREATE OR REPLACE FUNCTION fn_users_create_personal_account()
RETURNS trigger AS $$
DECLARE new_account uuid;
BEGIN
  IF NEW.account_id IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO accounts (name, kind, owner_user_id)
  VALUES (
    COALESCE(NULLIF(trim(NEW.company), ''), NULLIF(trim(NEW.name), ''), NEW.email),
    CASE WHEN NEW.role = 'admin' THEN 'internal' ELSE 'client' END,
    NEW.id
  )
  RETURNING id INTO new_account;
  UPDATE users SET account_id = new_account WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_personal_account ON users;
CREATE TRIGGER trg_users_personal_account
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION fn_users_create_personal_account();

COMMIT;
