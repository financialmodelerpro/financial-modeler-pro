-- ============================================================
--  173_trial_requests.sql
--  Trial REQUEST queue, used only when "Trial requires approval" is ON (the
--  toggle lives in cms_content entitlements/trial_requires_approval; default is
--  OFF = self-serve, which grants the trial immediately and needs no row here).
--
--  When approval is on, a logged-in user's "Start free trial" creates one pending
--  row (snapshotting their company/job_title so approval is one click, not a
--  second form). An admin approves -> the SHARED setUserPlan(...,'trial') runs
--  (same path as every plan change); decline just marks the row.
--
--  SECURITY: read/written ONLY server-side with the service-role client. RLS
--  ENABLED with NO policies (anon/auth keys cannot touch it; service role
--  bypasses). Both the self-serve grant and the approval reuse setUserPlan, so
--  this table never holds plan logic, only the request lifecycle.
--
--  Apply manually via the Supabase dashboard. Idempotent. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS trial_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     text NOT NULL DEFAULT 'real-estate',
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'declined')),
  company      text,
  job_title    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid
);

-- One open request per user keeps the queue clean and the self-serve/approve
-- paths idempotent (a re-click updates the same pending row).
CREATE UNIQUE INDEX IF NOT EXISTS trial_requests_one_pending
  ON trial_requests (user_id) WHERE status = 'pending';

ALTER TABLE trial_requests ENABLE ROW LEVEL SECURITY;
