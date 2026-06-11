/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * excelSampleState.ts
 *
 * Shared fixture for the Excel-export verifiers (verify-excel-export.ts and
 * verify-excel-recalc.ts). A small mixed-use project (a for-sale Residential
 * tower in Phase 1 + a Lease Retail block in Phase 2) priced so the project is
 * economic, exercising the positive-IRR path. Kept in one place so both
 * verifiers stay in sync.
 */
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

const A = (n: number, f = 0): number[] => Array(n).fill(f);

export function buildExcelSampleState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Riverside Mixed-Use';
  project.startDate = '2026-01-01';
  project.tax = { rate: 0.15 };
  project.returns = { discountRate: 0.11, exitYearOffset: 9, terminalMethod: 'exit_multiple', exitMultiple: 9, perpetuityGrowth: 0.02 };
  const p1: any = { ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0 };
  const p2: any = { ...makeDefaultPhase(), id: 'p2', name: 'Phase 2', startDate: '2028-01-01', constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 };
  const resi: any = { id: 'R1', phaseId: 'p1', name: 'Residences', type: '', strategy: 'Sell', visible: true, buaSqm: 20000, sellableBuaSqm: 20000,
    revenue: { sell: { assetId: 'R1', subUnits: [{ subUnitId: 'rsu1', preSalesVelocityByPhase: [30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [0, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0] }], cashPaymentProfile: { percentages: [0.5, 0.5] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
  const suR: any = { id: 'rsu1', assetId: 'R1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_500_000 };
  const retail: any = { id: 'L1', phaseId: 'p2', name: 'Retail', type: '', strategy: 'Lease', visible: true, buaSqm: 5000, usefulLifeYears: 25,
    revenue: { lease: { assetId: 'L1', baseRate: 1200, rentIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(8, 0.9), arDays: 60 } } };
  const suL: any = { id: 'lsu1', assetId: 'L1', name: 'Shops', category: 'Leasable', metric: 'area', metricValue: 5000, unitArea: 0, unitPrice: 1200 };
  const cl = [...makeDefaultCostLines('p1', 2), ...makeDefaultCostLines('p2', 2)];
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  return { project, phases: [p1, p2], assets: [resi, retail], subUnits: [suR, suL], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [makeDefaultFinancingTranche('t1', 'p1'), makeDefaultFinancingTranche('t2', 'p2')], equityContributions: [] };
}
