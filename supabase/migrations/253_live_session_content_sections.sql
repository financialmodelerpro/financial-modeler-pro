-- ═══════════════════════════════════════════════════════════════════════════════
-- 253: Live-course session page content as bullet lists.
--
-- ADDITIVE. One jsonb object per session holding eight lists of strings:
--   overview, learnConcepts, learnHandsOn, flow, build, claude, before, after
-- (liveCourse/sessionContent.ts is the one reader and normaliser). An empty
-- object means "no new content": the session page then maps the mig 251
-- fields (content_overview, content_learn, content_outcome, content_claude),
-- which stay in place, so every other course renders as before.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS content_sections JSONB NOT NULL DEFAULT '{}'::JSONB;
