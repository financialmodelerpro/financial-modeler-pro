-- ============================================================
-- 123: Training Hub WhatsApp Group URL
--
-- Admin-editable URL for a WhatsApp group invite. When set to a
-- valid https://chat.whatsapp.com/ link, the Training Hub dashboard
-- sidebar renders a "Join WhatsApp Group" button alongside the
-- existing LinkedIn / YouTube follow buttons. An empty value hides
-- the button entirely (no broken or disabled state).
--
-- Stored in training_settings with an empty default so the feature
-- is opt-in per deployment. Admin UI lives at /admin/training-settings.
-- ============================================================

INSERT INTO training_settings (key, value) VALUES
  ('whatsapp_group_url', '')
ON CONFLICT (key) DO NOTHING;
