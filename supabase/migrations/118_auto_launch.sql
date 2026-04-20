-- ============================================================
-- 118: Auto-launch for Coming Soon mode
--
-- Adds per-hub toggles so admins can schedule a Coming Soon → LIVE flip
-- at a specific launch_date. The /api/cron/auto-launch-check Vercel cron
-- polls every 5 min and flips coming_soon=false when:
--     enabled === 'true'
--     auto_launch === 'true'
--     launch_date IS set AND launch_date <= now()
--
-- After firing, cron sets:
--     coming_soon        → 'false'   (the actual launch)
--     auto_launch        → 'false'   (one-shot; admin must re-opt-in)
--     last_auto_launched_at → ISO timestamp (audit + UI readout)
--
-- Manual toggle remains authoritative — admins can flip either hub any
-- time via /admin/training-settings and /admin/modules.
-- ============================================================

INSERT INTO training_settings (key, value) VALUES
  ('training_hub_auto_launch',            'false'),
  ('training_hub_last_auto_launched_at',  ''),
  ('modeling_hub_auto_launch',            'false'),
  ('modeling_hub_last_auto_launched_at',  '')
ON CONFLICT (key) DO NOTHING;
