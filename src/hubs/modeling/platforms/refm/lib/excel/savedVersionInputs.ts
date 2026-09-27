/**
 * savedVersionInputs.ts (2026-09-27)
 *
 * THE MODEL AN EXPORT OF A SAVED VERSION PRINTS, stated once. The Export
 * dialog's saved-version path, the formula-linked workbook's server route and
 * the verifiers' live fixture all read a stored snapshot the same way:
 * THROUGH THE STORE (`loadStoredModel`, the load the screen uses, since
 * migration alone drops the Types and Standards defaults), the settled base
 * as the Management model, the version's own active case kept, and the chosen
 * case's model when one is picked (else the version's own active model). Three
 * copies of this block would be three chances to export a different model from
 * the one on screen.
 *
 * Pure: no store writes, no network. No em dashes in this file.
 */
import { modelFromSnapshot, pickModel, type HydrateSnapshot } from '../state/module1-store';
import { loadStoredModel } from '../state/loadStoredModel';
import { baseCaseId, normaliseCases } from '../cases/applyOverrides';
import { caseModelOf } from '../cases/caseModel';

export interface SavedVersionInputs {
  /** The stored snapshot as the store loads it. */
  migrated: ReturnType<typeof loadStoredModel>['snapshot'];
  /** The model the statement tabs render. */
  state: ReturnType<typeof modelFromSnapshot>;
  /** Every case, for the Scenarios tab. */
  caseComparison: { baseModel: HydrateSnapshot; cases: ReturnType<typeof normaliseCases>; activeCaseId: string };
  projectName: string | null;
}

export function savedVersionInputs(rawSnapshot: unknown, chosenCaseId?: string | null): SavedVersionInputs {
  const migrated = loadStoredModel(rawSnapshot).snapshot;
  const cases = normaliseCases(migrated.cases);
  const activeCaseId = migrated.activeCaseId && cases.some((c) => c.id === migrated.activeCaseId) ? migrated.activeCaseId : baseCaseId(cases);
  const baseModel = pickModel(migrated as unknown as Record<string, unknown>);
  const chosen = chosenCaseId ? cases.find((c) => c.id === chosenCaseId) : undefined;
  // Picker untouched, or the case is not in this version: the version's own
  // active model. Otherwise the chosen case's model.
  const state = (chosen
    ? (chosen.role === 'base' ? baseModel : caseModelOf(baseModel, chosen.overrides))
    : modelFromSnapshot(migrated)) as ReturnType<typeof modelFromSnapshot>;
  return { migrated, state, caseComparison: { baseModel, cases, activeCaseId }, projectName: migrated.project?.name ?? null };
}
