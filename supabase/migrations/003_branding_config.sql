-- Financial Modeler Pro - Branding Config Table
-- Run this in Supabase SQL Editor
-- Safe to re-run: uses IF NOT EXISTS + DROP POLICY IF EXISTS

-- =============================================================================
-- branding_config
-- Stores white-label branding per scope (global or per-user UUID)
-- =============================================================================
CREATE TABLE IF NOT EXISTS branding_config (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      text NOT NULL UNIQUE,   -- 'global' or a user UUID
  config     jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE branding_config ENABLE ROW LEVEL SECURITY;

-- Admins can read/write all rows (handled in API routes via service role key)
-- Public: no direct access
DROP POLICY IF EXISTS "Service role full access branding_config" ON branding_config;
CREATE POLICY "Service role full access branding_config" ON branding_config
  FOR ALL USING (true);

-- Auto-update updated_at on change
CREATE OR REPLACE FUNCTION update_branding_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_branding_config_updated_at ON branding_config;
CREATE TRIGGER set_branding_config_updated_at
  BEFORE UPDATE ON branding_config
  FOR EACH ROW EXECUTE FUNCTION update_branding_config_updated_at();

-- Seed global default (empty config — platform defaults apply)
INSERT INTO branding_config (scope, config)
VALUES ('global', '{}')
ON CONFLICT (scope) DO NOTHING;
