-- ============================================================
--  158_entitlement_catalog.sql
--  Foundation for the admin-controlled entitlement system.
--  ADDITIVE ONLY: creates three new tables, alters/drops nothing.
--
--  Context: the original features_registry / plan_permissions /
--  user_permissions trio (created by migration 006) was dropped by
--  migration 144. This migration recreates the catalog from scratch
--  with a clean, current shape. It does NOT revert 144 and does NOT
--  touch the gate (canAccess) or any module behavior. Schema + seed
--  only, no UI.
--
--  Apply manually via the Supabase dashboard (project convention).
--  Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT seeds.
--  No em dashes anywhere in this file.
-- ============================================================

-- ── features_registry ─────────────────────────────────────────────────────────
-- A catalog of every sellable capability. Module features use the SAME keys the
-- gate already expects (module_1 .. module_11) so they line up with no translation.
CREATE TABLE IF NOT EXISTS features_registry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key   text NOT NULL UNIQUE,
  label         text NOT NULL,
  category      text NOT NULL DEFAULT 'general',
  feature_type  text NOT NULL DEFAULT 'gate'
                  CHECK (feature_type IN ('gate', 'limit', 'metered')),
  build_status  text NOT NULL DEFAULT 'needs_build'
                  CHECK (build_status IN ('live', 'in_development', 'stub', 'needs_build')),
  display_order integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── plan_permissions ──────────────────────────────────────────────────────────
-- Maps a plan to the features it includes. One row per plan-feature pair. These
-- are DEFAULTS the admin will edit later, so they are data rows, not hardcoded.
-- plan_key is intentionally free text (no CHECK) so new plans can be added as
-- data without a schema migration.
CREATE TABLE IF NOT EXISTS plan_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key    text NOT NULL,
  feature_key text NOT NULL REFERENCES features_registry(feature_key) ON DELETE CASCADE,
  included    boolean NOT NULL DEFAULT false,   -- for gate features
  limit_value integer,                          -- nullable, for limit features
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_key, feature_key)
);

