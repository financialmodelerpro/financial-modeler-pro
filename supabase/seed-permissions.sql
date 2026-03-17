-- ============================================================
--  REFM Pro — Dynamic Permission System Seed
--  Idempotent: safe to re-run at any time.
--  Steps: 1) features_registry  2) plan_permissions defaults
-- ============================================================

-- ── STEP 1: features_registry ─────────────────────────────────────────────────
-- ON CONFLICT DO UPDATE keeps display_name / description fresh on re-runs.

INSERT INTO features_registry (feature_key, display_name, description, category) VALUES
  -- Modules (individual access per module)
  ('module_1',           'Module 1 — Project Setup',        'Timeline, land, area, development costs, financing',              'modules'),
  ('module_2',           'Module 2 — Revenue Analysis',     'Unit sales, rental pricing, phased delivery schedules',           'modules'),
  ('module_3',           'Module 3 — Operating Expenses',   'Property management, maintenance, staff costs, overheads',        'modules'),
  ('module_4',           'Module 4 — Returns & Valuation',  'IRR, NPV, equity multiple, cap rate, yield on cost',             'modules'),
  ('module_5',           'Module 5 — Financial Statements', 'Auto-generated P&L, Balance Sheet, Cash Flow Statement',         'modules'),
  ('module_6',           'Module 6 — Reports & Export',     'Investor-ready PDF reports and formula-linked Excel workbooks',   'modules'),
  ('module_7',           'Module 7 — Scenario Analysis',    'Multi-scenario comparison and stress testing',                    'modules'),
  ('module_8',           'Module 8 — Portfolio Dashboard',  'Multi-project portfolio view and aggregated KPIs',               'modules'),
  ('module_9',           'Module 9 — Market Data',          'Live market benchmarks and comparable data feeds',               'modules'),
  ('module_10',          'Module 10 — Collaboration',       'Team sharing, comments, review workflows',                       'modules'),
  ('module_11',          'Module 11 — API Access',          'REST API and webhook integrations for external systems',          'modules'),

  -- Module quality tiers
  ('module_8_full',      'Module 8 — Full Edit',            'Full portfolio edit vs read-only portfolio view',                 'module_quality'),
  ('module_9_full',      'Module 9 — Full Metrics',         'Full market metrics suite vs basic KPIs only',                   'module_quality'),

  -- AI features
  ('ai_contextual',      'AI Contextual Assist',            'In-module AI help buttons (Mode 1 — contextual guidance)',        'ai'),
  ('ai_research',        'AI Research Agent',               'Full investment memo research agent (Mode 2 — deep research)',   'ai'),

  -- Export features
  ('pdf_basic',          'PDF Export — Basic',              'Standard single-page PDF summary export',                         'export'),
  ('pdf_full',           'PDF Export — Full',               'Full multi-section formatted investor PDF report',               'export'),
  ('pdf_whitelabel',     'PDF Export — White-Label',        'White-label branded PDF with custom logo and cover page',        'export'),
  ('excel_static',       'Excel Export — Static',           'Static values Excel workbook (.xlsx)',                           'export'),
  ('excel_formula',      'Excel Export — Formula',          'Formula-linked Excel workbook with live recalculation',          'export'),

  -- Admin & branding
  ('white_label',        'White-Label Branding',            'Custom logo, colours, client name, and domain branding',         'admin'),
  ('admin_panel',        'Admin Panel',                     'Access to /admin route for user and permission management',       'admin'),

  -- Project limits
  ('projects_10',        'Up to 10 Projects',               'Save and manage up to 10 projects',                              'limits'),
  ('projects_unlimited', 'Unlimited Projects',              'Unlimited project storage — no cap',                             'limits')

ON CONFLICT (feature_key)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  category     = EXCLUDED.category;


-- ── STEP 2: plan_permissions defaults ─────────────────────────────────────────
-- ON CONFLICT DO NOTHING so admin manual changes are preserved.

-- ── Free Plan ─────────────────────────────────────────────────────────────────
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

-- ── Professional Plan ─────────────────────────────────────────────────────────
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

-- ── Enterprise Plan ───────────────────────────────────────────────────────────
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
