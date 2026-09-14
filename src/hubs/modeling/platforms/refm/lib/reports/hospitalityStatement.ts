/**
 * hospitalityStatement.ts (2026-09-14)
 *
 * THE HOTEL OPERATING STATEMENT, STATED ONCE, for the Opex Output tab, the
 * P&L, the PDF and the workbook alike.
 *
 * WHY IT EXISTS. The engine has always computed a hotel's GOP and NOI
 * (`AssetOpexResult.gopPerPeriod`, `noiPerPeriod`) and nothing showed them: the
 * Opex Output tab said "No GOP / NOI rows, those compose in M4 P&L", and the
 * P&L carried a hotel as one revenue lump and one opex lump. On the live
 * project that was 316.0m of revenue and 218.7m of opex with no Rooms / F&B /
 * Other split, no departmental profit and no GOP (97.3m) anywhere a founder
 * could read it.
 *
 * THE SHAPE is the conventional hotel operating statement: operating
 * statistics, revenue by department, departmental expenses, departmental
 * profit, undistributed operating expenses, gross operating profit, management
 * fees, fixed charges and reserves, EBITDA (net operating income).
 *
 * THE GROUPS SIT ON THE ENGINE'S OWN CATEGORIES. GOP here is revenue less the
 * `direct_*` and `indirect_*` lines, which is exactly the engine's `gop`; the
 * last line is revenue less every enabled line, exactly its `noi`. The one
 * presentation choice is that a replacement reserve reads under fixed charges
 * and reserves, where the engine's management bucket carries it: that moves
 * nothing either side of GOP. A check row states the engine's total opex less
 * the four groups, which is zero by construction and shown so it can be seen.
 *
 * PER LINE. A line is one type in one phase across its plots (lib/revenueLines),
 * the unit every Module 2 tab reads; its statement is the SUM of its plots'.
 *
 * Pure. No em dashes in this file.
 */

import type { M4Row } from '../../components/modules/_shared/m4Table';
import type { AssetOpexResult } from '@/src/core/calculations/opex';
import type { HospitalityAssetResult } from '@/src/core/calculations/revenue';
import { sumHospitalityResults, type ProjectRevenueSnapshot } from '../revenue-resolvers';
import type { ProjectOpexSnapshot } from '../opex-resolvers';
import { planRevenueLines, type RevenueLine } from '../revenueLines';
import type { Asset, Phase, Project, SubUnit } from '../state/module1-types';

export type HospitalityCostGroup = 'departmental' | 'undistributed' | 'management' | 'fixed';

export const HOSPITALITY_COST_GROUPS: readonly HospitalityCostGroup[] = ['departmental', 'undistributed', 'management', 'fixed'];

export const HOSPITALITY_COST_GROUP_LABEL: Record<HospitalityCostGroup, string> = {
  departmental: 'Departmental expenses',
  undistributed: 'Undistributed operating expenses',
  management: 'Management fees',
  fixed: 'Fixed charges and reserves',
};

/** THE ONE ROUTING of an opex line category into the statement. */
export function hospitalityCostGroup(category: string): HospitalityCostGroup {
  if (category === 'direct_rooms' || category === 'direct_fb' || category === 'direct_other') return 'departmental';
  if (category.startsWith('indirect_')) return 'undistributed';
  if (category === 'mgmt_base' || category === 'mgmt_tech' || category === 'mgmt_incentive') return 'management';
  return 'fixed';
}

export interface HospitalityCostLine {
  group: HospitalityCostGroup;
  name: string;
  values: number[];
}

export interface HospitalityStatement {
  key: string;
  axisLength: number;
  /** The members' hospitality results summed, rates re-derived (occupancy, ADR). */
  revenue: HospitalityAssetResult;
  /** Static keys across the members' rows. */
  keys: number;
  /** Enabled opex lines, same-named lines of one group added across plots. */
  costLines: HospitalityCostLine[];
  groupTotals: Record<HospitalityCostGroup, number[]>;
  /** The engine's total opex, summed across members. */
  totalOpex: number[];
  departmentalProfit: number[];
  gop: number[];
  ebitda: number[];
  /** Engine total opex less the four groups, every period. Zero by construction. */
  check: number[];
}

export interface HospitalityMember {
  asset: Pick<Asset, 'opex'>;
  opex?: AssetOpexResult;
  revenue?: HospitalityAssetResult;
}

