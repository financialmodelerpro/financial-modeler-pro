-- ═══════════════════════════════════════════════════════════════════════════════
-- 133: next_training_reg_id(year) - sequential RegID generator
--
-- Replaces Apps Script's role in generating `FMP-YYYY-NNNN` registration
-- IDs at confirm-email time. Scans MAX(sequence) for the given year in
-- training_registrations_meta and returns the next value. Advisory lock
-- (per year) serializes concurrent function invocations within the same
-- transaction so two parallel registrations can't both claim the same
-- next value; the UNIQUE index on registration_id (migration 129) is the
-- hard guard that catches any race that sneaks past the lock, and the
-- Node-side allocator retries on conflict.
--
-- Starts naturally from the max existing RegID for the year. If the 11
-- pre-migration students have FMP-2026-0001 through FMP-2026-0011, the
-- first call after migration returns FMP-2026-0012. No seed row needed.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION next_training_reg_id(p_year INT)
RETURNS TEXT AS $$
DECLARE
  allocated_seq INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('training_reg_id_' || p_year));
  SELECT COALESCE(MAX(
           CAST(SUBSTRING(registration_id FROM ('FMP-' || p_year || '-(\d+)$')) AS INT)
         ), 0) + 1
    INTO allocated_seq
    FROM training_registrations_meta
   WHERE registration_id LIKE 'FMP-' || p_year || '-%';
  RETURN 'FMP-' || p_year || '-' || LPAD(allocated_seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;
