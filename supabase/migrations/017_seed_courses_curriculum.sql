-- ─────────────────────────────────────────────────────────────────────────────
-- 017_seed_courses_curriculum.sql
-- Seed (or replace) courses and lessons with the correct curriculum
-- matching the Apps Script COURSES_CONFIG / SHEET_SESSION_MAP
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Upsert the two courses ──────────────────────────────────────────────

-- We use fixed UUIDs so we can safely reference them in the lessons inserts
-- and re-run this migration without creating duplicates.

DO $$
DECLARE
  sfm_id uuid := '00000000-0000-0000-0000-0000000035f0';
  bvm_id uuid := '00000000-0000-0000-0000-00000000b600';
BEGIN

  -- ── 3SFM ────────────────────────────────────────────────────────────────
  INSERT INTO courses (id, title, description, category, status, display_order, thumbnail_url)
  VALUES (
    sfm_id,
    '3-Statement Financial Modeling',
    'Master the complete 3-statement financial model from scratch — Income Statement, Balance Sheet, and Cash Flow Statement — with professional Excel techniques.',
    '3SFM',
    'published',
    1,
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    title         = EXCLUDED.title,
    description   = EXCLUDED.description,
    category      = EXCLUDED.category,
    status        = EXCLUDED.status,
    display_order = EXCLUDED.display_order;

  -- ── BVM ─────────────────────────────────────────────────────────────────
  INSERT INTO courses (id, title, description, category, status, display_order, thumbnail_url)
  VALUES (
    bvm_id,
    'Business Valuation Methods',
    'Learn professional business valuation methods including DCF, comparable company analysis, and precedent transactions.',
    'BVM',
    'published',
    2,
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    title         = EXCLUDED.title,
    description   = EXCLUDED.description,
    category      = EXCLUDED.category,
    status        = EXCLUDED.status,
    display_order = EXCLUDED.display_order;

  -- ── 2. Delete old/placeholder lessons for these two courses ─────────────
  DELETE FROM lessons WHERE course_id IN (sfm_id, bvm_id);

  -- ── 3. Insert 3SFM lessons (17 regular + 1 final = 18) ──────────────────
  INSERT INTO lessons (course_id, title, youtube_url, description, file_url, duration_minutes, display_order) VALUES
    (sfm_id, 'Session 1: Introduction & Framework Overview',          'https://youtu.be/JiitBxI1DD0', '', NULL, 0,  1),
    (sfm_id, 'Session 2: Project Overview & Timeline',                '',                             '', NULL, 0,  2),
    (sfm_id, 'Session 3: Capex & Funding Requirement',                '',                             '', NULL, 0,  3),
    (sfm_id, 'Session 4: Plant Capacity & Production Plan',           '',                             '', NULL, 0,  4),
    (sfm_id, 'Session 5: Revenue & Inventory Modeling',               '',                             '', NULL, 0,  5),
    (sfm_id, 'Session 6: COGS & Raw Material Cost Modeling',          '',                             '', NULL, 0,  6),
    (sfm_id, 'Session 7: Other Direct Costs',                         '',                             '', NULL, 0,  7),
    (sfm_id, 'Session 8: General & Admin Expenses',                   '',                             '', NULL, 0,  8),
    (sfm_id, 'Session 9: Salaries & Payroll Modeling',                '',                             '', NULL, 0,  9),
    (sfm_id, 'Session 10: Product Wise Cost Allocation',              '',                             '', NULL, 0, 10),
    (sfm_id, 'Session 11: Staff Overtime Calculation',                '',                             '', NULL, 0, 11),
    (sfm_id, 'Session 12: PPE Linkage & Working Capital',             '',                             '', NULL, 0, 12),
    (sfm_id, 'Session 13: Zakat & Tax Modeling',                      '',                             '', NULL, 0, 13),
    (sfm_id, 'Session 14: Debt Schedule & Finance Cost',              '',                             '', NULL, 0, 14),
    (sfm_id, 'Session 15: Pre-Operating Costs Amortization',          '',                             '', NULL, 0, 15),
    (sfm_id, 'Session 16: Equity & Balancing the Balance Sheet',      '',                             '', NULL, 0, 16),
    (sfm_id, 'Session 17: Cash Flow Statement & Valuation',           '',                             '', NULL, 0, 17),
    (sfm_id, 'Session 18: 3SFM Final Certification Exam',             '',                             '', NULL, 0, 18);

  -- ── 4. Insert BVM lessons (6 regular + 1 final = 7) ─────────────────────
  INSERT INTO lessons (course_id, title, youtube_url, description, file_url, duration_minutes, display_order) VALUES
    (bvm_id, 'Lesson 1: DCF Valuation Overview & Framework',                        'https://youtu.be/lRdrLAHqPto', '', NULL, 0, 1),
    (bvm_id, 'Lesson 2: DCF Valuation Model in Excel — FCFF and FCFE',             '',                             '', NULL, 0, 2),
    (bvm_id, 'Lesson 3: Rolling WACC Explained — FCFF vs FCFE Reconciliation',     '',                             '', NULL, 0, 3),
    (bvm_id, 'Lesson 4: Comps Valuation Overview & Framework',                      '',                             '', NULL, 0, 4),
    (bvm_id, 'Lesson 5: Comps Valuation Model in Excel — Comps Multiples',         '',                             '', NULL, 0, 5),
    (bvm_id, 'Lesson 6: Final Business Valuation — Football Field Chart',           '',                             '', NULL, 0, 6),
    (bvm_id, 'Lesson 7: BVM Final Certification Exam',                              '',                             '', NULL, 0, 7);

END $$;