-- ── user_permissions ──────────────────────────────────────────────────────────
-- Per-user overrides applied on top of the plan. mode grant adds a feature the
-- plan does not include; mode revoke removes one the plan does include.
CREATE TABLE IF NOT EXISTS user_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key    text NOT NULL REFERENCES features_registry(feature_key) ON DELETE CASCADE,
  mode           text NOT NULL CHECK (mode IN ('grant', 'revoke')),
  override_value integer,                       -- nullable, for limit overrides
  reason         text,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id),
  UNIQUE (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS user_permissions_user_idx ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS plan_permissions_plan_idx ON plan_permissions(plan_key);

-- RLS: these tables are managed server-side (service role bypasses RLS) and
-- carry no public-read need. Enable RLS with no permissive policy so anon and
-- authenticated client roles are denied by default (user_permissions is
-- sensitive). The future admin UI reads and writes through the service role.
ALTER TABLE features_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions  ENABLE ROW LEVEL SECURITY;

-- auto-update updated_at (reuses the update_updated_at() function if present).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    DROP TRIGGER IF EXISTS features_registry_updated_at ON features_registry;
    CREATE TRIGGER features_registry_updated_at BEFORE UPDATE ON features_registry
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    DROP TRIGGER IF EXISTS plan_permissions_updated_at ON plan_permissions;
    CREATE TRIGGER plan_permissions_updated_at BEFORE UPDATE ON plan_permissions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
--  SEED 1: features_registry
--  Modules seeded from the live registry (modules-config.ts) in its current
--  order, with build_status derived from each module status
--  (done = live, wip = in_development, soon/pro/enterprise = needs_build).
--  One ordered list, no separate roadmap grouping.
--  Non-module catalog entries follow. No prices here.
-- ============================================================
INSERT INTO features_registry (feature_key, label, category, feature_type, build_status, display_order, active) VALUES
  -- Modules (gate; keys match canAccess)
  ('module_1',         'Module 1: Project Setup and Financial Structure', 'module',  'gate',  'live',           1,  true),
  ('module_2',         'Module 2: Revenue and Sales Projections',         'module',  'gate',  'in_development', 2,  true),
  ('module_3',         'Module 3: Operating Expenses',                    'module',  'gate',  'in_development', 3,  true),
  ('module_4',         'Module 4: Financial Statements',                  'module',  'gate',  'in_development', 4,  true),
  ('module_5',         'Module 5: Returns and Valuation Analysis',        'module',  'gate',  'in_development', 5,  true),
  ('module_6',         'Module 6: Scenario Analysis',                     'module',  'gate',  'live',           6,  true),
  ('module_7',         'Module 7: Reports and Visualizations',            'module',  'gate',  'needs_build',    7,  true),
  ('module_8',         'Module 8: Portfolio',                             'module',  'gate',  'needs_build',    8,  true),
  ('module_9',         'Module 9: Market Data',                           'module',  'gate',  'needs_build',    9,  true),
  ('module_10',        'Module 10: Collaborate',                          'module',  'gate',  'needs_build',    10, true),
  ('module_11',        'Module 11: API Access',                           'module',  'gate',  'needs_build',    11, true),
  -- Exports
  ('pdf_export',       'PDF Export',                                      'export',  'gate',  'live',           12, true),
  ('excel_snapshot',   'Excel Export (snapshot)',                         'export',  'gate',  'live',           13, true),
  ('excel_formula',    'Excel Export (formula linked)',                   'export',  'gate',  'live',           14, true),
  ('white_label_pdf',  'White Label PDF',                                 'export',  'gate',  'needs_build',    15, true),
  -- Analysis and platform
  ('sensitivity',      'Sensitivity Analysis',                            'analysis','gate',  'live',           16, true),
  ('versioning',       'Version History',                                 'platform','gate',  'live',           17, true),
  -- Limits
  ('projects',         'Saved Projects',                                  'limits',  'limit', 'live',           18, true),
  ('seats',            'Team Seats',                                      'limits',  'limit', 'needs_build',    19, true),
  -- Admin and branding
  ('rbac',             'Role Based Access Control',                       'admin',   'gate',  'needs_build',    20, true),
  ('branding',         'Custom Branding',                                 'branding','gate',  'needs_build',    21, true),
  -- AI placeholders (not built yet)
  ('ai_contextual',    'AI Contextual Assist',                            'ai',      'gate',  'stub',           22, true),
  ('ai_research',      'AI Research Agent',                               'ai',      'gate',  'stub',           23, true)
ON CONFLICT (feature_key) DO UPDATE SET
  label         = EXCLUDED.label,
  category      = EXCLUDED.category,
  feature_type  = EXCLUDED.feature_type,
  build_status  = EXCLUDED.build_status,
  display_order = EXCLUDED.display_order,
  updated_at    = now();
  -- NOTE: active is intentionally NOT refreshed so an admin disable persists.

-- ============================================================
--  SEED 2: plan_permissions (proposed defaults: Trial, Solo, Pro, Firm)
--  Gate features set included true/false; limit_value NULL.
--  Limit features (projects, seats) set included true with a limit_value cap
--  (-1 means unlimited, matching the users.projects_limit convention).
--  ON CONFLICT DO NOTHING so later admin edits are never overwritten on re-run.
-- ============================================================

-- ── Trial ───────────────────────────────────────────────────────────────────
INSERT INTO plan_permissions (plan_key, feature_key, included, limit_value) VALUES
  ('trial', 'module_1',        true,  NULL),
  ('trial', 'module_2',        true,  NULL),
  ('trial', 'module_3',        true,  NULL),
  ('trial', 'module_4',        true,  NULL),
  ('trial', 'module_5',        true,  NULL),
  ('trial', 'module_6',        true,  NULL),
  ('trial', 'module_7',        false, NULL),
  ('trial', 'module_8',        false, NULL),
  ('trial', 'module_9',        false, NULL),
  ('trial', 'module_10',       false, NULL),
  ('trial', 'module_11',       false, NULL),
  ('trial', 'pdf_export',      true,  NULL),
  ('trial', 'excel_snapshot',  false, NULL),
  ('trial', 'excel_formula',   false, NULL),
  ('trial', 'white_label_pdf', false, NULL),
  ('trial', 'sensitivity',     false, NULL),
  ('trial', 'versioning',      false, NULL),
  ('trial', 'rbac',            false, NULL),
  ('trial', 'branding',        false, NULL),
  ('trial', 'ai_contextual',   false, NULL),
  ('trial', 'ai_research',     false, NULL),
  ('trial', 'projects',        true,  1),
  ('trial', 'seats',           true,  1)
ON CONFLICT (plan_key, feature_key) DO NOTHING;

-- ── Solo ────────────────────────────────────────────────────────────────────
INSERT INTO plan_permissions (plan_key, feature_key, included, limit_value) VALUES
  ('solo', 'module_1',        true,  NULL),
  ('solo', 'module_2',        true,  NULL),
  ('solo', 'module_3',        true,  NULL),
  ('solo', 'module_4',        true,  NULL),
  ('solo', 'module_5',        true,  NULL),
  ('solo', 'module_6',        true,  NULL),
  ('solo', 'module_7',        true,  NULL),
  ('solo', 'module_8',        true,  NULL),
  ('solo', 'module_9',        true,  NULL),
  ('solo', 'module_10',       false, NULL),
  ('solo', 'module_11',       false, NULL),
  ('solo', 'pdf_export',      true,  NULL),
  ('solo', 'excel_snapshot',  true,  NULL),
  ('solo', 'excel_formula',   false, NULL),
  ('solo', 'white_label_pdf', false, NULL),
  ('solo', 'sensitivity',     true,  NULL),
  ('solo', 'versioning',      true,  NULL),
  ('solo', 'rbac',            false, NULL),
  ('solo', 'branding',        false, NULL),
  ('solo', 'ai_contextual',   false, NULL),
  ('solo', 'ai_research',     false, NULL),
  ('solo', 'projects',        true,  3),
  ('solo', 'seats',           true,  1)
ON CONFLICT (plan_key, feature_key) DO NOTHING;

-- ── Pro ─────────────────────────────────────────────────────────────────────
INSERT INTO plan_permissions (plan_key, feature_key, included, limit_value) VALUES
  ('pro', 'module_1',        true,  NULL),
  ('pro', 'module_2',        true,  NULL),
  ('pro', 'module_3',        true,  NULL),
  ('pro', 'module_4',        true,  NULL),
  ('pro', 'module_5',        true,  NULL),
  ('pro', 'module_6',        true,  NULL),
  ('pro', 'module_7',        true,  NULL),
  ('pro', 'module_8',        true,  NULL),
  ('pro', 'module_9',        true,  NULL),
  ('pro', 'module_10',       true,  NULL),
  ('pro', 'module_11',       false, NULL),
  ('pro', 'pdf_export',      true,  NULL),
  ('pro', 'excel_snapshot',  true,  NULL),
  ('pro', 'excel_formula',   true,  NULL),
  ('pro', 'white_label_pdf', true,  NULL),
  ('pro', 'sensitivity',     true,  NULL),
  ('pro', 'versioning',      true,  NULL),
  ('pro', 'rbac',            false, NULL),
  ('pro', 'branding',        true,  NULL),
  ('pro', 'ai_contextual',   true,  NULL),
  ('pro', 'ai_research',     false, NULL),
  ('pro', 'projects',        true,  25),
  ('pro', 'seats',           true,  3)
ON CONFLICT (plan_key, feature_key) DO NOTHING;

-- ── Firm ────────────────────────────────────────────────────────────────────
INSERT INTO plan_permissions (plan_key, feature_key, included, limit_value) VALUES
  ('firm', 'module_1',        true,  NULL),
  ('firm', 'module_2',        true,  NULL),
  ('firm', 'module_3',        true,  NULL),
  ('firm', 'module_4',        true,  NULL),
  ('firm', 'module_5',        true,  NULL),
  ('firm', 'module_6',        true,  NULL),
  ('firm', 'module_7',        true,  NULL),
  ('firm', 'module_8',        true,  NULL),
  ('firm', 'module_9',        true,  NULL),
  ('firm', 'module_10',       true,  NULL),
  ('firm', 'module_11',       true,  NULL),
  ('firm', 'pdf_export',      true,  NULL),
  ('firm', 'excel_snapshot',  true,  NULL),
  ('firm', 'excel_formula',   true,  NULL),
  ('firm', 'white_label_pdf', true,  NULL),
  ('firm', 'sensitivity',     true,  NULL),
  ('firm', 'versioning',      true,  NULL),
  ('firm', 'rbac',            true,  NULL),
  ('firm', 'branding',        true,  NULL),
  ('firm', 'ai_contextual',   true,  NULL),
  ('firm', 'ai_research',     true,  NULL),
  ('firm', 'projects',        true,  -1),
  ('firm', 'seats',           true,  10)
ON CONFLICT (plan_key, feature_key) DO NOTHING;

-- user_permissions is seeded empty (overrides are created per user by the admin).
