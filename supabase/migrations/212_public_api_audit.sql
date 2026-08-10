-- ============================================================
-- 212: Public API audit log
--
-- Rejected calls to GET /api/public/pages/[slug] are recorded here.
--
-- WHY A NEW TABLE RATHER THAN admin_audit_log. That table requires a NOT NULL
-- admin_id (tightened after migration 007; confirmed by a live insert probe
-- that failed with "null value in column admin_id violates not-null
-- constraint"). An unauthenticated caller has no admin to attribute a row to,
-- and inventing a sentinel user to satisfy the constraint would pollute the
-- admin audit trail with rows that are not admin actions.
--
-- The route degrades gracefully while this migration is unapplied: the audit
-- write is best effort and logs a warning instead of failing the request, so
-- the endpoint returns a correct 401 either way.
-- ============================================================

CREATE TABLE IF NOT EXISTS public_api_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action     text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Reads are "what happened recently", so the index matches.
CREATE INDEX IF NOT EXISTS idx_public_api_audit_created ON public_api_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_audit_action  ON public_api_audit (action, created_at DESC);

ALTER TABLE public_api_audit ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated policy is granted, so only the service role (which
-- bypasses RLS) can read or write. The route uses the service client.
DROP POLICY IF EXISTS "Admin read public api audit" ON public_api_audit;
CREATE POLICY "Admin read public api audit" ON public_api_audit FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ── Behavioural probes to run AFTER applying ────────────────────────────────
-- 1. INSERT INTO public_api_audit (action, metadata)
--      VALUES ('public_api_unauthorized', '{"slug":"refm","ip":"1.2.3.4"}');
--    expect: 1 row.
-- 2. SELECT count(*) FROM public_api_audit WHERE action = 'public_api_unauthorized';
--    expect: >= 1.
-- 3. DELETE FROM public_api_audit WHERE metadata->>'ip' = '1.2.3.4';
--    expect: the probe row is removed.
