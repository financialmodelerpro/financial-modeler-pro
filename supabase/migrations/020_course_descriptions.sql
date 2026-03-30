-- ─────────────────────────────────────────────────────────────────────────────
-- 020_course_descriptions.sql
-- Add rich description columns to the courses table and seed initial data
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS tagline               text,
  ADD COLUMN IF NOT EXISTS full_description      text,
  ADD COLUMN IF NOT EXISTS what_you_learn        jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prerequisites         text,
  ADD COLUMN IF NOT EXISTS who_is_this_for       text,
  ADD COLUMN IF NOT EXISTS skill_level           text DEFAULT 'Beginner',
  ADD COLUMN IF NOT EXISTS duration_hours        integer,
  ADD COLUMN IF NOT EXISTS language              text DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS certificate_description text;

-- Add check constraint idempotently
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_skill_level_check;
ALTER TABLE courses ADD CONSTRAINT courses_skill_level_check
  CHECK (skill_level IN ('Beginner', 'Intermediate', 'Advanced'));

-- ── Seed 3SFM ────────────────────────────────────────────────────────────────
UPDATE courses SET
  tagline = 'Master the complete 3-statement financial model used by investment banks and corporate finance teams',
  full_description = 'This comprehensive course takes you from zero to building a fully integrated 3-statement financial model — Income Statement, Balance Sheet, and Cash Flow Statement — linked and balanced. Designed by a corporate finance practitioner with 12+ years of experience across KSA and Pakistan.',
  what_you_learn = '[
    "Build a fully integrated Income Statement, Balance Sheet and Cash Flow Statement",
    "Model Capex, depreciation, working capital and debt schedules",
    "Apply professional Excel techniques used in investment banking",
    "Create revenue models with capacity planning and production forecasts",
    "Build COGS, payroll, overhead and tax models from scratch",
    "Link all three statements and balance the Balance Sheet",
    "Generate professional-grade PDF and Excel exports",
    "Earn a verified certificate upon completion"
  ]'::jsonb,
  prerequisites = 'Basic Excel knowledge. No prior financial modeling experience required.',
  who_is_this_for = 'Finance professionals, MBA students, analysts, entrepreneurs, and anyone who wants to build professional financial models.',
  skill_level = 'Beginner',
  duration_hours = 12,
  language = 'English',
  certificate_description = 'Earn a verified digital certificate from Financial Modeler Pro upon passing all 17 assessments and the final certification exam.'
WHERE id = '00000000-0000-0000-0000-0000000035f0';

-- ── Seed BVM ─────────────────────────────────────────────────────────────────
UPDATE courses SET
  tagline = 'Learn professional business valuation — DCF, Comparable Companies and Football Field analysis',
  full_description = 'A focused course covering the three core business valuation methodologies used by investment bankers, corporate finance teams and equity researchers. Learn to build valuation models from scratch in Excel and present results in a professional Football Field chart.',
  what_you_learn = '[
    "Understand and apply DCF valuation using FCFF and FCFE",
    "Build a rolling WACC model and reconcile FCFF vs FCFE",
    "Construct a Comparable Companies (Comps) valuation model",
    "Calculate and apply valuation multiples (EV/EBITDA, P/E, EV/Revenue)",
    "Apply control premium and DLOM adjustments",
    "Build a professional Football Field chart showing valuation range",
    "Earn a verified certificate upon completion"
  ]'::jsonb,
  prerequisites = 'Basic understanding of financial statements recommended. Excel familiarity helpful.',
  who_is_this_for = 'Investment banking analysts, equity researchers, corporate finance professionals, CFA candidates, and finance students.',
  skill_level = 'Intermediate',
  duration_hours = 6,
  language = 'English',
  certificate_description = 'Earn a verified digital certificate from Financial Modeler Pro upon passing all 6 lesson assessments and the final certification exam.'
WHERE id = '00000000-0000-0000-0000-00000000b600';
