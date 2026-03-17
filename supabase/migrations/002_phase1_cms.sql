-- Financial Modeler Pro - Phase 1 CMS Schema
-- Run this in Supabase SQL Editor
-- All comments use plain ASCII only (no Unicode box-drawing characters)
-- Safe to re-run: uses IF NOT EXISTS + DROP POLICY IF EXISTS + ON CONFLICT

-- =============================================================================
-- 1. Extend users table
-- =============================================================================
ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- =============================================================================
-- 2. cms_content
-- =============================================================================
CREATE TABLE IF NOT EXISTS cms_content (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section    text NOT NULL,
  key        text NOT NULL,
  value      text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(section, key)
);

ALTER TABLE cms_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read cms_content" ON cms_content;
CREATE POLICY "Public read cms_content" ON cms_content
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write cms_content" ON cms_content;
CREATE POLICY "Admin write cms_content" ON cms_content
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================================================
-- 3. modules
-- =============================================================================
CREATE TABLE IF NOT EXISTS modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  description   text NOT NULL DEFAULT '',
  icon          text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'coming_soon' CHECK (status IN ('live','coming_soon','hidden')),
  display_order int NOT NULL DEFAULT 0,
  launch_date   date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read modules" ON modules;
CREATE POLICY "Public read modules" ON modules
  FOR SELECT USING (status != 'hidden');

DROP POLICY IF EXISTS "Admin write modules" ON modules;
CREATE POLICY "Admin write modules" ON modules
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================================================
-- 4. asset_types
-- =============================================================================
CREATE TABLE IF NOT EXISTS asset_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  icon          text NOT NULL DEFAULT '',
  visible       boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE asset_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read asset_types" ON asset_types;
CREATE POLICY "Public read asset_types" ON asset_types
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write asset_types" ON asset_types;
CREATE POLICY "Admin write asset_types" ON asset_types
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================================================
-- 5. founder_profile
-- =============================================================================
CREATE TABLE IF NOT EXISTS founder_profile (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section    text NOT NULL,
  key        text NOT NULL,
  value      text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(section, key)
);

ALTER TABLE founder_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read founder_profile" ON founder_profile;
CREATE POLICY "Public read founder_profile" ON founder_profile
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write founder_profile" ON founder_profile;
CREATE POLICY "Admin write founder_profile" ON founder_profile
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================================================
-- 6. articles
-- =============================================================================
CREATE TABLE IF NOT EXISTS articles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  slug            text NOT NULL UNIQUE,
  body            text NOT NULL DEFAULT '',
  cover_url       text,
  category        text NOT NULL DEFAULT 'General',
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled')),
  seo_title       text,
  seo_description text,
  featured        boolean NOT NULL DEFAULT false,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published articles" ON articles;
CREATE POLICY "Public read published articles" ON articles
  FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Admin all articles" ON articles;
CREATE POLICY "Admin all articles" ON articles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================================================
-- 7. courses
-- =============================================================================
CREATE TABLE IF NOT EXISTS courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  thumbnail_url text,
  category      text NOT NULL DEFAULT 'General',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published courses" ON courses;
CREATE POLICY "Public read published courses" ON courses
  FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "Admin all courses" ON courses;
CREATE POLICY "Admin all courses" ON courses
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================================================
-- 8. lessons
-- =============================================================================
CREATE TABLE IF NOT EXISTS lessons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            text NOT NULL,
  youtube_url      text NOT NULL DEFAULT '',
  description      text NOT NULL DEFAULT '',
  file_url         text,
  duration_minutes int NOT NULL DEFAULT 0,
  display_order    int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read lessons for published courses" ON lessons;
CREATE POLICY "Public read lessons for published courses" ON lessons
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM courses WHERE id = course_id AND status = 'published')
  );

DROP POLICY IF EXISTS "Admin all lessons" ON lessons;
CREATE POLICY "Admin all lessons" ON lessons
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =============================================================================
-- 9. enrollments
-- =============================================================================
CREATE TABLE IF NOT EXISTS enrollments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  progress       int NOT NULL DEFAULT 0,
  last_lesson_id uuid REFERENCES lessons(id) ON DELETE SET NULL,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, course_id)
);

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own enrollments" ON enrollments;
CREATE POLICY "Users read own enrollments" ON enrollments
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own enrollments" ON enrollments;
CREATE POLICY "Users insert own enrollments" ON enrollments
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own enrollments" ON enrollments;
CREATE POLICY "Users update own enrollments" ON enrollments
  FOR UPDATE USING (user_id = auth.uid());

