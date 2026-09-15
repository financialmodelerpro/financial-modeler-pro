/**
 * managementModel.ts (2026-09-15)
 *
 * THE MANAGEMENT (BASE) MODEL, ONE RULE FOR EVERY SURFACE THAT SHOWS IT.
 *
 * While the base case is active the live store IS the base, edits included, so
 * it is read directly; the store's `baseSnapshot` is refreshed from it only
 * when the user leaves the base case, and reading that copy while the base is
 * active shows the model as it stood when the project opened. While a
 * scenario is active the live store holds the scenario, so the base is the
 * stored copy. The IC deck read the copy in both states, which put an equity
 * IRR on the investor document that the screen did not show.
 *
 * No em dashes in this file.
 */

import { baseCaseId } from './applyOverrides';
import type { ProjectCase } from '../state/module1-types';

export function managementModelOf<T>(state: { cases: readonly ProjectCase[]; activeCaseId: string; baseSnapshot: T }, liveModel: T): T {
  return state.activeCaseId === baseCaseId(state.cases as ProjectCase[]) ? liveModel : state.baseSnapshot;
}
