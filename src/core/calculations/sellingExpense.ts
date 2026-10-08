/**
 * sellingExpense.ts (2026-10-08, founder)
 *
 * THE ONE RULE FOR WHICH COSTS ARE EXPENSED AS INCURRED RATHER THAN CAPITALISED.
 *
 * Marketing: IAS 2 excludes selling costs from the cost of inventory, and
 * marketing and advertising are expensed as they are incurred. A line whose
 * derived stage is `marketing` (the stage the catalog gives Marketing) is
 * therefore charged to the P&L as an operating expense in the period it is
 * incurred and never enters capex, inventory, cost of sales or the total
 * development cost.
 *
 * Commission is NOT here, on purpose: a sales commission is an incremental cost
 * of obtaining a contract, which IFRS 15 capitalises and releases as the revenue
 * is recognised. It is a soft line, capitalised and released through cost of
 * sales with the recognition share, which is that timing.
 *
 * `computeAssetCost` applies this (core/index.ts). Zero imports beyond the stage
 * derivation, so anything may call it.
 *
 * No em dashes in this file.
 */
import type { CostLine } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { deriveCostStage } from './index';

export function isExpensedAsIncurred(line: CostLine): boolean {
  return deriveCostStage(line) === 'marketing';
}
