-- 188_article_writer.sql
-- Writer/instructor association for articles. Additive, non-destructive, idempotent.
BEGIN;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS writer_id    uuid REFERENCES instructors(id) ON DELETE SET NULL;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS writer_name  text;   -- snapshot at save time
ALTER TABLE articles ADD COLUMN IF NOT EXISTS writer_title text;   -- snapshot at save time

CREATE INDEX IF NOT EXISTS idx_articles_writer_id ON articles(writer_id);

COMMIT;

-- writer_id = the durable link to the instructor row (survives article edits).
-- writer_name / writer_title = a point-in-time SNAPSHOT so the byline stays stable
-- even if the instructor is later renamed or deleted (ON DELETE SET NULL keeps the snapshot).
