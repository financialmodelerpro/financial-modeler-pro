-- Migration 141: re-tag misplaced BVM attachments back to BVM tab_keys
--
-- Bug: /admin/training/[courseId]/page.tsx checked
-- `courseId?.toLowerCase() === 'bvm'` to decide whether to write
-- BVM_L{N} or 3SFM_S{N} as the tab_key. The page is reached via
-- /admin/training/<UUID> (links from the course list use c.id), so
-- courseId is the course's UUID, not the short code. The comparison
-- was therefore always false, and every BVM upload was silently routed
-- to the 3SFM bucket, colliding with real 3SFM session attachments.
--
-- The code was fixed in the same commit (now derives the prefix from
-- course.category, the loaded course's category column). This migration
-- repairs the three production rows that the bug already wrote with
-- the wrong tab_key + course.
--
-- Identification: every misplaced row has 'BVM' in the file_name. None
-- of the legitimate 3SFM rows do, so a filename heuristic is safe here.
-- Idempotent: WHERE clauses are pinned by row id, so re-running is a
-- no-op if the rows have already been corrected.
--
-- Mapping (verified against BVM lessons table):
--   id 142051c5...  3SFM_S1 -> BVM_L1  (FMP_BVM_DCF_Training_Handbook.pdf)
--   id 436b1fd7...  3SFM_S4 -> BVM_L4  (FMP_BVM_Comps_Training_Handbook.pdf)
--   id 541c36d8...  3SFM_S5 -> BVM_L5  (FMP_BVM_Comps_Template.xlsx)

UPDATE course_attachments
   SET tab_key = 'BVM_L1', course = 'bvm'
 WHERE id = '142051c5-fb75-4aed-975d-3a88f985f1c3';

UPDATE course_attachments
   SET tab_key = 'BVM_L4', course = 'bvm'
 WHERE id = '436b1fd7-1473-4f6d-851c-fb07943fa4a6';

UPDATE course_attachments
   SET tab_key = 'BVM_L5', course = 'bvm'
 WHERE id = '541c36d8-825e-437b-aa80-ed79a390224f';
