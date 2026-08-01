-- ============================================================
--  206_ai_usage_refund.sql
--  AI foundation: give a generation back when the call fails.
--  ADDITIVE ONLY: creates one function. No table, column, or data is altered.
--
--  WHY THIS EXISTS
--    Metering consumes the credit BEFORE the API call (migration 205), which is
--    the correct order: consuming after a successful call lets concurrent
--    requests all pass the check first, which is the failure mode that actually
--    costs money. The price of that order is that a call which never produced
--    anything still costs the user one of their monthly generations. When the
--    platform's own AI account ran out of credit, every click burned a
--    generation and returned an error, which on a trial plan (5 a month) is most
--    of the month gone for nothing.
--
--    This function is the other half: consume first, and give it back when the
--    call fails. The concurrency guarantee is untouched, because the decision to
--    allow is still made once, atomically, before anything is spent.
--
--  WHY A FUNCTION AND NOT used = used - 1 IN THE APP
--    Same reason as ai_usage_consume. Read the count, subtract one, write it
--    back is a race: two concurrent refunds can both read 3 and both write 2,
--    and one refund is silently lost. The whole operation here is ONE UPDATE
--    statement, so concurrent refunds serialise on the row and each one counts.
--
--  WHY IT FLOORS AT ZERO
--    used carries CHECK (used >= 0). Without GREATEST, a double refund (a retry,
--    a bug, a race with a month rollover) would violate the constraint and raise
--    an exception on a path that is ALREADY handling a failure, turning a
--    bookkeeping edge case into a second error in front of the user. Flooring is
--    the conservative direction: the worst case is that a user keeps a credit
--    they had already been given back.
--
--  WHY IT NEVER CREATES A ROW
--    A refund is only ever the reversal of a consume, so the row must already
--    exist. If it does not (the calendar month rolled over between the consume
--    and the refund, so the consume belongs to the previous period's row), the
--    UPDATE simply matches nothing and the function reports that it refunded
--    nothing. Inserting a row here would invent a counter for a period the user
--    never spent in.
--
--  Apply manually via the Supabase dashboard (project convention).
--  Idempotent: CREATE OR REPLACE FUNCTION.
--  No em dashes anywhere in this file.
-- ============================================================

-- -- ai_usage_refund ---------------------------------------------------------
-- Atomically give ONE generation back.
--
-- Returns the NEW used count when a counter row was found and decremented, or
-- NULL when there was no row to refund against. NULL is informational only: the
-- caller is already handling a failed generation and must not treat a failed
-- refund as a second error.
CREATE OR REPLACE FUNCTION ai_usage_refund(
  p_user    uuid,
  p_feature uuid,
  p_period  date
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_used integer;
BEGIN
  -- ONE statement. The read, the subtraction and the write happen together, so
  -- two concurrent refunds cannot both act on the same starting value.
  UPDATE ai_usage_counters
     SET used = GREATEST(ai_usage_counters.used - 1, 0),
         updated_at = now()
   WHERE user_id = p_user
     AND ai_feature_id = p_feature
     AND period_start = p_period
  RETURNING used INTO v_used;

  -- NULL when no row matched: nothing was consumed in this period, so there is
  -- nothing to give back.
  RETURN v_used;
END;
$$;

-- Service role only, exactly like ai_usage_consume. A user who could call this
-- directly could refund their own usage indefinitely and generate without limit,
-- which would make the cap decorative.
REVOKE ALL ON FUNCTION ai_usage_refund(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_usage_refund(uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION ai_usage_refund(uuid, uuid, date) FROM authenticated;
