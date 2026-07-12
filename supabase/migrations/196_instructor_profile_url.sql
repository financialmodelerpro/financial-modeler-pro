-- 196_instructor_profile_url.sql
-- Author on-site profile link, auto-derived instead of typed per article.
-- Additive, non-destructive, idempotent.
--   instructors.profile_url : the author's profile page on this site (e.g.
--                             /about/ahmad-din). The article "About the author"
--                             block links here via author_profile_url, which the
--                             API snapshots from this column when left blank.
BEGIN;

ALTER TABLE instructors ADD COLUMN IF NOT EXISTS profile_url text;

-- Seed the founder's known profile page (idempotent; only when unset).
UPDATE instructors
   SET profile_url = '/about/ahmad-din'
 WHERE name ILIKE 'Ahmad Din%'
   AND (profile_url IS NULL OR profile_url = '');

-- Backfill existing articles' author_profile_url from the linked instructor's
-- profile so the "View full profile" button appears without a re-save.
UPDATE articles a
   SET author_profile_url = i.profile_url
  FROM instructors i
 WHERE a.writer_id = i.id
   AND (a.author_profile_url IS NULL OR a.author_profile_url = '')
   AND i.profile_url IS NOT NULL;

COMMIT;

-- Additive only. Drops nothing. The API snapshots author_profile_url from the
-- instructor when the per-article override is blank (schema-tolerant), and the
-- block shows the "View full profile" button only when a URL is present, so
-- nothing breaks before this migration is applied.
