-- ============================================================
-- 076: Per-platform pricing + coupon codes
-- ============================================================

-- Platform-specific pricing plans
CREATE TABLE IF NOT EXISTS platform_pricing (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  platform_slug TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  plan_label TEXT NOT NULL,
  price_monthly DECIMAL(10,2),
  price_label TEXT,
  description TEXT,
  is_featured BOOLEAN DEFAULT false,
  is_custom BOOLEAN DEFAULT false,
  badge_text TEXT,
  badge_color TEXT DEFAULT '#1ABC9C',
  cta_text TEXT DEFAULT 'Get Started',
  cta_url TEXT DEFAULT '/register',
  features JSONB DEFAULT '[]'::jsonb,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  trial_days INTEGER DEFAULT 0,
  max_projects INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE platform_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access platform_pricing" ON platform_pricing FOR ALL USING (true);

-- Coupon codes
CREATE TABLE IF NOT EXISTS coupon_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL,
  applicable_plans JSONB DEFAULT '[]'::jsonb,
  applicable_platforms JSONB DEFAULT '[]'::jsonb,
  max_uses INTEGER,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE coupon_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access coupon_codes" ON coupon_codes FOR ALL USING (true);

-- Seed Real Estate pricing plans
INSERT INTO platform_pricing (
  platform_slug, plan_name, plan_label,
  price_monthly, price_label, description,
  is_featured, badge_text, badge_color,
  cta_text, cta_url, trial_days,
  max_projects, display_order, features
) VALUES
(
  'real-estate', 'free_trial', 'Free Trial',
  0, 'Free · 15 Days',
  'Try the platform with no commitment',
  false, null, null,
  'Start Free Trial', '/register',
  15, 1, 1,
  '["1 active project", "All platform modules", "Community support", "15-day access"]'::jsonb
),
(
  'real-estate', 'starter', 'Starter',
  null, 'Coming Soon',
  'For individual analysts and consultants',
  false, 'Coming Soon', '#B45309',
  'Coming Soon', '#',
  0, 5, 2,
  '["3-5 active projects", "All platform modules", "Email support"]'::jsonb
),
(
  'real-estate', 'professional', 'Professional',
  699, '$699 / month',
  'For serious financial modelers',
  true, 'Most Popular', '#1ABC9C',
  'Get Professional', '/register',
  0, 10, 3,
  '["10 active projects", "All platform modules", "Excel export", "PDF export", "Priority support", "Advanced analytics"]'::jsonb
),
(
  'real-estate', 'enterprise', 'Enterprise',
  999, '$999 / month',
  'For firms and teams',
  false, 'For Teams', '#C9A84C',
  'Contact Sales', '/contact',
  0, null, 4,
  '["Unlimited projects", "All platform modules", "Excel + PDF export", "White-label option", "Dedicated support", "Custom integrations", "Team workspace"]'::jsonb
);

-- Seed a sample coupon
INSERT INTO coupon_codes (code, discount_type, discount_value, applicable_platforms, max_uses)
VALUES ('LAUNCH20', 'percentage', 20, '["real-estate"]'::jsonb, 100);
