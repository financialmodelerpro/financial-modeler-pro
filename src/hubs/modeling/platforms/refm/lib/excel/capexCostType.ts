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
import { deriveCostStage, isLandValueLine } from '@/src/core/calculations';
import { resolveCatalogId } from '../state/costCatalog';
import type { CostLine } from '../state/module1-types';

export type CapexCostType = 'land' | 'rett' | 'hard' | 'soft' | 'contingency' | 'developerFee' | 'selling';

export const CAPEX_COST_TYPES: ReadonlyArray<{ id: CapexCostType; label: string }> = [
  { id: 'land', label: 'Land' },
  // RETT AND ANY OTHER LAND-STAGE COST ON ITS OWN ROW (2026-11-15, founder), so Land is the land value.
  { id: 'rett', label: 'RETT' },
  { id: 'hard', label: 'Hard costs' },
  { id: 'soft', label: 'Soft costs' },
  { id: 'contingency', label: 'Contingency' },
  { id: 'developerFee', label: 'Developer fee' },
  { id: 'selling', label: 'Selling (capitalised)' },
];

export function capexCostType(line: CostLine): CapexCostType {
  const stage = deriveCostStage(line);
  if (stage === 'land') return isLandValueLine(line) ? 'land' : 'rett';
  if (stage === 'hard') return 'hard';
  if (stage === 'marketing') return 'selling';
  const cat = resolveCatalogId(line);
  if (cat === 'contingency') return 'contingency';
  if (cat === 'developer-fee') return 'developerFee';
  return 'soft';
}

/**
 * The cost types a percentage line charges on, in words and in the registry's order ("hard costs, soft costs
 * and developer fee"), or '' when none (2026-11-17: one rule for the Inputs basis and the capex method table,
 * which each restated the type list; verify-capex-stage-buckets E1).
 */
export function costTypeWords(kinds: ReadonlySet<CapexCostType>): string {
  const words = CAPEX_COST_TYPES.filter((t) => kinds.has(t.id)).map((t) => t.label.toLowerCase());
  return words.join(', ').replace(/, ([^,]*)$/, ' and $1');
}
