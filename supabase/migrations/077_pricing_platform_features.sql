-- ============================================================
-- 077: Platform features + plan feature access tables
-- Single source of truth for feature toggles per plan
-- ============================================================

-- Update plan prices
UPDATE platform_pricing SET price_monthly = 699, price_label = '$699 / month', description = 'For individual analysts and consultants', badge_text = null, badge_color = null WHERE platform_slug = 'real-estate' AND plan_name = 'starter';
UPDATE platform_pricing SET price_monthly = 999, price_label = '$999 / month', description = 'For serious financial modelers', is_featured = true, badge_text = 'Most Popular', badge_color = '#1ABC9C' WHERE platform_slug = 'real-estate' AND plan_name = 'professional';
UPDATE platform_pricing SET price_monthly = null, price_label = 'Custom Pricing', description = 'For firms and teams', is_custom = true, cta_text = 'Contact Us', cta_url = '/contact', badge_text = 'For Teams', badge_color = '#C9A84C' WHERE platform_slug = 'real-estate' AND plan_name = 'enterprise';

-- Platform features table
CREATE TABLE IF NOT EXISTS platform_features (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform_slug TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  feature_text TEXT NOT NULL,
  feature_category TEXT DEFAULT 'general',
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform_slug, feature_key)
);
ALTER TABLE platform_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access platform_features" ON platform_features FOR ALL USING (true);

-- Plan feature access table
CREATE TABLE IF NOT EXISTS plan_feature_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES platform_pricing(id) ON DELETE CASCADE,
  feature_id UUID REFERENCES platform_features(id) ON DELETE CASCADE,
  is_included BOOLEAN DEFAULT false,
  override_text TEXT,
  UNIQUE(plan_id, feature_id)
);
ALTER TABLE plan_feature_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access plan_feature_access" ON plan_feature_access FOR ALL USING (true);

-- Seed Real Estate features
INSERT INTO platform_features (platform_slug, feature_key, feature_text, feature_category, display_order) VALUES
('real-estate', 'active_projects', 'Active Projects', 'projects', 1),
('real-estate', 'module_project_setup', 'Module 1: Project Setup & Financial Structure', 'modules', 2),
('real-estate', 'module_revenue', 'Module 2: Revenue Analysis', 'modules', 3),
('real-estate', 'module_opex', 'Module 3: Operating Expenses', 'modules', 4),
('real-estate', 'module_returns', 'Module 4: Returns & Valuation (IRR/NPV)', 'modules', 5),
('real-estate', 'module_financial_statements', 'Module 5: Financial Statements', 'modules', 6),
('real-estate', 'module_reports', 'Module 6: Reports & Visualizations', 'modules', 7),
('real-estate', 'excel_export', 'Excel Export', 'exports', 8),
('real-estate', 'pdf_export', 'PDF Export', 'exports', 9),
('real-estate', 'community_support', 'Community Support', 'support', 10),
('real-estate', 'email_support', 'Email Support', 'support', 11),
('real-estate', 'priority_support', 'Priority Support', 'support', 12),
('real-estate', 'dedicated_support', 'Dedicated Support', 'support', 13),
('real-estate', 'team_workspace', 'Team Workspace', 'team', 14),
('real-estate', 'white_label', 'White-label Option', 'team', 15),
('real-estate', 'custom_integrations', 'Custom Integrations', 'team', 16);

-- Helper function to seed access rows
-- FREE TRIAL
INSERT INTO plan_feature_access (plan_id, feature_id, is_included, override_text)
SELECT pp.id, pf.id,
  pf.feature_key IN ('active_projects','module_project_setup','module_revenue','community_support'),
  CASE pf.feature_key WHEN 'active_projects' THEN '1 project' ELSE null END
FROM platform_pricing pp CROSS JOIN platform_features pf
WHERE pp.platform_slug = 'real-estate' AND pp.plan_name = 'free_trial' AND pf.platform_slug = 'real-estate'
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- STARTER
INSERT INTO plan_feature_access (plan_id, feature_id, is_included, override_text)
SELECT pp.id, pf.id,
  pf.feature_key IN ('active_projects','module_project_setup','module_revenue','module_opex','module_returns','module_financial_statements','module_reports','community_support','email_support'),
  CASE pf.feature_key WHEN 'active_projects' THEN '3-5 projects' ELSE null END
FROM platform_pricing pp CROSS JOIN platform_features pf
WHERE pp.platform_slug = 'real-estate' AND pp.plan_name = 'starter' AND pf.platform_slug = 'real-estate'
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- PROFESSIONAL
INSERT INTO plan_feature_access (plan_id, feature_id, is_included, override_text)
SELECT pp.id, pf.id,
  pf.feature_key IN ('active_projects','module_project_setup','module_revenue','module_opex','module_returns','module_financial_statements','module_reports','excel_export','pdf_export','community_support','email_support','priority_support'),
  CASE pf.feature_key WHEN 'active_projects' THEN '10 projects' ELSE null END
FROM platform_pricing pp CROSS JOIN platform_features pf
WHERE pp.platform_slug = 'real-estate' AND pp.plan_name = 'professional' AND pf.platform_slug = 'real-estate'
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- ENTERPRISE (everything included)
INSERT INTO plan_feature_access (plan_id, feature_id, is_included, override_text)
SELECT pp.id, pf.id, true,
  CASE pf.feature_key WHEN 'active_projects' THEN 'Unlimited' ELSE null END
FROM platform_pricing pp CROSS JOIN platform_features pf
WHERE pp.platform_slug = 'real-estate' AND pp.plan_name = 'enterprise' AND pf.platform_slug = 'real-estate'
ON CONFLICT (plan_id, feature_id) DO NOTHING;
