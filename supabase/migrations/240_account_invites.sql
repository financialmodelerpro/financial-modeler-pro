-- 240_account_invites.sql
--
-- ACCOUNT INVITES, account model step 5 (2026-09-04).
--
-- A client invites a team member by EMAIL; the person signs up through the
-- invite and lands under the client's account as a MEMBER (mig 239: a users
-- row arriving WITH an account_id gets no personal account of its own). The
-- invite EXPIRES and is SINGLE USE.
--
-- TOKEN DISCIPLINE (the API-key rule, mig 213): only a SHA-256 hash is
-- stored. The raw token exists in the email link and nowhere else; a leaked
-- table reveals nothing redeemable.
--
-- ONE OPEN INVITE PER (account, email), by partial unique index; re-inviting
-- replaces the open invite (the route deletes it first), restarting the
-- clock. The rows OUTLIVE the people: invited_by and consumed_by are ON
-- DELETE SET NULL (the 230/234/238 rule), while the ACCOUNT cascade takes
-- its invites with it, since an invite into a dead account redeems into
-- nothing.
--
-- REDEMPTION IS ONE FUNCTION, ONE TRANSACTION: `redeem_account_invite` locks
-- the open, unexpired invite row (FOR UPDATE, so two racing signups cannot
-- both consume it), verifies the email matches, inserts the users row
-- ATTACHED to the account, and stamps the invite consumed, all or nothing.
-- A failure leaves NEITHER the user NOR the consumption behind. RAISEd
-- reasons ('invalid_invite', 'email_mismatch') are the contract the route
-- maps to HTTP answers.
--
-- Idempotent: IF NOT EXISTS everywhere, CREATE OR REPLACE for the function.
--
-- No em dashes in this file.

BEGIN;

CREATE TABLE IF NOT EXISTS account_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_invites_open
  ON account_invites (account_id, lower(email)) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_account_invites_account
  ON account_invites (account_id);

-- Service-role only, like account_deletions: RLS on, no policies, so the
-- anon key sees nothing and every read goes through the server.
ALTER TABLE account_invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION redeem_account_invite(
  p_token_hash text,
  p_email text,
  p_name text,
  p_password_hash text,
  p_phone text,
  p_city text,
  p_country text,
  p_company text,
  p_job_title text,
  p_works_in_real_estate boolean,
  p_role_note text
) RETURNS TABLE (user_id uuid, joined_account_id uuid) AS $$
DECLARE
  v_invite account_invites%ROWTYPE;
  v_user uuid;
BEGIN
  SELECT * INTO v_invite FROM account_invites
   WHERE token_hash = p_token_hash
     AND consumed_at IS NULL
     AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_invite';
  END IF;
  IF lower(trim(v_invite.email)) <> lower(trim(p_email)) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  -- Attached to the account AT BIRTH, so trg_users_personal_account (239)
  -- creates no personal account: this row is a MEMBER, not a client.
  INSERT INTO users (
    email, name, password_hash, phone, city, country, company, job_title,
    works_in_real_estate, real_estate_role_note,
    role, subscription_plan, subscription_status, projects_limit,
    email_confirmed, account_id
  ) VALUES (
    lower(trim(p_email)), p_name, p_password_hash, p_phone, p_city, p_country,
    p_company, p_job_title, p_works_in_real_estate, p_role_note,
    'user', 'none', 'expired', 0, false, v_invite.account_id
  ) RETURNING id INTO v_user;

  UPDATE account_invites
     SET consumed_at = now(), consumed_by = v_user
   WHERE id = v_invite.id;

  RETURN QUERY SELECT v_user, v_invite.account_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
