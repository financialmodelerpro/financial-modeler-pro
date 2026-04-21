-- ═══════════════════════════════════════════════════════════════════════════════
-- 137: Force Modeling Hub toggles back to Coming Soon
--
-- Migration 136 seeds both `modeling_hub_signin_coming_soon` and
-- `modeling_hub_register_coming_soon` with ON CONFLICT DO NOTHING, so any
-- prior rows survive untouched. In at least one environment the live DB
-- showed the signin toggle as 'false' (LIVE) after 136 ran - either a
-- half-applied earlier attempt or a manual flip. This migration is the
-- explicit "both default to ON per spec" correction: it UPSERTs both
-- keys to 'true' unconditionally.
--
-- Launch dates are intentionally left alone; an admin-set date shouldn't
-- be nuked just because we're re-enforcing the CS state.
--
-- Idempotent: re-running just re-writes 'true' over 'true'. Admins can
-- still flip either toggle back to LIVE via /admin/modules after this
-- migration runs; subsequent migrations won't touch them.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO training_settings (key, value) VALUES
  ('modeling_hub_signin_coming_soon',   'true'),
  ('modeling_hub_register_coming_soon', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
