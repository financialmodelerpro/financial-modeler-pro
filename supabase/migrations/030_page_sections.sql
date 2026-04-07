-- ============================================================
-- 030: Dynamic CMS Page Sections
-- Modular block-based page builder system
-- ============================================================

CREATE TABLE IF NOT EXISTS page_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug     text NOT NULL,            -- e.g. 'home', 'about', 'contact', 'my-custom-page'
  section_type  text NOT NULL,            -- 'hero','text','rich_text','image','text_image','columns','cards','cta','faq','stats','list'
  content       jsonb NOT NULL DEFAULT '{}',
  display_order int NOT NULL DEFAULT 0,
  visible       boolean NOT NULL DEFAULT true,
  styles        jsonb DEFAULT '{}',       -- bg color, padding, text color, max-width overrides
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_sections_slug ON page_sections (page_slug, display_order);
CREATE INDEX idx_page_sections_visible ON page_sections (page_slug) WHERE visible = true;

-- Optional: page metadata table for slug → title / SEO / status mapping
CREATE TABLE IF NOT EXISTS cms_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,     -- URL slug (e.g. 'about', 'pricing', 'new-page')
  title         text NOT NULL DEFAULT '',
  seo_title     text DEFAULT '',
  seo_description text DEFAULT '',
  status        text NOT NULL DEFAULT 'draft',  -- 'draft' | 'published'
  is_system     boolean NOT NULL DEFAULT false,  -- true for built-in pages (home, about, etc.)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Seed system pages so they appear in admin page list
INSERT INTO cms_pages (slug, title, status, is_system) VALUES
  ('home',       'Home',           'published', true),
  ('about',      'About',          'published', true),
  ('pricing',    'Pricing',        'published', true),
  ('articles',   'Articles',       'published', true),
  ('contact',    'Contact',        'published', true),
  ('training',   'Training Hub',   'published', true),
  ('modeling',   'Modeling Hub',   'published', true)
ON CONFLICT (slug) DO NOTHING;
