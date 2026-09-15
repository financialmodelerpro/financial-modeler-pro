/**
 * loadStoredModel.ts (2026-09-15)
 *
 * A SAVED VERSION IS READ THROUGH THE STORE, NEVER THROUGH MIGRATION ALONE.
 *
 * The screen loads a version by migrating it and then hydrating the store,
 * whose load steps put the model in its settled shape: the Types and Standards
 * defaults as cost overrides, the derived areas bag, the reference cost bases,
 * the sub-unit prices. Migration alone stops before all of that. Two readers
 * did stop there, and measured on the live project they priced a different
 * model from the one on screen:
 *   - the Portfolio dashboard route: development cost 1,313.13m against the
 *     screen's 1,337.57m, equity IRR 20% against 19%;
 *   - a saved version exported from the export dialog: profit after tax
 *     710.9m against 680.6m.
 * Both now call this, so a saved version reads the same everywhere.
 *
 * THE BASE CASE IS HYDRATED ACTIVE and the stored active case is restored on
 * the result, so the top-level fields are the settled Management model and a
 * caller that wants the saved active case applies it with `modelFromSnapshot`.
 * A fresh store instance each call: the app's live store is never touched.
 *
 * No em dashes in this file.
 */

import { createModule1Store, type HydrateSnapshot } from './module1-store';
import { hydrationFromAnySnapshotChecked } from './module1-migrate';
import { baseCaseId, normaliseCases } from '../cases/applyOverrides';

export interface LoadedStoredModel {
  /** The settled base model at top level, with the stored cases and active case id. */
  snapshot: HydrateSnapshot;
  migrationNotice?: string;
}

export function loadStoredModel(raw: unknown): LoadedStoredModel {
  const checked = hydrationFromAnySnapshotChecked(raw);
  const migrated = checked.snapshot;
  const cases = normaliseCases(migrated.cases);
  const baseId = baseCaseId(cases);
  const storedActive = migrated.activeCaseId && cases.some((c) => c.id === migrated.activeCaseId)
    ? migrated.activeCaseId
    : baseId;
  const store = createModule1Store();
  store.getState().hydrate({ ...migrated, cases, activeCaseId: baseId });
  const base = store.getState().extractPersistSnapshot() as HydrateSnapshot;
  return { snapshot: { ...base, activeCaseId: storedActive }, migrationNotice: checked.migrationNotice };
}
