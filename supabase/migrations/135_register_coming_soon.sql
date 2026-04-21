-- ═══════════════════════════════════════════════════════════════════════════════
-- 135: Independent register-page Coming Soon toggle
--
-- Splits the Training Hub Coming Soon control into two independent toggles:
--
--   training_hub_coming_soon          (existing) - gates /training/signin
--   training_hub_register_coming_soon (new)     - gates /training/register
--
-- Rationale: pre-launch QA typically wants "signin open for existing
-- students, register closed to new signups" OR "maintenance mode: both
-- closed" OR "launched: both open". The single-toggle model couldn't
-- express the first case. Bypass list logic applies to both independently.
--
-- Keys are named to match the existing {hub}_{descriptor} pattern used by
-- everything else in training_settings (vs. the un-namespaced
-- register_coming_soon_* suggested verbatim in the spec; the {hub}_
-- prefix keeps the settings table consistent and greppable).
--
-- Idempotent: ON CONFLICT DO NOTHING preserves any admin edits on re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO training_settings (key, value)
VALUES
  ('training_hub_register_coming_soon', 'false'),
  ('training_hub_register_launch_date', '')
ON CONFLICT (key) DO NOTHING;
