-- ============================================================
--  205_ai_usage_metering.sql
--  AI foundation: server-side metering storage.
--  ADDITIVE ONLY: creates one table + one function, alters/drops nothing.
--
--  WHY THIS EXISTS
--    Migration 203 gave every AI feature per-plan caps, and the admin panel
--    (/admin/ai-features) edits them live. Nothing enforced them: the caps were
--    read only to fill an input box. This migration adds the missing half, the
--    durable counter that lets a cap actually block a call.
--
--  WHY A TABLE AND NOT AN IN-MEMORY COUNTER
--    Serverless instances are recycled constantly, so an in-process counter
--    resets unpredictably. It would pass a hand test and enforce nothing in
--    production, which is worse than no enforcement because it looks like
--    protection.
--
--  MONTHLY RESET WITH NO CRON
--    period_start is the first day of the calendar month (UTC). A new month
--    simply means a new row, so usage "resets" without a scheduled job that
--    could fail silently. History is retained rather than zeroed, so the admin
--    panel can show prior periods later.
--
--  WHY A FUNCTION AND NOT check-then-increment IN THE APP
--    Reading the count, comparing it to the cap, and then incrementing is a
--    race: two concurrent generations can both read "4 of 5" and both proceed.
--    ai_usage_consume does the whole decision in ONE atomic statement, so the
--    (n+1)th call cannot slip through. It also increments ONLY when the call is
--    allowed, so a blocked attempt does not inflate the number the admin sees.
--
--  Apply manually via the Supabase dashboard (project convention).
--  Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
--  No em dashes anywhere in this file.
-- ============================================================

-- -- ai_usage_counters -------------------------------------------------------
-- One row per user, per feature, per calendar month.
CREATE TABLE IF NOT EXISTS ai_usage_counters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The feature's ROW id, not its text key, so a feature rename cannot orphan
  -- its usage and deleting a feature takes its counters with it.
  ai_feature_id uuid NOT NULL REFERENCES ai_features(id) ON DELETE CASCADE,

  -- First day of the calendar month in UTC. One row per month per user per
  -- feature; a new month is a new row, which is the reset.
  period_start  date NOT NULL,

  -- Generations ALLOWED in this period. Blocked attempts are not counted, so
  -- this is a count of spend, not of clicks.
  used          integer NOT NULL DEFAULT 0 CHECK (used >= 0),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, ai_feature_id, period_start)
);

CREATE INDEX IF NOT EXISTS ai_usage_counters_period_idx
  ON ai_usage_counters(ai_feature_id, period_start);
CREATE INDEX IF NOT EXISTS ai_usage_counters_user_idx
  ON ai_usage_counters(user_id, period_start);

-- RLS: managed server-side through the service role, like the rest of the AI
-- tables. Enabled with no permissive policy so anon and authenticated roles are
-- denied by default. A user must never be able to edit their own counter.
ALTER TABLE ai_usage_counters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    DROP TRIGGER IF EXISTS ai_usage_counters_updated_at ON ai_usage_counters;
    CREATE TRIGGER ai_usage_counters_updated_at BEFORE UPDATE ON ai_usage_counters
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- -- ai_usage_consume --------------------------------------------------------
-- Atomically claim ONE generation against a cap.
--
-- Returns the NEW used count when the call is allowed, or NULL when the cap is
-- already reached. NULL is the deny signal; the caller must not fall back to
-- allowing on NULL.
--
-- The whole decision is one INSERT ... ON CONFLICT DO UPDATE ... WHERE, so the
-- check and the increment cannot be interleaved by a concurrent request.
CREATE OR REPLACE FUNCTION ai_usage_consume(
  p_user    uuid,
  p_feature uuid,
  p_period  date,
  p_cap     integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_used integer;
BEGIN
  -- A cap of zero denies the tier outright. Without this guard the INSERT below
  -- would create a row with used = 1 on the first call, letting exactly one
  -- generation through a cap that says none.
  IF p_cap IS NULL OR p_cap <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO ai_usage_counters (user_id, ai_feature_id, period_start, used)
  VALUES (p_user, p_feature, p_period, 1)
  ON CONFLICT (user_id, ai_feature_id, period_start)
  DO UPDATE SET used = ai_usage_counters.used + 1,
                updated_at = now()
  WHERE ai_usage_counters.used < p_cap
  RETURNING used INTO v_used;

  -- v_used is NULL when the ON CONFLICT WHERE clause blocked the update, which
  -- is exactly the at-cap case.
  RETURN v_used;
END;
$$;

-- The function is called by the service role only. Revoke the default grant so
-- an anon or authenticated client cannot advance someone's counter.
REVOKE ALL ON FUNCTION ai_usage_consume(uuid, uuid, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_usage_consume(uuid, uuid, date, integer) FROM anon;
REVOKE ALL ON FUNCTION ai_usage_consume(uuid, uuid, date, integer) FROM authenticated;
