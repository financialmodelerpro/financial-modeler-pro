-- ============================================================
-- 213: Public API keys, so the partner feed key can be rotated from the admin
--
-- WHY THIS TABLE EXISTS. FMP_PUBLIC_API_KEY lived only in the deployment
-- environment, which a button in the admin cannot write, and which would not
-- reach a running deployment without a redeploy even if it could. So a rotate
-- button that only generated a value could never make the old key stop working;
-- it would depend on a human finishing the job by hand. With the live key in a
-- row, rotation is one transaction and the cutover is exact.
--
-- ── THE RESOLUTION RULE ────────────────────────────────────────────────────
--
-- The endpoint consults the environment variable ONLY when this table holds NO
-- ROW AT ALL for the key id. Not "no active row": no row. Once a rotation has
-- happened, the environment value is dead forever, and retiring the last key
-- closes the endpoint rather than quietly resurrecting the superseded env key.
-- Failing closed is the correct direction for a credential that was rotated
-- precisely because someone wanted it to stop working.
--
-- ── ONLY A HASH IS STORED ──────────────────────────────────────────────────
--
-- key_hash is the SHA-256 of the key, so a database dump or a Supabase
-- dashboard viewer cannot read a live credential. The value is shown once, at
-- rotation, and can never be revealed again. key_prefix exists so an admin can
-- tell which key is live and match it against what the partner holds, and it is
-- short enough to be useless on its own.
--
-- ── ROTATION IS ONE TRANSACTION ────────────────────────────────────────────
--
-- rotate_public_api_key retires the active row and inserts the new one inside a
-- single plpgsql call. Two round trips could leave two keys valid at once
-- (which is exactly what rotation is supposed to prevent) or, in the other
-- order, no key at all if the second call failed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public_api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Registry id from the admin API keys route, NOT an environment variable
  -- name. The client never names an env var and neither does this table.
  key_id           text NOT NULL,
  -- SHA-256 hex of the key. The key itself is never stored anywhere.
  key_hash         text NOT NULL,
  -- First few characters, for identification only.
  key_prefix       text NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_email text,
  retired_at       timestamptz,
  retired_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  retired_by_email text
);

-- At most ONE active key per key id, enforced by the database rather than by
-- the care of the caller. A partial unique index is what makes "the old key
-- stopped working" a schema guarantee instead of a hope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_api_keys_one_active
  ON public_api_keys (key_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_api_keys_hash ON public_api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_public_api_keys_lookup ON public_api_keys (key_id, status);
CREATE INDEX IF NOT EXISTS idx_public_api_keys_created ON public_api_keys (key_id, created_at DESC);

ALTER TABLE public_api_keys ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated write policy, so only the service role (which
-- bypasses RLS) can read or write. Admins read through the admin API route,
-- which returns metadata, never the hash.
DROP POLICY IF EXISTS "Admin read public api keys" ON public_api_keys;
CREATE POLICY "Admin read public api keys" ON public_api_keys FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ── Rotation, atomically ────────────────────────────────────────────────────
-- Returns what was retired so the caller can write a truthful audit row.
-- SECURITY INVOKER on purpose: the service role already bypasses RLS, so
-- DEFINER would buy nothing and would hand a privilege escalation to anyone who
-- ever gained EXECUTE by accident.
CREATE OR REPLACE FUNCTION rotate_public_api_key(
  p_key_id     text,
  p_key_hash   text,
  p_key_prefix text,
  p_admin_id   uuid,
  p_admin_email text
)
RETURNS TABLE (new_id uuid, retired_prefix text, retired_count int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_retired_prefix text;
  v_retired_count  int;
  v_new_id         uuid;
BEGIN
  WITH retired AS (
    UPDATE public_api_keys
       SET status = 'retired',
           retired_at = now(),
           retired_by = p_admin_id,
           retired_by_email = p_admin_email
     WHERE key_id = p_key_id AND status = 'active'
    RETURNING key_prefix
  )
  SELECT count(*)::int, max(key_prefix) INTO v_retired_count, v_retired_prefix FROM retired;

  INSERT INTO public_api_keys (key_id, key_hash, key_prefix, status, created_by, created_by_email)
  VALUES (p_key_id, p_key_hash, p_key_prefix, 'active', p_admin_id, p_admin_email)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_retired_prefix, v_retired_count;
END;
$$;

REVOKE ALL ON FUNCTION rotate_public_api_key(text, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rotate_public_api_key(text, text, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION rotate_public_api_key(text, text, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION rotate_public_api_key(text, text, text, uuid, text) TO service_role;

-- ── Behavioural probes to run AFTER applying ────────────────────────────────
-- 1. SELECT * FROM rotate_public_api_key('probe', repeat('a', 64), 'fmp_pk_aaa', NULL, 'probe@x');
--    expect: one row, retired_count 0, retired_prefix NULL.
-- 2. SELECT * FROM rotate_public_api_key('probe', repeat('b', 64), 'fmp_pk_bbb', NULL, 'probe@x');
--    expect: retired_count 1, retired_prefix 'fmp_pk_aaa'.
-- 3. SELECT status, key_prefix FROM public_api_keys WHERE key_id = 'probe' ORDER BY created_at;
--    expect: exactly one 'active' (the bbb row) and one 'retired'.
-- 4. INSERT INTO public_api_keys (key_id, key_hash, key_prefix)
--      VALUES ('probe', repeat('c', 64), 'fmp_pk_ccc');
--    expect: FAILS on idx_public_api_keys_one_active. A second active key must
--    be impossible, not merely avoided.
-- 5. DELETE FROM public_api_keys WHERE key_id = 'probe';
--    expect: the probe rows are removed.
