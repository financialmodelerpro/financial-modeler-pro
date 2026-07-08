-- 187_articles_rebuild.sql
-- Paste-and-go articles rebuild (Phase 1). Additive, non-destructive, idempotent.
-- Drops NOTHING. Safe to run once. Apply manually in Supabase.
--
-- Adds: mid-image + caption, OG image, tags[]; categories + article_categories (M2M).
-- Keeps articles.category (single text) for back-compat / dual-read.

BEGIN;

-- New article columns (hero stays = existing cover_url; no duplicate hero column).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS mid_image_url     text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS mid_image_caption text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS og_image_url      text;          -- render falls back to cover_url when NULL/empty
ALTER TABLE articles ADD COLUMN IF NOT EXISTS tags              text[] NOT NULL DEFAULT '{}';

-- Categories master table (add / edit / delete).
CREATE TABLE IF NOT EXISTS categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_name_unique UNIQUE (name),
  CONSTRAINT categories_slug_unique UNIQUE (slug)
);

-- Article <-> Category junction (single OR multiple per article).
CREATE TABLE IF NOT EXISTS article_categories (
  article_id  uuid NOT NULL REFERENCES articles(id)   ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_article_categories_article  ON article_categories(article_id);
CREATE INDEX IF NOT EXISTS idx_article_categories_category ON article_categories(category_id);

-- RLS mirrors the existing articles pattern (public read; admin via service-role bypass).
ALTER TABLE categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read categories" ON categories;
CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read article_categories" ON article_categories;
CREATE POLICY "Public read article_categories" ON article_categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin all categories" ON categories;
CREATE POLICY "Admin all categories" ON categories FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admin all article_categories" ON article_categories;
CREATE POLICY "Admin all article_categories" ON article_categories FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Backfill: seed categories from existing distinct article.category, then associate.
INSERT INTO categories (name, slug)
SELECT DISTINCT category,
       lower(regexp_replace(regexp_replace(category, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
FROM articles
WHERE COALESCE(category,'') <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO article_categories (article_id, category_id)
SELECT a.id, c.id
FROM articles a
JOIN categories c ON c.name = a.category
WHERE COALESCE(a.category,'') <> ''
ON CONFLICT DO NOTHING;

COMMIT;

-- DEPRECATION NOTE (do NOT run now): once the app reads categories from the junction
-- everywhere, articles.category becomes redundant. Leave it in place; drop only in a
-- future migration after a full read-path cutover.
