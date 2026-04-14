-- Migration 083: YouTube comments cache table

CREATE TABLE IF NOT EXISTS youtube_comments_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL UNIQUE,
  comments JSONB NOT NULL DEFAULT '[]',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  comment_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_youtube_comments_video_id
  ON youtube_comments_cache(video_id);
