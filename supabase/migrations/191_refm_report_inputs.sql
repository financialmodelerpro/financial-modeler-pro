-- 191_refm_report_inputs.sql
-- Per-project Report inputs for REFM Module 7 (Reports). Presentation + narrative
-- config ONLY: the model engine NEVER reads this table, financials are pulled live
-- from the computed snapshot at render time. Additive, non-destructive, idempotent.
-- One row per project (project_id UNIQUE), outside the version snapshot, so old
-- projects load unchanged and returns math is untouched. Mirrors refm_parties
-- (mig 190): owner-scoped RLS as defense-in-depth; the app enforces ownership in
-- the server route and uses the service-role client.
BEGIN;

CREATE TABLE IF NOT EXISTS refm_report_inputs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL UNIQUE REFERENCES refm_projects(id) ON DELETE CASCADE,

  -- Narrative (free text, all optional; blank = section shows a neutral prompt).
  executive_summary  text,   -- executive summary / investment thesis
  key_risks          text,   -- key risks & mitigants
  recommendation     text,   -- recommendation / the ask
  disclaimers        text,   -- disclaimers / confidentiality notes

  -- Editable chrome.
  header_text        text,
  footer_text        text,

  -- Fonts. Defaults: Calibri body, Cambria headings. A picker can swap to a
  -- client corporate font (stored as a plain family name string).
  font_body          text NOT NULL DEFAULT 'Calibri',
  font_heading       text NOT NULL DEFAULT 'Cambria',

  -- Per-section show/hide + order. JSONB array of { key, visible, order }.
  -- Empty default => the app applies the canonical IC section order.
  section_config     jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refm_report_inputs_project ON refm_report_inputs(project_id);

ALTER TABLE refm_report_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own refm_report_inputs" ON refm_report_inputs;
CREATE POLICY "Users read own refm_report_inputs" ON refm_report_inputs FOR SELECT
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_report_inputs.project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users write own refm_report_inputs" ON refm_report_inputs;
CREATE POLICY "Users write own refm_report_inputs" ON refm_report_inputs FOR ALL
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_report_inputs.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_report_inputs.project_id AND p.user_id = auth.uid()));

COMMIT;

-- Additive only. Drops nothing. section_config is validated in the app (the fixed
-- IC section key set) rather than a DB CHECK, so sections stay extensible without a
-- migration. Reads tolerate the table being absent (pre-apply) by returning null.
