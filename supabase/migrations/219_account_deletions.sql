-- 219_account_deletions.sql
--
-- Audit trail for account deletions (admin-initiated AND self-service).
-- ADDITIVE ONLY: one new table, no existing object is altered.
--
-- Design notes:
--   * deleted_user_id is a RAW uuid, deliberately NOT a foreign key: the row it
--     names is gone the moment this record matters. Email and name are copied
--     for the same reason (admin_audit_log.target_user_id is ON DELETE SET NULL,
--     which is exactly the attribution loss this table exists to avoid).
--   * deleted_by IS an FK (SET NULL): for an admin deletion it points at the
--     admin, who continues to exist. For a self-deletion it briefly points at
--     the user and the cascade nulls it; `source` = 'self' carries the fact.
--   * removed is a jsonb summary of what the deletion removed (row counts and
--     whether a live Paddle subscription was cancelled first).
--   * message is the optional admin note emailed to the user; message_emailed
--     records whether that send succeeded.
--
-- RLS is enabled with NO policies: service-role access only (the API routes),
-- matching public_api_audit (mig 212).

CREATE TABLE IF NOT EXISTS account_deletions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id  uuid NOT NULL,
  email            text NOT NULL,
  name             text,
  plan_key         text,
  source           text NOT NULL CHECK (source IN ('self', 'admin')),
  deleted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  message          text,
  message_emailed  boolean NOT NULL DEFAULT false,
  removed          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_deletions_user
  ON account_deletions (deleted_user_id);
CREATE INDEX IF NOT EXISTS idx_account_deletions_created
  ON account_deletions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_deletions_email
  ON account_deletions (email);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE account_deletions IS
  'One row per deleted account: who was deleted, by whom, when, the optional message emailed to them, and a jsonb summary of what was removed. deleted_user_id/email are raw copies, not FKs, so the record survives the deletion it describes.';
