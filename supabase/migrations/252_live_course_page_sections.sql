-- ═══════════════════════════════════════════════════════════════════════════════
-- 252: Live course landing page sections.
--
-- One JSON value per course holding the public page's sections: which are on,
-- their order, and their content (hero facts, skills, who it is for,
-- certification steps, tools, testimonial picks, FAQ, final call to action,
-- the side card's enrolled-count threshold). The shape and its defaults live
-- in code (liveCourse/pageSections.ts), which merges this value over them, so
-- an empty object renders the default layout and a new section added in code
-- appears with its default.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE training_course_settings
  ADD COLUMN IF NOT EXISTS page_sections JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN training_course_settings.page_sections IS
  'Landing page sections (mig 252): {order: [...], sections: {key: {enabled, ...content}}}; merged over the defaults in pageSections.ts.';
