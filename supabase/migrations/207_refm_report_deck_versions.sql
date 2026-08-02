-- 207_refm_report_deck_versions.sql
-- REFM Module 7: named, separately-saved versions of an IC presentation.
--
-- Today there is exactly ONE deck per project: refm_report_decks.project_id is
-- the PRIMARY KEY (migration 199) and every Save upserts on it, overwriting the
-- previous document. There is no name, no history, and the deck is NOT captured
-- by the platform's project versioning (refm_project_versions stores a
-- HydrateSnapshot and never references the deck), so switching project versions
-- shows the same single deck.
--
-- This adds a version history for the deck that MIRRORS the project pattern in
-- migration 149:
--
--   refm_projects        -> current_version_id  ->  refm_project_versions
--   refm_report_decks    -> current_version_id  ->  refm_report_deck_versions
--
-- Deliberately ADDITIVE and non-destructive:
--
--   * refm_report_decks is UNCHANGED except for one nullable pointer column. It
--     stays the live working document, so every existing deck keeps loading and
--     saving exactly as it does now and nothing has to be migrated into the new
--     table. A project that never uses versions behaves identically to today.
--   * The new table is append-only, like refm_project_versions: a save INSERTs a
--     row, it is never UPDATEd. Loading a version copies its jsonb back into the
--     working deck, so a load can never destroy the history it came from.
--   * current_version_id is ON DELETE SET NULL, so deleting one saved version
--     never takes the working deck with it. NULL means "the working deck does
--     not correspond to any saved version" (never versioned, or edited since).
--
-- Reads must stay schema-tolerant (prod lags the repo): the application treats a
-- missing table as "versioning unavailable" and falls back to the single-deck
-- behaviour rather than failing the Presentation tab.
--
-- Idempotent: safe to run more than once.
BEGIN;

CREATE TABLE IF NOT EXISTS refm_report_deck_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES refm_projects(id) ON DELETE CASCADE,

  -- Monotonic per project. Auto-incremented in the API layer (read MAX, write
  -- MAX+1), exactly as refm_project_versions does. The unique index below is
  -- what actually enforces no duplicates under concurrent saves.
  version_number  integer NOT NULL CHECK (version_number >= 1),

  -- Mirrors deck->>'schemaVersion' so a later migration can find old documents
  -- with an index probe instead of parsing every blob (same rationale as
  -- refm_report_decks.schema_version).
  schema_version  integer NOT NULL DEFAULT 1,

  -- The whole Deck document as it stood at save time: slides, objects,
  -- branding, settings. Same shape as refm_report_decks.deck, so `coerceDeck`
  -- validates it on read with no extra code path.
  --
  -- Presentation only. Slides hold BINDING KEYS, never copied figures, so a
  -- loaded old version still resolves its numbers against the CURRENT model:
  -- this is a history of layout and narrative, not a frozen set of numbers.
  deck            jsonb NOT NULL,

  -- User-facing name for the version ("Pre-IC draft", "Board pack v2"). Unlike
  -- refm_project_versions.label this is expected to be set, since the whole
  -- point is naming presentations, but it stays nullable so an unnamed save is
  -- still possible and older rows never break.
  label           text,

  -- Optional free-text note, mirroring refm_project_versions.comment (mig 153).
  comment         text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Enforce monotonic per-project numbering + index the list path.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_refm_deck_versions_project_number
  ON refm_report_deck_versions(project_id, version_number);

CREATE INDEX IF NOT EXISTS idx_refm_deck_versions_project_created
  ON refm_report_deck_versions(project_id, created_at DESC);

COMMENT ON TABLE refm_report_deck_versions IS
  'Named version history for a Module 7 IC presentation. Append-only: never UPDATEd. Save-as-version = INSERT a row + point refm_report_decks.current_version_id at it. refm_report_decks remains the live working deck. Presentation only: the model engine never reads this table, and slides hold binding keys rather than persisted figures.';

COMMENT ON COLUMN refm_report_deck_versions.deck IS
  'Full Deck document per src/hubs/modeling/platforms/refm/lib/reports/deck/types.ts. Read through coerceDeck, which re-validates untrusted jsonb, clamps geometry and drops unknown object types.';

COMMENT ON COLUMN refm_report_deck_versions.label IS
  'User-facing version name set in the Presentation version modal. Nullable so an unnamed save still works.';


-- ── The working deck's pointer at its saved version ────────────────────────
-- Nullable and ON DELETE SET NULL, mirroring refm_projects.current_version_id.
-- NULL = the working deck matches no saved version (never versioned, or edited
-- since the last save-as).
ALTER TABLE refm_report_decks
  ADD COLUMN IF NOT EXISTS current_version_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'refm_report_decks'
      AND constraint_name = 'refm_report_decks_current_version_id_fkey'
  ) THEN
    ALTER TABLE refm_report_decks
      ADD CONSTRAINT refm_report_decks_current_version_id_fkey
      FOREIGN KEY (current_version_id)
      REFERENCES refm_report_deck_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN refm_report_decks.current_version_id IS
  'The saved deck version this working deck was last saved as or loaded from. NULL when it corresponds to no saved version. ON DELETE SET NULL so removing a version never disturbs the working deck.';

COMMIT;
