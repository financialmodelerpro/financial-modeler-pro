-- 199_report_decks.sql
-- REFM Module 7: the IC Presentation Builder deck document.
--
-- Module 7 was a form plus a fixed, composed report. It is now a slide editor:
-- the user arranges objects on 16:9 slides, and every data object holds a BINDING
-- KEY (e.g. 'headline.projectIrr') rather than a copied number, so the deck
-- follows Modules 1-6 with no sync step. That document has no fixed column shape,
-- so it is stored as one jsonb blob per project rather than as columns (unlike
-- refm_report_inputs, whose flat narrative columns stay exactly as they are and
-- are still read to SEED a new deck, so nobody loses narrative they already
-- wrote).
--
-- One deck per project: project_id is UNIQUE. The deck is presentation only;
-- the model engine never reads this table, and no figure is persisted here.
--
-- Additive, non-destructive, idempotent. Reads tolerate the table being absent
-- (a missing table yields an in-memory seeded deck that simply cannot be saved),
-- so the repo can deploy before this is applied.
BEGIN;

CREATE TABLE IF NOT EXISTS refm_report_decks (
  project_id uuid PRIMARY KEY REFERENCES refm_projects(id) ON DELETE CASCADE,
  -- The whole Deck document: slides, objects, branding, settings.
  deck jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Mirrors deck->>'schemaVersion' so a future migration can find old documents
  -- with an index probe instead of parsing every blob.
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE refm_report_decks IS
  'REFM Module 7 IC Presentation Builder: one slide deck per project. Presentation only; the engine never reads it. Data objects store binding keys, never computed figures.';
COMMENT ON COLUMN refm_report_decks.deck IS
  'The Deck document (see lib/reports/deck/types.ts): { schemaVersion, projectId, title, slides[], branding, settings }.';

CREATE INDEX IF NOT EXISTS idx_refm_report_decks_schema
  ON refm_report_decks (schema_version);

-- Owner-scoped RLS, mirroring refm_report_inputs (mig 191) and refm_parties
-- (mig 190): a deck is reachable only through a project the caller owns. The
-- server routes use the service-role client and enforce ownership in code
-- (requireOwnedProject), so this is defense in depth.
ALTER TABLE refm_report_decks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own refm_report_decks" ON refm_report_decks;
CREATE POLICY "Users read own refm_report_decks" ON refm_report_decks FOR SELECT
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_report_decks.project_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users write own refm_report_decks" ON refm_report_decks;
CREATE POLICY "Users write own refm_report_decks" ON refm_report_decks FOR ALL
  USING (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_report_decks.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM refm_projects p WHERE p.id = refm_report_decks.project_id AND p.user_id = auth.uid()));

COMMIT;

-- Additive only. Drops nothing. refm_report_inputs is untouched and still read
-- as the seed source for a project's first deck.
