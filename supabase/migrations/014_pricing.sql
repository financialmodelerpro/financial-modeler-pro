-- ─────────────────────────────────────────────────────────────────────────────
-- 014_pricing.sql
-- Pricing plans, features, and module access management
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing_plans (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name              text        NOT NULL,
  code              text        NOT NULL UNIQUE,
  tagline           text,
  description       text,
  price_monthly     numeric     DEFAULT 0,
  price_yearly      numeric,
  price_display     text,
  currency          text        DEFAULT 'USD',
  billing_period    text        DEFAULT 'month',
  is_featured       boolean     DEFAULT false,
  is_active         boolean     DEFAULT true,
  is_public         boolean     DEFAULT true,
  is_custom_client  boolean     DEFAULT false,
  client_name       text,
  client_user_ids   text[],
  badge_text        text,
  badge_color       text        DEFAULT 'green',
  cta_text          text        DEFAULT 'Get Started',
  cta_url           text        DEFAULT '/login',
  highlight_color   text,
  display_order     integer     DEFAULT 0,
  max_users         integer,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_features (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id       uuid    REFERENCES pricing_plans(id) ON DELETE CASCADE,
  category      text    DEFAULT 'General',
  feature_text  text    NOT NULL,
  tooltip       text,
  is_included   boolean DEFAULT true,
  display_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pricing_modules (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id     uuid    REFERENCES pricing_plans(id) ON DELETE CASCADE,
  module_code text    NOT NULL,
  is_included boolean DEFAULT true,
  UNIQUE (plan_id, module_code)
);

-- RLS
ALTER TABLE pricing_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_modules  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active plans"    ON pricing_plans;
DROP POLICY IF EXISTS "Admin full access plans"     ON pricing_plans;
DROP POLICY IF EXISTS "Public read features"        ON pricing_features;
DROP POLICY IF EXISTS "Admin full access features"  ON pricing_features;
DROP POLICY IF EXISTS "Admin full access modules"   ON pricing_modules;

CREATE POLICY "Public read active plans"    ON pricing_plans    FOR SELECT USING (is_public = true AND is_active = true);
CREATE POLICY "Admin full access plans"     ON pricing_plans    FOR ALL    USING (true);
CREATE POLICY "Public read features"        ON pricing_features FOR SELECT USING (true);
CREATE POLICY "Admin full access features"  ON pricing_features FOR ALL    USING (true);
CREATE POLICY "Admin full access modules"   ON pricing_modules  FOR ALL    USING (true);

-- Seed initial plans
INSERT INTO pricing_plans (name, code, tagline, price_monthly, price_display, is_active, is_public, cta_text, cta_url, display_order)
VALUES ('Free', 'free', 'Get started at no cost', 0, '$0 / month', true, true, 'Start Free', '/login', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO pricing_plans (name, code, tagline, price_monthly, price_display, is_featured, badge_text, badge_color, cta_text, cta_url, highlight_color, display_order)
VALUES ('Professional', 'professional', 'For serious financial modelers', 29, '$29 / month', true, 'Most Popular', 'green', 'Get Started', '/login', '#1B4F8A', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO pricing_plans (name, code, tagline, price_monthly, price_display, badge_text, badge_color, cta_text, cta_url, highlight_color, display_order)
VALUES ('Enterprise', 'enterprise', 'For teams and organizations', null, 'Contact Us', 'Enterprise', 'gold', 'Contact Sales', '/contact', '#C9A84C', 3)
ON CONFLICT (code) DO NOTHING;

-- Update landing page Pricing nav link to dedicated page
UPDATE site_pages SET href = '/pricing' WHERE label = 'Pricing';
