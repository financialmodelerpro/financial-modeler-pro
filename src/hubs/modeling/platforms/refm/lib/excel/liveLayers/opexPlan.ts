/**
 * opexPlan.ts (2026-10-28), FORMULA-LINKED EXPORT: THE SHAPE OF AN OPEX STATEMENT.
 *
 * One plan, read by the builder (which lays the rows out with the platform's
 * values) and by stage3Opex (which writes their formulas), so the two cannot
 * disagree about which row is which.
 *
 * A statement's cost rows are its stored lines, grouped as the platform groups
 * them (the hotel's four groups, the lease line's three), one row per name in a
 * group. A row whose lines are all switched off on Inputs moves to the end of
 * the statement under "Switched off"; it still counts in its group's total, so
 * switching it on in Excel moves the statement. A group total is printed only
 * where the group has two rows or more; with one row, that row is the total.
 *
 * No em dashes in this file.
 */
import type { OpexLine } from '@/src/core/calculations/opex';
import { hospitalityCostGroup, HOSPITALITY_COST_GROUPS, HOSPITALITY_COST_GROUP_LABEL } from '../../reports/hospitalityStatement';
import { leaseCostBucket } from '../../reports/opexReports';

export interface OpexCostRow { key: string; name: string; group: string; idxs: number[]; off: boolean }
export interface OpexGroupPlan { group: string; label: string; totalLabel: string; rows: OpexCostRow[]; totalKey?: string }
export interface OpexStatementPlan { groups: OpexGroupPlan[]; off: OpexCostRow[] }

const LEASE_GROUPS: Array<[string, string, string]> = [
  ['operating', 'Property operating costs', 'Total property operating costs'],
  ['recoveries', 'Service charge and recoverable costs', 'Total service charge and recoverable costs'],
  ['other_charges', 'Other charges', 'Total other charges'],
];
const HOTEL_TOTALS: Record<string, string> = {
  departmental: 'Total departmental expenses', undistributed: 'Total undistributed operating expenses',
  management: 'Total management fees', fixed: 'Total fixed charges and reserves',
};

/** The live row keys of a line's statement. */
export const oxKey = (lineKey: string, id: string): string => `ox|${lineKey}|${id}`;

export function planOpexStatement(lineKey: string, lines: readonly OpexLine[], isHotel: boolean): OpexStatementPlan {
  const defs: Array<[string, string, string]> = isHotel
    ? HOSPITALITY_COST_GROUPS.map((g) => [g, HOSPITALITY_COST_GROUP_LABEL[g], HOTEL_TOTALS[g]])
    : LEASE_GROUPS;
  const groupOf = (ln: OpexLine): string => (isHotel ? hospitalityCostGroup(String(ln.category)) : leaseCostBucket(String(ln.category)));
  let n = 0;
  const groups: OpexGroupPlan[] = defs.map(([group, label, totalLabel]) => {
    const names: string[] = [];
    lines.forEach((ln) => { if (groupOf(ln) === group && !names.includes(ln.name)) names.push(ln.name); });
    const rows = names.map((name) => {
      const idxs = lines.map((ln, i) => (groupOf(ln) === group && ln.name === name ? i : -1)).filter((i) => i >= 0);
      return { key: oxKey(lineKey, `c${n++}`), name, group, idxs, off: idxs.every((i) => lines[i].disabled === true) };
    });
    return { group, label, totalLabel, rows, totalKey: rows.length > 1 ? oxKey(lineKey, `t:${group}`) : undefined };
  });
  return { groups, off: groups.flatMap((g) => g.rows.filter((r) => r.off)) };
}

/** The row that carries a group's total: its total row, or its one row, or none. */
export const groupTotalKey = (g: OpexGroupPlan): string | undefined => g.totalKey ?? g.rows[0]?.key;
