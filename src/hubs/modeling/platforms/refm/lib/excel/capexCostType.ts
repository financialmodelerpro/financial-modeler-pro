/**
 * capexCostType.ts (2026-11-12, founder: export simplification step 2)
 *
 * THE ONE RULE FOR A CAPEX LINE'S COST TYPE in the export's capex summary: land, hard, soft,
 * contingency, developer fee or selling. The stage is the platform's (`deriveCostStage`); the
 * contingency and the developer fee are soft-stage lines told apart by their catalog identity
 * (`resolveCatalogId`), never by their name. The builder (values) and the live layer (formulas)
 * both call it, so the block's rows add the same Table 1 lines in both files.
 *
 * No em dashes in this file.
 */
import { deriveCostStage } from '@/src/core/calculations';
import { resolveCatalogId } from '../state/costCatalog';
import type { CostLine } from '../state/module1-types';

export type CapexCostType = 'land' | 'hard' | 'soft' | 'contingency' | 'developerFee' | 'selling';

export const CAPEX_COST_TYPES: ReadonlyArray<{ id: CapexCostType; label: string }> = [
  { id: 'land', label: 'Land' },
  { id: 'hard', label: 'Hard costs' },
  { id: 'soft', label: 'Soft costs' },
  { id: 'contingency', label: 'Contingency' },
  { id: 'developerFee', label: 'Developer fee' },
  { id: 'selling', label: 'Selling (capitalised)' },
];

export function capexCostType(line: CostLine): CapexCostType {
  const stage = deriveCostStage(line);
  if (stage === 'land') return 'land';
  if (stage === 'hard') return 'hard';
  if (stage === 'marketing') return 'selling';
  const cat = resolveCatalogId(line);
  if (cat === 'contingency') return 'contingency';
  if (cat === 'developer-fee') return 'developerFee';
  return 'soft';
}
