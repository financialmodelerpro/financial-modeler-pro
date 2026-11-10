-- ═══════════════════════════════════════════════════════════════════════════════
-- 254: An attendance record can be matched to a student BY NAME.
--
-- Guests who join Teams without a Microsoft account appear in the attendance
-- report with only the display name they typed, no email. The sync now links
-- such a record to the one student who clicked Join for that session with that
-- name (liveCourse/nameMatch.ts) and records it as matched_by = 'name', so the
-- admin can see which records were matched by email, by name or by hand.
--
-- ADDITIVE: widens the allowed values; no row changes. Until this runs, the
-- sync leaves a would-be name match unmatched with the student suggested.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE live_session_attendance DROP CONSTRAINT IF EXISTS live_session_attendance_matched_by_check;
ALTER TABLE live_session_attendance
  ADD CONSTRAINT live_session_attendance_matched_by_check
  CHECK (matched_by IN ('email', 'alias', 'name', 'manual'));
