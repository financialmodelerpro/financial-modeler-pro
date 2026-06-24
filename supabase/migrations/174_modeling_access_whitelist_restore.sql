-- ============================================================
--  174_modeling_access_whitelist_restore.sql
--
--  Restores the `modeling_access_whitelist` table. Migration 136 created it
--  inside a larger transaction (toggle split + user purge); the split toggles
--  landed but this table is missing live (partial apply, or it was later
--  dropped), which makes the admin Access Whitelist screen error with
--  "Could not find the table public.modeling_access_whitelist".
--
--  ADDITIVE + idempotent: it re-creates ONLY the table + index + admin seed,
--  with the EXACT shape migration 136 + the code expect (id / email UNIQUE /
--  note / added_by / added_at). It does NOT repeat 136's user purge or toggle
--  inserts, so applying it has no side effects beyond the table. Safe to re-run
--  (CREATE TABLE / INDEX IF NOT EXISTS, ON CONFLICT DO NOTHING on the seed).
--
--  No enforcement change: the access gate logic (access.ts) is untouched; this
--  only makes the table it reads/writes exist again.
--
--  Apply manually via the Supabase dashboard. No em dashes.
-- ============================================================

CREATE TABLE IF NOT EXISTS modeling_access_whitelist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  note       text,
  added_by   text,
  added_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modeling_wl_email_lower
  ON modeling_access_whitelist (LOWER(email));

-- Pre-seed the admin so the hub stays self-serviceable while the toggles are on.
INSERT INTO modeling_access_whitelist (email, note, added_by)
VALUES ('meetahmadch@gmail.com', 'FMP admin (pre-seeded)', 'system')
ON CONFLICT (email) DO NOTHING;
