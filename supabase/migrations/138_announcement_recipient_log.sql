-- ═══════════════════════════════════════════════════════════════════════════════
-- 138: Per-recipient announcement audit log
--
-- Until now `announcement_send_log` only stored aggregate counts
-- (`recipient_count`, `success_count`, `failure_count`, `error_message` =
-- ONLY THE FIRST failure's message). When 4 of 9 emails failed, the admin
-- could see the totals but had no way to tell *which* 4, no way to retry
-- only the failures, and no per-recipient delivery status.
--
-- This migration adds a child table keyed by send_log_id. The notify route
-- now writes one row per recipient per dispatch with status 'pending',
-- then updates each row to 'sent' / 'failed' after the Resend batch
-- response. A future Resend webhook can update the same rows to
-- 'bounced' / 'complained' without schema changes.
--
-- Idempotent (IF NOT EXISTS on table + indexes). FK has ON DELETE CASCADE
-- so cleaning up an audit row removes its recipient details too.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS announcement_recipient_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  send_log_id       UUID        NOT NULL REFERENCES announcement_send_log(id) ON DELETE CASCADE,
  email             TEXT        NOT NULL,
  name              TEXT,
  registration_id   TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed', 'bounced', 'complained')),
  resend_message_id TEXT,
  error_message     TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(send_log_id, email)
);

CREATE INDEX IF NOT EXISTS idx_announcement_recipient_log_send
  ON announcement_recipient_log (send_log_id);

-- Partial index for the "retry failed" hot path: list the bad rows under a
-- given send_log without scanning the successful ones too.
CREATE INDEX IF NOT EXISTS idx_announcement_recipient_log_failed
  ON announcement_recipient_log (send_log_id) WHERE status IN ('failed', 'bounced');
