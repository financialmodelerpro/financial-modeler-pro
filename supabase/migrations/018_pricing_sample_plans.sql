-- ─────────────────────────────────────────────────────────────────────────────
-- 018_pricing_sample_plans.sql
-- Replace seed plans with complete sample plans + features
-- All future changes should be made via /admin/pricing
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Reset existing plan + feature data ────────────────────────────────────
DELETE FROM pricing_features;
DELETE FROM pricing_modules;
DELETE FROM pricing_plans;

-- ── 2. Insert fresh plans ─────────────────────────────────────────────────────

INSERT INTO pricing_plans
  (name, code, tagline, price_monthly, price_yearly, price_display, currency,
   is_featured, is_active, is_public, is_custom_client,
   badge_text, badge_color, cta_text, cta_url, highlight_color, display_order)
VALUES
  -- Free
  ('Free', 'free',
   'Everything you need to get started',
   0, 0, 'Free Forever', 'USD',
   false, true, true, false,
   NULL, 'grey', 'Get Started Free', '/login', '#6B7280', 1),

  -- Professional
  ('Professional', 'professional',
   'For serious financial modelers',
   49, 470, '$49 / month', 'USD',
   true, true, true, false,
   'Most Popular', 'green', 'Start Free Trial', '/login', '#1B4F8A', 2),

  -- Enterprise
  ('Enterprise', 'enterprise',
   'For firms and teams',
   NULL, NULL, 'Contact Us', 'USD',
   false, true, true, false,
   'For Teams', 'gold', 'Contact Sales', '/contact', '#C9A84C', 3);

-- ── 3. Insert features for each plan ─────────────────────────────────────────

-- Helper: grab plan ids
DO $$
DECLARE
  free_id   uuid;
  pro_id    uuid;
  ent_id    uuid;
BEGIN
  SELECT id INTO free_id   FROM pricing_plans WHERE code = 'free';
  SELECT id INTO pro_id    FROM pricing_plans WHERE code = 'professional';
  SELECT id INTO ent_id    FROM pricing_plans WHERE code = 'enterprise';

  -- ── Access ────────────────────────────────────────────────────────────────
  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (free_id, 'Access', 'Modeling Hub access',             true,  1),
    (free_id, 'Access', 'Training Hub access',             true,  2),
    (free_id, 'Access', 'Free certification courses',      true,  3),
    (free_id, 'Access', 'All financial model templates',   false, 4),
    (free_id, 'Access', 'Advanced module unlocks',         false, 5),
    (free_id, 'Access', 'Priority support',                false, 6);

  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (pro_id, 'Access', 'Modeling Hub access',              true, 1),
    (pro_id, 'Access', 'Training Hub access',              true, 2),
    (pro_id, 'Access', 'Free certification courses',       true, 3),
    (pro_id, 'Access', 'All financial model templates',    true, 4),
    (pro_id, 'Access', 'Advanced module unlocks',          true, 5),
    (pro_id, 'Access', 'Priority support',                 true, 6);

  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (ent_id, 'Access', 'Modeling Hub access',              true, 1),
    (ent_id, 'Access', 'Training Hub access',              true, 2),
    (ent_id, 'Access', 'Free certification courses',       true, 3),
    (ent_id, 'Access', 'All financial model templates',    true, 4),
    (ent_id, 'Access', 'Advanced module unlocks',          true, 5),
    (ent_id, 'Access', 'Priority support',                 true, 6);

  -- ── Models ────────────────────────────────────────────────────────────────
  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (free_id, 'Models', '3-Statement Financial Model',     true,  1),
    (free_id, 'Models', 'Real Estate model',               false, 2),
    (free_id, 'Models', 'Business Valuation model',        false, 3),
    (free_id, 'Models', 'Project Finance model',           false, 4),
    (free_id, 'Models', 'Excel + PDF export',              false, 5);

  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (pro_id, 'Models', '3-Statement Financial Model',      true, 1),
    (pro_id, 'Models', 'Real Estate model',                true, 2),
    (pro_id, 'Models', 'Business Valuation model',         true, 3),
    (pro_id, 'Models', 'Project Finance model',            true, 4),
    (pro_id, 'Models', 'Excel + PDF export',               true, 5);

  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (ent_id, 'Models', '3-Statement Financial Model',      true, 1),
    (ent_id, 'Models', 'Real Estate model',                true, 2),
    (ent_id, 'Models', 'Business Valuation model',         true, 3),
    (ent_id, 'Models', 'Project Finance model',            true, 4),
    (ent_id, 'Models', 'Excel + PDF export',               true, 5);

  -- ── Collaboration ─────────────────────────────────────────────────────────
  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (free_id, 'Collaboration', 'Save & load projects',     true,  1),
    (free_id, 'Collaboration', 'Unlimited projects',       false, 2),
    (free_id, 'Collaboration', 'Team workspace',           false, 3),
    (free_id, 'Collaboration', 'White-label branding',     false, 4);

  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (pro_id, 'Collaboration', 'Save & load projects',      true, 1),
    (pro_id, 'Collaboration', 'Unlimited projects',        true, 2),
    (pro_id, 'Collaboration', 'Team workspace',            false, 3),
    (pro_id, 'Collaboration', 'White-label branding',      false, 4);

  INSERT INTO pricing_features (plan_id, category, feature_text, is_included, display_order) VALUES
    (ent_id, 'Collaboration', 'Save & load projects',      true, 1),
    (ent_id, 'Collaboration', 'Unlimited projects',        true, 2),
    (ent_id, 'Collaboration', 'Team workspace',            true, 3),
    (ent_id, 'Collaboration', 'White-label branding',      true, 4);

END $$;