-- =============================================================================
-- 10. certificates
-- =============================================================================
CREATE TABLE IF NOT EXISTS certificates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  download_url text,
  UNIQUE(user_id, course_id)
);

ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own certificates" ON certificates;
CREATE POLICY "Users read own certificates" ON certificates
  FOR SELECT USING (user_id = auth.uid());

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Seed modules
INSERT INTO modules (name, slug, description, icon, status, display_order) VALUES
('Real Estate Financial Modeling', 'real-estate', 'Multi-asset real estate development models covering residential, hospitality, retail, commercial, industrial, data centers, and construction. Monthly or annual, multi-currency.', '🏗️', 'live', 1),
('Business Valuation', 'business-valuation', 'DCF analysis, comparable companies, precedent transactions, sum of parts, and LBO quick check.', '💼', 'coming_soon', 2),
('FP&A Modeling', 'fpa-modeling', 'Annual budgets, rolling forecasts, budget vs actual variance analysis, and department P&L.', '📊', 'coming_soon', 3),
('Equity Research', 'equity-research', 'Financial model templates, initiation of coverage reports, earnings models, and sector-specific models.', '📈', 'coming_soon', 4),
('Project Finance', 'project-finance', 'Infrastructure PPP, power and energy models, concession modeling, DSCR analysis, and debt sculpting.', '🏦', 'coming_soon', 5),
('LBO Modeling', 'lbo-modeling', 'Full leveraged buyout models -- sources and uses, debt schedule, management equity, returns waterfall.', '🔄', 'coming_soon', 6),
('Corporate Finance', 'corporate-finance', 'M&A models, merger consequences, accretion/dilution analysis, synergy modeling, fairness opinions.', '🌍', 'coming_soon', 7),
('Energy & Utilities', 'energy-utilities', 'Solar, wind, oil and gas, utility rate models, carbon credits, and power purchase agreements.', '⚡', 'coming_soon', 8),
('Startup & Venture', 'startup-venture', 'SaaS unit economics, runway and burn analysis, cap table modeling, cohort analysis, VC returns.', '🚀', 'coming_soon', 9),
('Banking & Credit', 'banking-credit', 'Credit analysis, loan modeling, NPL workout, Basel compliance, portfolio stress testing.', '🏛️', 'coming_soon', 10)
ON CONFLICT (slug) DO NOTHING;

-- Seed asset_types for Real Estate module
DO $$
DECLARE re_id uuid;
BEGIN
  SELECT id INTO re_id FROM modules WHERE slug = 'real-estate';
  IF re_id IS NOT NULL THEN
    INSERT INTO asset_types (module_id, name, description, icon, visible, display_order) VALUES
    (re_id, 'Residential', 'Apartments, villas, townhouses, compounds. Unit mix, sellable area, phased delivery, sales revenue, equity paydown, IRR.', '🏘️', true, 1),
    (re_id, 'Hospitality', 'Hotels, serviced apartments, resorts. Room count, ADR, occupancy, RevPAR, operator structures, management fees.', '🏨', true, 2),
    (re_id, 'Retail', 'Malls, strip retail, F&B pads. GLA, tenant mix, lease terms, passing rent, reversionary yield, anchor tenants.', '🛍️', true, 3),
    (re_id, 'Commercial Office', 'Office buildings, business parks, co-working. NLA, WALE, cap rate, lease expiry profile, vacancy assumptions.', '🏢', false, 4),
    (re_id, 'Industrial & Logistics', 'Warehouses, logistics hubs, cold storage, manufacturing. Industrial yields and escalation clauses.', '🏭', false, 5),
    (re_id, 'Data Centers', 'Colocation, hyperscale, edge. Power (MW), rack units, PUE, OPEX modeling, cloud revenue streams.', '💾', false, 6),
    (re_id, 'Construction & Infrastructure', 'Civil works, master plans, mixed developments. Cost phasing, contractor payments, milestone billing.', '🏗️', false, 7)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Seed cms_content (landing page text + platform settings)
