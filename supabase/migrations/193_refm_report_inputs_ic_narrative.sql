-- 193_refm_report_inputs_ic_narrative.sql
-- REFM Module 7 Reports, IC rebuild (A+B). Adds the structured IC narrative
-- fields to the existing per-project refm_report_inputs table (migs 191 + 192).
-- Additive, non-destructive, idempotent. Presentation / narrative ONLY: the model
-- engine never reads this table; every financial figure is pulled live from the
-- computed snapshot at render time.
--
-- Text fields:
--   development_concept   : Project Overview development concept
--   key_gates             : Development Programme key gates / milestones
--   returns_commentary    : Returns Analysis "reading the returns"
--   exit_commentary       : Exit-Year Optionality commentary
--   scenario_takeaway     : Scenario Economics takeaway
--   next_steps            : Recommendation & Approvals next steps
-- JSONB fields (arrays / objects; app coerces + tolerates absence):
--   market_context        : { stats:[{label,value}], points:[{title,body}], sourcesNote }
--   risks                 : [{ risk, mitigant }]
--   regulatory_tax        : [{ label, body }]   (optional loadable KSA preset in the app; never a DB default)
--   conditions_precedent  : [ string ]
--   exec_points           : [{ title, body }]
BEGIN;

ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS development_concept  text;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS key_gates            text;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS returns_commentary   text;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS exit_commentary      text;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS scenario_takeaway    text;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS next_steps           text;

ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS market_context       jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS risks                jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS regulatory_tax       jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS conditions_precedent jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE refm_report_inputs ADD COLUMN IF NOT EXISTS exec_points          jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;

-- Additive only. Drops nothing. Reads tolerate these columns being absent
-- (pre-apply) by treating them as empty / defaults, so the Reports tab renders
-- before this migration is applied. The regulatory & tax preset is applied by
-- the user in-app (a loadable KSA preset), never seeded here, so no jurisdiction
-- is ever hardcoded in the database.
