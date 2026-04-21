-- ═══════════════════════════════════════════════════════════════════════════════
-- 136: Modeling Hub pre-launch lockdown
--
-- Three things in one migration, atomic so a partial apply can't leave the hub
-- in a half-locked state:
--
--   1. Split the single `modeling_hub_coming_soon` toggle into two independent
--      toggles (signin + register) so admins can open signin for existing
--      users while keeping new registrations closed, matching the Training Hub
--      pattern from migration 135. Both new toggles default to 'true' so the
--      hub stays locked until launch day.
--
--   2. Create `modeling_access_whitelist` so individual emails can bypass the
--      toggles. Needed because the Modeling Hub has no bypass-list equivalent
--      to Training's `training_hub_bypass_list` (which is a single CSV string);
--      a real table gives us a proper admin UI, per-entry audit fields, and
--      clean revoke semantics. Admin (meetahmadch@gmail.com) is pre-seeded.
--
--   3. Purge six unauthorized user accounts that slipped in through the
--      previously-unguarded /modeling/register page before the lockdown was
--      built. Audit trail captured in admin_audit_log first so the deletion
--      is forensically reproducible. The `role <> 'admin'` guard prevents
--      the admin account from ever being caught by a typo in the delete list.
--
-- Idempotent: ON CONFLICT DO NOTHING on settings + whitelist seed, IF NOT
-- EXISTS on the table, email-equality WHERE clauses on the delete (second
-- run deletes zero rows). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Split signin + register toggles ─────────────────────────────────────
INSERT INTO training_settings (key, value) VALUES
  ('modeling_hub_signin_coming_soon',   'true'),
  ('modeling_hub_signin_launch_date',   ''),
  ('modeling_hub_register_coming_soon', 'true'),
  ('modeling_hub_register_launch_date', '')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Whitelist table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modeling_access_whitelist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  note       text,
  added_by   text,
  added_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modeling_wl_email_lower
  ON modeling_access_whitelist (LOWER(email));

-- Pre-seed the admin so the hub stays self-serviceable the moment the
-- toggles flip on.
INSERT INTO modeling_access_whitelist (email, note, added_by)
VALUES ('meetahmadch@gmail.com', 'FMP admin (pre-seeded)', 'system')
ON CONFLICT (email) DO NOTHING;

-- ── 3. Purge unauthorized users ────────────────────────────────────────────
-- ahmaddin.ch@gmail.com is a Training Hub email that accidentally landed on
-- the Modeling Hub; listing it here removes only the Modeling account row.
-- Training Hub registration for that email lives in training_registrations_meta
-- and is untouched by this migration.

-- 3a. Audit trail FIRST so target_user_id is captured before the row vanishes.
INSERT INTO admin_audit_log (action, target_user_id, before_value, reason)
SELECT
  'modeling_hub_lockdown_delete',
  id,
  jsonb_build_object(
    'email',      email,
    'name',       name,
    'role',       role,
    'created_at', created_at
  ),
  'Unauthorized modeling hub account removed during pre-launch lockdown (migration 136)'
FROM users
WHERE email = ANY(ARRAY[
  'waqarpersonal45@gmail.com',
  'usamanawaz253@gmail.com',
  'mohammad.ismail536@gmail.com',
  'saad.acma1@gmail.com',
  'smjhassan82@gmail.com',
  'ahmaddin.ch@gmail.com'
])
AND role <> 'admin';

-- 3b. Clean up email-keyed satellite tables that don't cascade from users.id.
-- trusted_devices stores email in the `identifier` column (per CLAUDE.md),
-- so FK cascade doesn't apply. Harmless if the row doesn't exist.
DELETE FROM trusted_devices
WHERE LOWER(identifier) = ANY(ARRAY[
  'waqarpersonal45@gmail.com',
  'usamanawaz253@gmail.com',
  'mohammad.ismail536@gmail.com',
  'saad.acma1@gmail.com',
  'smjhassan82@gmail.com',
  'ahmaddin.ch@gmail.com'
]);

-- 3c. Delete the users themselves. Any FK-protected children will error and
-- roll back the whole migration so no partial state ever lands.
DELETE FROM users
WHERE email = ANY(ARRAY[
  'waqarpersonal45@gmail.com',
  'usamanawaz253@gmail.com',
  'mohammad.ismail536@gmail.com',
  'saad.acma1@gmail.com',
  'smjhassan82@gmail.com',
  'ahmaddin.ch@gmail.com'
])
AND role <> 'admin';

COMMIT;
