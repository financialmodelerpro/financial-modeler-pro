-- 194_article_writer_avatar.sql
-- Per-article writer PHOTO snapshot for the byline. Additive, non-destructive,
-- idempotent. Mirrors the writer_name / writer_title snapshot (mig 188): the
-- photo is captured at save time from the linked instructor's photo_url so the
-- byline stays stable even if the instructor photo later changes.
BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS writer_avatar_url text;

-- Backfill existing articles that already have a linked writer: copy the current
-- instructor photo so published content shows the author photo immediately,
-- without needing a re-save. Only fills rows that don't already have one.
UPDATE articles a
   SET writer_avatar_url = i.photo_url
  FROM instructors i
 WHERE a.writer_id = i.id
   AND a.writer_avatar_url IS NULL
   AND i.photo_url IS NOT NULL;

COMMIT;

-- Additive only. Drops nothing. The API resolves + snapshots writer_avatar_url
-- from writer_id on every save (schema-tolerant: stripped on retry if this
-- column is absent), and the public byline renders the photo when present, else
-- initials, so nothing breaks before this migration is applied.
