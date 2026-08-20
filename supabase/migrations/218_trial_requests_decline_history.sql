-- 218: trial request decline history (2026-08-20).
--
-- A DECLINED REQUEST CAN NOW BE APPROVED LATER (an admin declines, speaks
-- with the user, changes their mind). Before this, a declined row vanished
-- from the queue and approve returned 409, so the only routes back were the
-- user requesting again or a manual plan assignment.
--
-- Approving a declined row rewrites decided_at / decided_by with the
-- APPROVAL, which would have erased the decline. These two columns keep it:
-- the decline's own timestamp and deciding admin, written at decline time and
-- NEVER overwritten afterwards, so the history reads "declined by A at T1,
-- approved by B at T2" with both halves intact.
--
-- ADDITIVE ONLY. No column dropped or altered, every existing row keeps NULL
-- (the API backfills a legacy declined row's history from decided_at /
-- decided_by at the moment it is approved, since at that point those still
-- hold the decline). The route is schema tolerant: without this migration it
-- falls back to the overwriting behaviour and the queue still works.

ALTER TABLE trial_requests ADD COLUMN IF NOT EXISTS declined_at timestamptz;
ALTER TABLE trial_requests ADD COLUMN IF NOT EXISTS declined_by uuid;

COMMENT ON COLUMN trial_requests.declined_at IS
  'When this request was declined. Survives a later approval; decided_at then holds the approval.';
COMMENT ON COLUMN trial_requests.declined_by IS
  'The admin who declined. Survives a later approval; decided_by then holds the approver.';
