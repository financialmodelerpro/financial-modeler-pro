-- 195_article_author_about.sql
-- "About the author" block for articles. Additive, non-destructive, idempotent.
--   author_bio          : the bio shown in the end-of-article author block. When
--                         left blank on save the API snapshots the linked
--                         instructor's bio, so the common (founder) case needs no
--                         typing; a different author can be written up by hand.
--   author_profile_url  : link to the author's full profile page on the site
--                         (e.g. /about/ahmad-din). Rendered as "View full profile".
BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS author_bio         text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS author_profile_url text;

-- Backfill: seed author_bio from the linked instructor's bio for existing articles
-- so published content shows the author block immediately without a re-save.
UPDATE articles a
   SET author_bio = i.bio
  FROM instructors i
 WHERE a.writer_id = i.id
   AND (a.author_bio IS NULL OR a.author_bio = '')
   AND i.bio IS NOT NULL;

COMMIT;

-- Additive only. Drops nothing. The API snapshots author_bio from the instructor
-- when blank + passes both through (schema-tolerant: stripped on a missing-column
-- retry), and the public page renders the author block only when a bio is present,
-- so nothing breaks before this migration is applied.