INSERT INTO cms_content (section, key, value) VALUES
('hero', 'headline', 'The Professional Hub for Financial Modeling'),
('hero', 'subheadline', 'From real estate to business valuation -- structured models, free training, and professional-grade exports. All in one platform.'),
('hero', 'cta_primary_label', 'Explore Modeling Hub'),
('hero', 'cta_secondary_label', 'Access Free Training'),
('stats', 'projects', '500+'),
('stats', 'modules', '10+'),
('stats', 'exports', 'Excel + PDF'),
('stats', 'assets', '3'),
('stats', 'stat1_value', '10+'),
('stats', 'stat1_label', 'Modeling Platforms'),
('stats', 'stat2_value', '100%'),
('stats', 'stat2_label', 'Free Training'),
('stats', 'stat3_value', 'Excel + PDF'),
('stats', 'stat3_label', 'Export Formats'),
('stats', 'stat4_value', '20+'),
('stats', 'stat4_label', 'Currencies Supported'),
('about', 'what_is_fmp', 'Financial Modeler Pro is a professional-grade real estate financial modeling platform built for developers, analysts, and investors. It replaces complex spreadsheets with a structured, guided workflow that produces audit-ready models in a fraction of the time.'),
('about', 'what_is_fmp_2', 'Every assumption is traceable. Every output is formatted for investor presentation. And every model can be exported to a formula-linked Excel workbook or a clean investor PDF -- ready to share on day one.'),
('navbar', 'beta_badge_visible', 'true'),
('footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants'),
('footer', 'founder_line', 'Ahmad Din -- CEO & Founder'),
('footer', 'copyright', '2026 Financial Modeler Pro. All rights reserved.'),
('platform', 'name',              'Financial Modeler Pro'),
('platform', 'tagline',           'The Professional Hub for Financial Modeling'),
('platform', 'logo_url',          ''),
('platform', 'favicon_url',       ''),
('platform', 'primary_color',     '#1B4F8A'),
('site',     'maintenance_mode',  'false'),
('site',     'maintenance_message','We are performing scheduled maintenance. Back shortly.'),
('seo',      'meta_title',        'Financial Modeler Pro -- Professional Financial Modeling Platform'),
('seo',      'meta_description',  'Build, export, and present professional financial models. Covering real estate, business valuation, FP&A, LBO, project finance, and more.'),
('seo',      'og_image_url',      '')
ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Seed founder_profile
INSERT INTO founder_profile (section, key, value) VALUES
('bio', 'name', 'Ahmad Din'),
('bio', 'title', 'Founder & Lead Instructor'),
('bio', 'organisation', 'CEO & Founder -- Financial Modeler Pro | PaceMakers Business Consultants'),
('bio', 'location', 'Lahore, Pakistan'),
('bio', 'linkedin_url', ''),
('bio', 'youtube_url', ''),
('bio', 'photo_url', ''),
('bio', 'short_bio', 'Corporate Finance and Transaction Advisory specialist with deep expertise in financial modeling across real estate, business valuation, and corporate finance. Founder of Financial Modeler Pro and PaceMakers Business Consultants.'),
('bio', 'long_bio', 'Ahmad Din is a Corporate Finance and Transaction Advisory Specialist with deep expertise in financial modeling across real estate, business valuation, and corporate finance.

He is the founder of Financial Modeler Pro and PaceMakers Business Consultants, through which he has delivered advisory work and financial modeling training across the Middle East and South Asia.

Before founding FMP, Ahmad built financial models for actual transactions, feasibility studies, and investor presentations -- across residential towers, hospitality developments, mixed-use projects, and corporate M&A. He noticed the same spreadsheet problems kept appearing on every engagement, and built FMP to solve them permanently.'),
('experience', 'item_1', 'Founded Financial Modeler Pro -- a professional-grade financial modeling platform'),
('experience', 'item_2', 'CEO & Founder of PaceMakers Business Consultants -- transaction advisory and financial modeling'),
('experience', 'item_3', 'Delivered financial modeling training across Middle East and South Asia'),
('experience', 'item_4', 'Built models for residential towers, hospitality, mixed-use, and M&A transactions'),
('experience', 'item_5', 'Expertise in real estate finance, DCF analysis, and structured deal advisory'),
('philosophy', 'text', 'A good financial model is not just a calculation -- it is a communication tool. Every assumption should be visible, every output should be traceable, and the final product should be something you would be proud to present to a board or an investor committee without reformatting.')
ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- =============================================================================
-- SET ADMIN USER
-- Uncomment and replace with the actual email address to grant admin access:
-- UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
-- =============================================================================
