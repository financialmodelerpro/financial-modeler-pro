-- ── Password Reset Tokens ────────────────────────────────────────────────────
-- Stores hashed tokens for the custom forgot-password flow.
-- Plain tokens are never stored — only SHA-256 hashes.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);

-- Only the service role can read/write this table (API routes use service role)
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
-- No RLS policies — service role bypasses RLS, anon/authenticated users cannot access
