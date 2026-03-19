CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  before_value   jsonb,
  after_value    jsonb,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin   ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON admin_audit_log(target_user_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read or write audit logs
DROP POLICY IF EXISTS "Admin only audit log" ON admin_audit_log;
CREATE POLICY "Admin only audit log" ON admin_audit_log FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
