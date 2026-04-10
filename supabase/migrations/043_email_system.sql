-- ═══════════════════════════════════════════════════════════════════════════════
-- 043: Email branding, templates, and live session email tracking columns
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Table 1: Universal email branding (single row) ─────────────────────────
CREATE TABLE IF NOT EXISTS email_branding (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logo_url       TEXT DEFAULT '',
  logo_width     INTEGER DEFAULT 180,
  logo_alt       TEXT DEFAULT 'Financial Modeler Pro',
  signature_html TEXT DEFAULT '<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;">
  <p style="margin:0;font-size:14px;color:#374151;font-weight:600;">Financial Modeler Pro</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Professional Financial Modeling Training</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;"><a href="https://financialmodelerpro.com" style="color:#2E75B6;">financialmodelerpro.com</a></p>
</div>',
  footer_text    TEXT DEFAULT '© Financial Modeler Pro. You are receiving this because you registered for our training program.',
  primary_color  TEXT DEFAULT '#1F3864',
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Seed one branding row
INSERT INTO email_branding (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;

-- ── Table 2: Editable email templates ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key  TEXT UNIQUE NOT NULL,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Seed 4 default templates
INSERT INTO email_templates (template_key, subject, body_html) VALUES
(
  'session_announcement',
  'New Session: {{session_title}}',
  '<p>Hi <strong>{{student_name}}</strong>,</p>
<p>A new training session has been scheduled:</p>
<h2 style="color:#1F3864;margin:20px 0 8px;">{{session_title}}</h2>
<div style="background:#f0f4ff;border-left:4px solid #2E75B6;padding:20px 24px;border-radius:6px;margin:20px 0;">
  <p style="margin:0 0 8px;font-weight:bold;color:#1F3864;">{{session_date}} at {{session_time}} ({{session_timezone}})</p>
  <p style="margin:0;color:#555;">Duration: {{session_duration}}</p>
  {{#instructor_name}}<p style="margin:8px 0 0;color:#555;">Instructor: {{instructor_name}}</p>{{/instructor_name}}
  {{#session_description}}<p style="margin:12px 0 0;color:#555;">{{session_description}}</p>{{/session_description}}
  {{#registration_count}}<p style="margin:12px 0 0;font-size:13px;color:#2E75B6;">{{registration_count}} students already registered</p>{{/registration_count}}
</div>
<div style="text-align:center;margin:28px 0;">
  <a href="{{view_url}}" style="display:inline-block;background:#1F3864;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:6px;">View &amp; Register &rarr;</a>
</div>'
),
(
  'session_reminder_24h',
  'Reminder: {{session_title}} is tomorrow',
  '<p>Hi <strong>{{student_name}}</strong>,</p>
<p>This is a friendly reminder that your session is <strong>tomorrow</strong>:</p>
<div style="background:#f0f4ff;border-left:4px solid #2E75B6;padding:20px 24px;border-radius:6px;margin:20px 0;">
  <h3 style="margin:0 0 8px;color:#1F3864;">{{session_title}}</h3>
  <p style="margin:0 0 4px;font-weight:bold;color:#1F3864;">{{session_date}} at {{session_time}} ({{session_timezone}})</p>
  <p style="margin:0;color:#555;">Duration: {{session_duration}}</p>
</div>
<p>Make sure you are ready. The join link will appear in your dashboard 30 minutes before the session starts.</p>
<div style="text-align:center;margin:28px 0;">
  <a href="{{view_url}}" style="display:inline-block;background:#1F3864;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:6px;">View Session &rarr;</a>
</div>'
),
(
  'session_reminder_1h',
  'Starting in 1 hour: {{session_title}}',
  '<p>Hi <strong>{{student_name}}</strong>,</p>
<p><strong>{{session_title}}</strong> starts in <strong>1 hour</strong>!</p>
<div style="background:#f0fdf4;border-left:4px solid #2EAA4A;padding:20px 24px;border-radius:6px;margin:20px 0;">
  <p style="margin:0 0 4px;font-weight:bold;color:#166534;">{{session_date}} at {{session_time}} ({{session_timezone}})</p>
  <p style="margin:0;color:#555;">Duration: {{session_duration}}</p>
</div>
{{#join_url}}<div style="text-align:center;margin:28px 0;">
  <a href="{{join_url}}" style="display:inline-block;background:#DC2626;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:6px;">Join Now &rarr;</a>
</div>{{/join_url}}
<p style="font-size:13px;color:#6b7280;">If the button above does not work, go to your dashboard and click "Join Session".</p>'
),
(
  'session_recording_available',
  'Recording Available: {{session_title}}',
  '<p>Hi <strong>{{student_name}}</strong>,</p>
<p>We noticed you missed <strong>{{session_title}}</strong>. Good news — the recording is now available!</p>
<div style="background:#f0f4ff;border-left:4px solid #2E75B6;padding:20px 24px;border-radius:6px;margin:20px 0;">
  <h3 style="margin:0 0 8px;color:#1F3864;">{{session_title}}</h3>
  <p style="margin:0;color:#555;">Watch at your own pace and earn 50 points for completing the recording.</p>
</div>
<div style="text-align:center;margin:28px 0;">
  <a href="{{view_url}}" style="display:inline-block;background:#1F3864;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:6px;">Watch Recording &rarr;</a>
</div>'
)
ON CONFLICT (template_key) DO NOTHING;

-- ── New columns on live_sessions for email tracking ────────────────────────
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS announcement_sent BOOLEAN DEFAULT false;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS announcement_send_mode TEXT DEFAULT 'auto' CHECK (announcement_send_mode IN ('auto', 'manual'));
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN DEFAULT false;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS reminder_1h_sent BOOLEAN DEFAULT false;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS recording_email_sent BOOLEAN DEFAULT false;
