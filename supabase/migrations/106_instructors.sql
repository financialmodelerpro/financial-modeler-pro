-- ============================================================
-- 106: Instructor management for live sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS instructors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  title          TEXT NOT NULL,
  bio            TEXT,
  photo_url      TEXT,
  email          TEXT,
  linkedin_url   TEXT,
  credentials    TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instructors_active  ON instructors(active);
CREATE INDEX IF NOT EXISTS idx_instructors_default ON instructors(is_default) WHERE is_default = true;

-- At most one default instructor at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_instructors_single_default
  ON instructors(is_default) WHERE is_default = true;

-- Seed Ahmad Din as the starting default.
INSERT INTO instructors (name, title, credentials, is_default, display_order, active)
SELECT 'Ahmad Din', 'Corporate Finance & Transaction Advisory Specialist', 'ACCA, FMVA', true, 0, true
WHERE NOT EXISTS (SELECT 1 FROM instructors WHERE is_default = true);

-- Link sessions to instructor rows. Keep existing instructor_name/instructor_title
-- columns populated in parallel for backwards compatibility with every reader.
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS instructor_id UUID REFERENCES instructors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_live_sessions_instructor_id ON live_sessions(instructor_id);

-- Back-fill: any session whose instructor_name matches the seeded default gets linked.
UPDATE live_sessions ls
SET instructor_id = i.id
FROM instructors i
WHERE ls.instructor_id IS NULL
  AND i.is_default = true
  AND (ls.instructor_name = i.name OR ls.instructor_name IS NULL OR ls.instructor_name = '');
