-- ─────────────────────────────────────────────────────────────────────────────
-- 006_permissions.sql
-- Dynamic permission system:
--   features_registry  — master list of all feature keys
--   plan_permissions   — plan-level defaults (editable by admin in UI)
--   user_permissions   — per-user overrides (admin-set, override plan defaults)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Features registry ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_registry (
  feature_key  text PRIMARY KEY,
  display_name text NOT NULL,
  description  text,
  category     text NOT NULL DEFAULT 'modules'
);

-- ── Plan permissions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_permissions (
  plan         text NOT NULL,
  feature_key  text NOT NULL REFERENCES features_registry(feature_key) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan, feature_key)
);

-- ── User permission overrides ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key    text NOT NULL REFERENCES features_registry(feature_key) ON DELETE CASCADE,
  override_value boolean NOT NULL,
  reason         text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_key)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE features_registry  ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_permissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions   ENABLE ROW LEVEL SECURITY;

-- features_registry: public read, admin write
DROP POLICY IF EXISTS "Public read features"  ON features_registry;
CREATE POLICY "Public read features"          ON features_registry FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin write features"  ON features_registry;
CREATE POLICY "Admin write features"          ON features_registry FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- plan_permissions: public read (server reads these for all users), admin write
DROP POLICY IF EXISTS "Public read plan perms" ON plan_permissions;
CREATE POLICY "Public read plan perms"         ON plan_permissions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin write plan perms" ON plan_permissions;
CREATE POLICY "Admin write plan perms"         ON plan_permissions FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- user_permissions: users read own, admin read/write all
DROP POLICY IF EXISTS "Users read own overrides"  ON user_permissions;
CREATE POLICY "Users read own overrides"          ON user_permissions FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admin all overrides"       ON user_permissions;
CREATE POLICY "Admin all overrides"               ON user_permissions FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: features_registry
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO features_registry (feature_key, display_name, description, category) VALUES
  -- Modules
  ('module_1',           'Module 1 — Project Setup',          'Timeline, land & area, development costs, financing',           'modules'),
  ('module_2',           'Module 2 — Revenue Analysis',       'Unit mix, rental income, absorption schedules',                 'modules'),
  ('module_3',           'Module 3 — Operating Expenses',     'OpEx schedules, NOI calculations',                              'modules'),
  ('module_4',           'Module 4 — Returns & Valuation',    'IRR, NPV, equity multiples, cap rate valuation',                'modules'),
  ('module_5',           'Module 5 — Financial Statements',   'P&L, balance sheet, cash flow statement',                       'modules'),
  ('module_6',           'Module 6 — Reports & Export',       'Charts, summary reports, presentation mode',                    'modules'),
  ('module_7',           'Module 7 — Scenario Analysis',      'Side-by-side scenario comparison',                              'modules'),
  ('module_8',           'Module 8 — Portfolio Dashboard',    'Multi-project portfolio view',                                  'modules'),
  ('module_9',           'Module 9 — Market Data',            'Live market benchmarks and comps',                              'modules'),
  ('module_10',          'Module 10 — Collaboration',         'Share projects with team members',                              'modules'),
  ('module_11',          'Module 11 — API Access',            'Programmatic access via REST API',                              'modules'),
  -- Module quality tiers
  ('module_8_full',      'Portfolio Full Edit',               'Full edit access vs read-only portfolio view',                  'module_quality'),
  ('module_9_full',      'Market Data Full Metrics',          'Full metrics suite vs basic KPI snapshot',                      'module_quality'),
  -- AI
  ('ai_contextual',      'AI Contextual Assist',              'In-module AI help buttons (Mode 1)',                            'ai'),
  ('ai_research',        'AI Research Agent',                 'Full investment memo research agent (Mode 2)',                  'ai'),
  -- Export
  ('pdf_basic',          'PDF Export — Basic',                'Single-page summary PDF',                                       'export'),
  ('pdf_full',           'PDF Export — Full',                 'Multi-section branded PDF report',                              'export'),
  ('pdf_whitelabel',     'PDF Export — White-Label',          'PDF with client branding, no FMP watermark',                    'export'),
  ('excel_static',       'Excel Export — Static',             'Values-only Excel workbook',                                    'export'),
  ('excel_formula',      'Excel Export — Formula',            'Live-formula Excel workbook with full model',                   'export'),
  -- Admin & branding
  ('white_label',        'White-Label Branding',              'Custom logo, colours, domain for client delivery',              'admin'),
  ('admin_panel',        'Admin Panel',                       'Access to /admin CMS and platform settings',                    'admin'),
  -- Limits
  ('projects_10',        'Up to 10 Projects',                 'Save and manage up to 10 projects',                             'limits'),
  ('projects_unlimited', 'Unlimited Projects',                'No cap on saved projects',                                      'limits')
