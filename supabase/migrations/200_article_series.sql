-- 200_article_series.sql
-- Article series / sequences. Additive, non-destructive, idempotent. Drops NOTHING.
-- Apply manually in Supabase.
--
-- Adds: article_series master table (title/slug/description) + two article columns
-- (series_id FK, series_order int) so a set of articles can be grouped into an
-- ordered reading sequence. A reader sees "Part X of Y" + ordered contents +
-- previous/next navigation. Series membership never gates access (public/SEO):
-- later parts stay openable, they are only strongly guided.

BEGIN;

-- Series master table (add / rename / delete, like categories).
CREATE TABLE IF NOT EXISTS article_series (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  slug        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_series_slug_unique UNIQUE (slug)
);

-- Article membership: nullable FK (an article need not belong to a series) +
-- an integer position within the series (source of truth for the reading order,
-- set by drag-reorder in the admin series manager). ON DELETE SET NULL so
-- deleting a series un-groups its articles rather than deleting them.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS series_id    uuid REFERENCES article_series(id) ON DELETE SET NULL;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS series_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_series ON articles(series_id, series_order);

-- RLS mirrors the categories / articles pattern (public read; admin via service role).
ALTER TABLE article_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read article_series" ON article_series;
CREATE POLICY "Public read article_series" ON article_series FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin all article_series" ON article_series;
CREATE POLICY "Admin all article_series" ON article_series FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

COMMIT;