const sum = (a: readonly number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
const ratio = (num: readonly number[], den: readonly number[]): number[] => num.map((v, i) => ((den[i] ?? 0) > 0 ? v / den[i] : 0));

export function buildHospitalityStatement(
  members: readonly HospitalityMember[],
  axisLength: number,
  key: string,
): HospitalityStatement {
  const N = Math.max(0, axisLength);
  const z = (): number[] => new Array<number>(N).fill(0);
  const revenue = sumHospitalityResults(
    members.map((m) => m.revenue).filter((r): r is HospitalityAssetResult => !!r),
    N, key, true,
  );
  const keys = Object.values(revenue.perSubUnit ?? {}).reduce((s, su) => s + Math.max(0, su.keys), 0);

  const byKey = new Map<string, HospitalityCostLine>();
  const costLines: HospitalityCostLine[] = [];
  const groupTotals: Record<HospitalityCostGroup, number[]> = { departmental: z(), undistributed: z(), management: z(), fixed: z() };
  const totalOpex = z();
  for (const m of members) {
    const total = m.opex?.totalOpexPerPeriod ?? [];
    for (let t = 0; t < N; t++) totalOpex[t] += total[t] ?? 0;
    const per = m.opex?.perLinePerPeriod ?? [];
    (m.asset.opex?.lines ?? []).forEach((ln, i) => {
      // The engine leaves a disabled line out of every total, so does this.
      if (ln.disabled) return;
      const group = hospitalityCostGroup(String(ln.category));
      const k = `${group}|${ln.name}`;
      let row = byKey.get(k);
      if (!row) {
        row = { group, name: ln.name, values: z() };
        byKey.set(k, row);
        costLines.push(row);
      }
      const src = per[i] ?? [];
      for (let t = 0; t < N; t++) {
        const v = src[t] ?? 0;
        row.values[t] += v;
        groupTotals[group][t] += v;
      }
    });
  }

  const departmentalProfit = z(), gop = z(), ebitda = z(), check = z();
  for (let t = 0; t < N; t++) {
    const rev = revenue.totalRevenuePerPeriod[t] ?? 0;
    departmentalProfit[t] = rev - groupTotals.departmental[t];
    gop[t] = departmentalProfit[t] - groupTotals.undistributed[t];
    ebitda[t] = gop[t] - groupTotals.management[t] - groupTotals.fixed[t];
    check[t] = totalOpex[t] - groupTotals.departmental[t] - groupTotals.undistributed[t] - groupTotals.management[t] - groupTotals.fixed[t];
  }
  return { key, axisLength: N, revenue, keys, costLines, groupTotals, totalOpex, departmentalProfit, gop, ebitda, check };
}

/**
 * OPERATING STATISTICS: keys, room nights, occupancy, ADR, RevPAR. Counts and
 * rates carry `valueKind` and ratios `isPercent`, so no surface prints a night
 * rate at the project's money scale; each carries its lifetime figure in
 * `totalValue`, because a sum of occupancies or ADRs is not a number.
 * Empty when the line has no available room nights at all.
 */
export function hospitalityStatisticsRows(st: HospitalityStatement): M4Row[] {
  const r = st.revenue;
  const arn = r.availableRoomNightsPerPeriod;
  const orn = r.occupiedRoomNightsPerPeriod;
  if (!arn.some((v) => v > 0)) return [];
  const sArn = sum(arn), sOrn = sum(orn), sRooms = sum(r.roomsRevenuePerPeriod);
  return [
    { label: 'Keys', values: arn.map((v, t) => (v > 0 ? (r.effectiveKeysPerPeriod[t] ?? 0) : 0)), valueKind: 'count', totalValue: st.keys },
    { label: 'Available room nights', values: arn, valueKind: 'count' },
    { label: 'Occupied room nights', values: orn, valueKind: 'count' },
    { label: 'Occupancy', values: r.occupancyPerPeriod, isPercent: true, totalValue: sArn > 0 ? sOrn / sArn : 0 },
    { label: 'Average daily rate, ADR', values: r.adrPerPeriod, valueKind: 'rate', totalValue: sOrn > 0 ? sRooms / sOrn : 0 },
    { label: 'Revenue per available room, RevPAR', values: ratio(r.roomsRevenuePerPeriod, arn), valueKind: 'rate', totalValue: sArn > 0 ? sRooms / sArn : 0 },
  ];
}

/** THE OPERATING STATEMENT, revenue down to EBITDA, with the check row. */
export function hospitalityStatementRows(st: HospitalityStatement): M4Row[] {
  const r = st.revenue;
  const rows: M4Row[] = [];
  const revTotal = sum(r.totalRevenuePerPeriod);
  rows.push({ label: 'Revenue', values: [], isSection: true });
  rows.push({ label: 'Rooms revenue', values: r.roomsRevenuePerPeriod, indent: 1 });
  rows.push({ label: 'F&B revenue', values: r.fbRevenuePerPeriod, indent: 1 });
  rows.push({ label: 'Other revenue', values: r.otherRevenuePerPeriod, indent: 1 });
  rows.push({ label: 'Total revenue', values: r.totalRevenuePerPeriod, isSubtotal: true });

  const group = (g: HospitalityCostGroup, totalLabel: string): void => {
    const lines = st.costLines.filter((l) => l.group === g);
    if (lines.length === 0) return;
    rows.push({ label: HOSPITALITY_COST_GROUP_LABEL[g], values: [], isSection: true });
    for (const l of lines) rows.push({ label: l.name, values: l.values, indent: 1 });
    rows.push({ label: totalLabel, values: st.groupTotals[g], isSubtotal: true });
  };

  group('departmental', 'Total departmental expenses');
  rows.push({ label: 'Departmental profit', values: st.departmentalProfit, isSubtotal: true });
  group('undistributed', 'Total undistributed operating expenses');
  rows.push({ label: 'Gross operating profit, GOP', values: st.gop, isTotal: true });
  rows.push({
    label: 'GOP margin', values: ratio(st.gop, r.totalRevenuePerPeriod), isPercent: true,
    totalValue: revTotal > 0 ? sum(st.gop) / revTotal : 0,
  });
  group('management', 'Total management fees');
  group('fixed', 'Total fixed charges and reserves');
  rows.push({ label: 'EBITDA, net operating income', values: st.ebitda, isTotal: true });
  rows.push({
    label: 'EBITDA margin', values: ratio(st.ebitda, r.totalRevenuePerPeriod), isPercent: true,
    totalValue: revTotal > 0 ? sum(st.ebitda) / revTotal : 0,
  });
  rows.push({ label: 'Check, total opex less the four expense groups', values: st.check });
  return rows;
}

/** The P&L's hospitality revenue members: Rooms, F&B, Other. They sum to the
 *  line's revenue, so the section header still foots. */
export function hospitalityRevenueParts(st: HospitalityStatement): Array<{ label: string; values: number[] }> {
  return [
    { label: 'Rooms revenue', values: st.revenue.roomsRevenuePerPeriod },
    { label: 'F&B revenue', values: st.revenue.fbRevenuePerPeriod },
    { label: 'Other revenue', values: st.revenue.otherRevenuePerPeriod },
  ];
}

/** The P&L's hospitality opex members: the four groups. They sum to the
 *  engine's total opex (the check row is zero), so the header still foots. */
export function hospitalityCostParts(st: HospitalityStatement): Array<{ label: string; values: number[] }> {
  return HOSPITALITY_COST_GROUPS.map((g) => ({ label: HOSPITALITY_COST_GROUP_LABEL[g], values: st.groupTotals[g] }));
}

export interface HospitalityLineStatement {
  line: RevenueLine;
  statement: HospitalityStatement;
}

/**
 * EVERY HOSPITALITY LINE'S STATEMENT. A line's Operate members only (the
 * strategy decides the form); `onlyAssetIds` narrows to a phase or any other
 * scope the caller has already chosen, so a P&L filtered to one phase files
 * that phase's plots and no others.
 */
export function hospitalityStatementsByLine(
  snap: { opex: ProjectOpexSnapshot; revenue: ProjectRevenueSnapshot; axisLength: number },
  state: { assets: readonly Asset[]; subUnits: readonly SubUnit[]; phases: readonly Phase[]; project: Project },
  onlyAssetIds?: ReadonlySet<string>,
): HospitalityLineStatement[] {
  const out: HospitalityLineStatement[] = [];
  for (const line of planRevenueLines(state.assets, state.subUnits, state.phases, state.project)) {
    const members = line.members.filter((a) => a.strategy === 'Operate' && (!onlyAssetIds || onlyAssetIds.has(a.id)));
    if (members.length === 0) continue;
    const statement = buildHospitalityStatement(
      members.map((a) => ({ asset: a, opex: snap.opex.byAsset.get(a.id), revenue: snap.revenue.byHospitalityAsset.get(a.id) })),
      snap.axisLength,
      line.key,
    );
    out.push({ line, statement });
  }
  return out;
}