ON CONFLICT (feature_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: plan_permissions
-- ─────────────────────────────────────────────────────────────────────────────

-- Free plan
INSERT INTO plan_permissions (plan, feature_key, enabled) VALUES
  ('free', 'module_1',           true),
  ('free', 'module_2',           true),
  ('free', 'module_3',           true),
  ('free', 'module_4',           true),
  ('free', 'module_5',           true),
  ('free', 'module_6',           true),
  ('free', 'module_7',           true),
  ('free', 'module_8',           false),
  ('free', 'module_9',           false),
  ('free', 'module_10',          false),
  ('free', 'module_11',          false),
  ('free', 'module_8_full',      false),
  ('free', 'module_9_full',      false),
  ('free', 'ai_contextual',      false),
  ('free', 'ai_research',        false),
  ('free', 'pdf_basic',          true),
  ('free', 'pdf_full',           false),
  ('free', 'pdf_whitelabel',     false),
  ('free', 'excel_static',       false),
  ('free', 'excel_formula',      false),
  ('free', 'white_label',        false),
  ('free', 'admin_panel',        false),
  ('free', 'projects_10',        false),
  ('free', 'projects_unlimited', false)
ON CONFLICT (plan, feature_key) DO NOTHING;

-- Professional plan
INSERT INTO plan_permissions (plan, feature_key, enabled) VALUES
  ('professional', 'module_1',           true),
  ('professional', 'module_2',           true),
  ('professional', 'module_3',           true),
  ('professional', 'module_4',           true),
  ('professional', 'module_5',           true),
  ('professional', 'module_6',           true),
  ('professional', 'module_7',           true),
  ('professional', 'module_8',           true),
  ('professional', 'module_9',           true),
  ('professional', 'module_10',          true),
  ('professional', 'module_11',          false),
  ('professional', 'module_8_full',      true),
  ('professional', 'module_9_full',      true),
  ('professional', 'ai_contextual',      true),
  ('professional', 'ai_research',        false),
  ('professional', 'pdf_basic',          true),
  ('professional', 'pdf_full',           true),
  ('professional', 'pdf_whitelabel',     false),
  ('professional', 'excel_static',       true),
  ('professional', 'excel_formula',      false),
  ('professional', 'white_label',        false),
  ('professional', 'admin_panel',        false),
  ('professional', 'projects_10',        true),
  ('professional', 'projects_unlimited', false)
ON CONFLICT (plan, feature_key) DO NOTHING;

-- Enterprise plan
INSERT INTO plan_permissions (plan, feature_key, enabled) VALUES
  ('enterprise', 'module_1',           true),
  ('enterprise', 'module_2',           true),
  ('enterprise', 'module_3',           true),
  ('enterprise', 'module_4',           true),
  ('enterprise', 'module_5',           true),
  ('enterprise', 'module_6',           true),
  ('enterprise', 'module_7',           true),
  ('enterprise', 'module_8',           true),
  ('enterprise', 'module_9',           true),
  ('enterprise', 'module_10',          true),
  ('enterprise', 'module_11',          true),
  ('enterprise', 'module_8_full',      true),
  ('enterprise', 'module_9_full',      true),
  ('enterprise', 'ai_contextual',      true),
  ('enterprise', 'ai_research',        true),
  ('enterprise', 'pdf_basic',          true),
  ('enterprise', 'pdf_full',           true),
  ('enterprise', 'pdf_whitelabel',     true),
  ('enterprise', 'excel_static',       true),
  ('enterprise', 'excel_formula',      true),
  ('enterprise', 'white_label',        true),
  ('enterprise', 'admin_panel',        true),
  ('enterprise', 'projects_10',        true),
  ('enterprise', 'projects_unlimited', true)
ON CONFLICT (plan, feature_key) DO NOTHING;
