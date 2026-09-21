/**
 * existingOperationsState.ts (2026-09-21)
 *
 * A COMMITTED FIXTURE CARRYING THE ONE SHAPE NOTHING ELSE COVERS: a project
 * whose first phase is ALREADY OPERATING.
 *
 * WHY IT EXISTS. Eight verifiers read a real project called FMP RE HUB, five of
 * them live from `refm_project_versions` by its id and three through a
 * gitignored local copy. That project was soft-deleted on 2026-09-12, so its
 * version rows cascade away at the 30-day purge (due about 2026-10-12), and on
 * any machine that is not this one the gitignored copy never existed at all.
 * None of the five failed when the data went missing: three skipped their whole
 * leg in silence and two quietly downgraded to a smaller fixture. This file is
 * the shape captured before the purge, so the coverage outlives the project.
 *
 * WHAT IT CARRIES that neither FMP - MARINA GATE nor `excelSampleState` does,
 * measured on 2026-09-21:
 *   - an OPERATIONAL phase (Phase 1) with an asset on it, so existing
 *     operations, the historical baseline and land contributed in kind BEFORE
 *     the model starts are exercised;
 *   - an EXISTING debt tranche (1 of 2), so the opening-balance path is;
 *   - all four strategies, `Sell + Manage` included;
 *   - the fund layer on, three scenario cases.
 *
 * PROVENANCE. The saved version 1.0 of 2026-08-10 of that project, verbatim,
 * with ONE edit: `project.name`, which was the deleted project's name and is
 * now "Existing Operations Sample". The project id never appears in a snapshot
 * (it lives on the version row), so there was nothing else to scrub. Proved
 * against the live row before the move: every engine figure identical.
 *
 * IT IS A STORED SNAPSHOT, handed over exactly as the database held it, which
 * is what the verifiers that read the live row were passing to the engine. Do
 * not "tidy" it: its value is that a real platform wrote it.
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import path from 'path';

/** What a run of this fixture is called in verifier output. */
export const EXISTING_OPS_LABEL = 'FIXTURE (existing operations, committed)';

const FIXTURE_PATH = path.join(process.cwd(), 'scripts/fixtures/existingOperationsProject.json');

/**
 * The stored snapshot, as a fresh object every call.
 *
 * DEEP-CLONED ON PURPOSE: several verifiers mutate the state they are given
 * (switching the fund layer off, retyping a strategy, seeding a case), and a
 * shared object would carry one verifier's edit into the next one's run.
 */
export function buildExistingOperationsState(): any {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}
