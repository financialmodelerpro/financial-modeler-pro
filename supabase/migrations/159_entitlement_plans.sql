-- ============================================================
--  159_entitlement_plans.sql
--  Plan metadata for the admin plan builder (Phase D).
--  ADDITIVE ONLY: creates one new table, alters/drops nothing.
--
--  Phase A (mig 158) stored only plan_key inside plan_permissions. The plan
--  builder needs a home for plan metadata (label, active, order, platform) so
--  plans are data rows the admin can create, rename, activate/deactivate, and
--  order. This table provides that. plan_permissions stays keyed by plan_key.
--
--  Note: plan_permissions is keyed by plan_key globally (UNIQUE(plan_key,
--  feature_key)), so plan_key must stay globally unique across platforms until
--  a future migration platform-scopes plan_permissions. The builder enforces
--  unique plan_key on create.
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS entitlement_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_slug text NOT NULL DEFAULT 'real-estate',
  plan_key      text NOT NULL,
  label         text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_slug, plan_key)
);

CREATE INDEX IF NOT EXISTS entitlement_plans_platform_idx ON entitlement_plans(platform_slug);

ALTER TABLE entitlement_plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    DROP TRIGGER IF EXISTS entitlement_plans_updated_at ON entitlement_plans;
    CREATE TRIGGER entitlement_plans_updated_at BEFORE UPDATE ON entitlement_plans
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Seed the four REFM plans that mig 158 already seeded into plan_permissions,
-- so plan metadata lines up with the existing coverage rows. ON CONFLICT DO
-- NOTHING preserves admin renames/order/active edits on re-run.
INSERT INTO entitlement_plans (platform_slug, plan_key, label, display_order, active) VALUES
  ('real-estate', 'trial', 'Trial', 1, true),
  ('real-estate', 'solo',  'Solo',  2, true),
  ('real-estate', 'pro',   'Pro',   3, true),
  ('real-estate', 'firm',  'Firm',  4, true)
ON CONFLICT (platform_slug, plan_key) DO NOTHING;
