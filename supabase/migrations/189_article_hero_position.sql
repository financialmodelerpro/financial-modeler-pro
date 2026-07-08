-- 189_article_hero_position.sql
-- Per-article hero placement toggle. Additive, non-destructive, idempotent.
BEGIN;

-- false (default) = hero renders AFTER the title/byline header (current behavior).
-- true             = hero renders BEFORE the header (above title/subtitle/byline).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS hero_before_content boolean NOT NULL DEFAULT false;

COMMIT;

-- Existing rows default to false = current behavior, so no published article changes.
-- App reads are schema-tolerant (absent column -> treated as false), so nothing breaks
-- in the window between deploy and applying this migration.
