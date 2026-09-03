-- ============================================================
--  235_module_labels_derive_the_number.sql
--
--  THE MODULE NUMBER IS DERIVED, SO STORAGE MUST NOT CARRY ONE.
--
--  `features_registry.label` held a rendered sentence for each module row:
--  'Module 10: Collaborate'. The Plan Builder, the pricing page and the
--  workspace sidebar all show something else for that same row, 'Module 8',
--  and both were right about different things:
--
--    IDENTITY  is the slug. `collaborate` maps to component 10, which is why
--              the entitlement key is `module_10` and why plan assignments
--              survive any amount of reordering. It never changes.
--    POSITION  is what a user sees. `orderModulesForDisplay` drops every
--              hidden module and numbers what is left 1..N, so with
--              `portfolio` (8) and `market-data` (9) both hidden, Collaborate
--              is the EIGHTH visible module and reads as "Module 8".
--
--  Neither number is wrong. What was wrong is that ONE OF THEM WAS FROZEN
--  INTO A STRING at seed time (migration 158) and then never re-derived, so
--  the database asserted a display number that no surface displayed. Two
--  independent renderings of the same fact, and the stored one cannot track a
--  reorder because nothing recomputes it.
--
--  So the number comes OUT of storage. `label` now holds only the module's
--  NAME, and every surface that shows a number derives it through
--  `orderModulesForDisplay`. The prefix is not moved to a better place or
--  recomputed on write; it is deleted, because a derived value with a stored
--  copy is a divergence waiting for the next admin reorder.
--
--  NOT A RENUMBER. No `feature_key` changes, no `plan_permissions` row is
--  touched, no `platform_modules.number` moves. Collaborate is `module_10`
--  before and after. Only eleven label strings change.
--
--  WHY THE FALLBACK IS THEN CORRECT RATHER THAN DEGRADED. When
--  `platform_modules` returns nothing, `loadMergedFeatures` falls back to
--  these stored rows and renders the label as-is. Before this migration that
--  path printed 'Module 10: Collaborate' beside a sidebar saying 8. It now
--  prints 'Collaborate': no number rather than a contradicting one, which is
--  the honest answer when the registry that owns the numbering is unreachable.
--
--  Idempotent: keyed by feature_key, and re-running sets the same values.
--  Safe to re-run. No em dashes.
--
--  Apply with: npx tsx scripts/apply-migration-235.ts --apply
-- ============================================================

BEGIN;

UPDATE features_registry SET label = 'Project Setup'          WHERE feature_key = 'module_1';
UPDATE features_registry SET label = 'Revenue'                WHERE feature_key = 'module_2';
UPDATE features_registry SET label = 'Operating Expenses'     WHERE feature_key = 'module_3';
UPDATE features_registry SET label = 'Financial Statements'   WHERE feature_key = 'module_4';
UPDATE features_registry SET label = 'Returns and Valuation'  WHERE feature_key = 'module_5';
UPDATE features_registry SET label = 'Scenario Analysis'      WHERE feature_key = 'module_6';
UPDATE features_registry SET label = 'IC Presentation'        WHERE feature_key = 'module_7';
UPDATE features_registry SET label = 'Portfolio'              WHERE feature_key = 'module_8';
UPDATE features_registry SET label = 'Market Data'            WHERE feature_key = 'module_9';
UPDATE features_registry SET label = 'Collaborate'            WHERE feature_key = 'module_10';
UPDATE features_registry SET label = 'API Access'             WHERE feature_key = 'module_11';

COMMENT ON COLUMN features_registry.label IS
  'Human name for the feature. For a module row (feature_key module_N) this is the NAME ONLY and must never carry a "Module N" prefix: the displayed number is a 1-based position derived by orderModulesForDisplay from the live platform_modules registry (hidden modules dropped), while N in the key is the stable slug-derived IDENTITY. Storing the display number froze a value nothing recomputes, and it disagreed with every surface once a module was hidden (migration 235).';

COMMIT;
