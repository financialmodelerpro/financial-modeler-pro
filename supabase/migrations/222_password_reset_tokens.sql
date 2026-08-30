-- 222_password_reset_tokens.sql
--
-- Creates password_reset_tokens FOR REAL. Migration 008 declares this table
-- but it DOES NOT EXIST on production (probed 2026-08-30: PostgREST PGRST205
-- on every read and insert): 008 was never executed there. IF NOT EXISTS
-- cannot produce absence, so unlike the 007 drift (ran, silently no-opped)
-- this one simply never ran. Every "forgot password" on the Modeling Hub has
-- therefore failed: the token insert failed silently, a reset email with a
-- dangling token still went out, and the reset page answered "Invalid or
-- expired reset link" to every click.
--
-- NOT exactly as 008 declared, and here is why: the reset route has ALWAYS
-- read a `used_at` column (single-use enforcement) that 008 never declared,
-- so even a faithfully-applied 008 would have failed the flow (the select of
-- a missing column errors and reads as "invalid link"). This is 008's shape
-- PLUS:
--   * used_at timestamptz NULL  - the single-use marker the code requires
--     (set atomically on redemption; a non-null value refuses reuse);
--   * an index on user_id       - the routes clear a user's other tokens;
--   * RLS enabled, no policies  - service-role only, like every recent table.
-- The FK is ON DELETE CASCADE as 008 declared, which also makes the account
-- deletion engine's assumption about this table true for the first time.
--
-- Idempotent, additive, no data change.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens (user_id);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE password_reset_tokens IS
  'Password-reset tokens for the Modeling Hub (SHA-256 hash only, never plaintext). Single-use via used_at, 60-minute expiry enforced by the routes. Created by mig 222 (2026-08-30); mig 008 declared this table but never ran on prod.';
