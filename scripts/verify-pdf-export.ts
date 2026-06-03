/* eslint-disable no-console */
/**
 * verify-pdf-export.ts
 *
 * Smoke + structure test for the full-project PDF report (lib/pdf/generateProjectPdf).
 * Builds a rich fixture (hotel + residences + retail + sub-units + cost lines +
 * senior debt + dividends), renders the PDF headless, and checks:
 *   - bytes > 0 and the document parses as a valid PDF;
 *   - a SUBSTANTIAL page count (cover + description + every module's inputs /
 *     outputs / schedules in tab order, not a 10-page summary);
 *   - per-module Inputs / Outputs / Schedules toggles actually drop content;
 *   - the cover + description pages are always present (empty module selection
 *     still yields a 2-page document);
 *   - the underlying snapshot the PDF renders reconciles (BS balances by
 *     construction, Direct CF closing == Indirect CF closing) — the proxy for
 *     "numbers in the PDF match the UI", since both read the same snapshot.
 *
 * Run: npx tsx scripts/verify-pdf-export.ts
 */
import { PDFDocument } from 'pdf-lib';
import { generateProjectPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

const A = (n: number, fill = 0): number[] => Array(n).fill(fill);

function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Riverside Mixed-Use';
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  project.escrow = { heldPct: 0.2 };
  project.dividendPolicy = { enabled: true, payoutRatio: 100, mode: 'cash_above_min' };
  const p1: any = {
    ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01',
    constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
  };

  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(11, 0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: A(11), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: A(11), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const suH: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };

  const resi: any = {
    id: 'R1', phaseId: 'p1', name: 'Residences', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 20000, sellableBuaSqm: 20000, parkingBaysRequired: 0,
    revenue: { sell: {
      assetId: 'R1',
      subUnits: [{ subUnitId: 'rsu1', preSalesVelocityByPhase: [30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [0, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0] }],
      cashPaymentProfile: { percentages: [0.5, 0.5] },
      recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' },
      indexation: { method: 'none' },
    } },
  };
  const suR: any = { id: 'rsu1', assetId: 'R1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 };

  const retail: any = {
    id: 'L1', phaseId: 'p1', name: 'Retail', type: '', strategy: 'Lease', visible: true,
    gfaSqm: 0, buaSqm: 5000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 25,
    revenue: { lease: { assetId: 'L1', baseRate: 1200, rentIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(11, 0.9), arDays: 60 } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'lo1', name: 'Property mgmt', category: 'mgmt_base', mode: 'pct_of_lease_rev', value: 5, indexation: { method: 'none' }, useAssetDefault: false, rateMode: 'single' }] },
  };
  const suL: any = { id: 'lsu1', assetId: 'L1', name: 'Shops', category: 'Leasable', metric: 'area', metricValue: 5000, unitArea: 0, unitPrice: 1200 };

  const cl = makeDefaultCostLines('p1', 2);
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  const tr = makeDefaultFinancingTranche('t1', 'p1');
  return { project, phases: [p1], assets: [hotel, resi, retail], subUnits: [suH, suR, suL], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [tr], equityContributions: [] };
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

async function main(): Promise<void> {
  console.log('=== PDF full-report export test ===');
  const allKeys = ['module1', 'module2', 'module3', 'module4', 'module5'];

  // Full export, all parts.
  const bytes = await generateProjectPdf({
    state: buildState(),
    projectName: 'Riverside Mixed-Use',
    versionLabel: 'v1.0',
    versionComment: 'Base case with senior debt + 100% dividend sweep',
    dateLabel: '3 June 2026',
    selectedModuleKeys: allKeys,
  });
  check('returns bytes', bytes instanceof Uint8Array);
  check('file size > 0', bytes.length > 0, `len=${bytes.length}`);
  check('non-trivial size (> 8 KB)', bytes.length > 8192, `len=${bytes.length}`);

  const fullPages = await pageCount(bytes);
  // Cover + description + a full inputs/outputs/schedules walk across 5 modules
  // with three assets should run well past a 10-page summary.
  check('substantial page count (>= 15)', fullPages >= 15, `pages=${fullPages}`);

  // Subset export (single module): cover + description + at least one module page.
  const subsetBytes = await generateProjectPdf({
    state: buildState(), projectName: 'Riverside Mixed-Use', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module4'],
  });
  const subsetPages = await pageCount(subsetBytes);
  check('subset page count >= cover + description + 1', subsetPages >= 3, `pages=${subsetPages}`);
  check('subset smaller than full', subsetBytes.length < bytes.length, `subset=${subsetBytes.length} full=${bytes.length}`);

  // Part toggle: Module 1 outputs-only should be smaller than Module 1 all-parts.
  const m1All = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module1'],
  });
  const m1OutputsOnly = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: ['module1'],
    moduleSections: { module1: { inputs: false, outputs: true, schedules: false } },
  });
  check('part toggle drops content (m1 outputs-only < m1 all)', m1OutputsOnly.length < m1All.length, `out=${m1OutputsOnly.length} all=${m1All.length}`);
  check('part toggle still valid PDF', (await pageCount(m1OutputsOnly)) >= 2, '');

  // Empty selection still produces cover + description (both mandatory).
  const coverOnly = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: [],
  });
  check('empty selection => cover + description (2 pages)', (await pageCount(coverOnly)) === 2, '');

  // Data-layer reconciliation: the PDF renders this exact snapshot, so if it
  // balances + the two CF methods tie, the printed numbers match the UI.
  const snap = computeFinancialsSnapshot(buildState());
  const tol = Math.max(1000, Math.max(0, ...snap.bs.totalLiabilitiesAndEquityPerPeriod.map(Math.abs)) * 1e-6);
  const bsBalances = snap.bs.bsDifferencePerPeriod.every((v) => Math.abs(v) <= tol);
  check('snapshot BS balances by construction', bsBalances, `maxDiff=${Math.max(0, ...snap.bs.bsDifferencePerPeriod.map(Math.abs)).toFixed(2)}`);
  const cfTie = snap.directCF.closingCashPerPeriod.every((v, i) => Math.abs(v - (snap.indirectCF.closingCashPerPeriod[i] ?? 0)) <= 1);
  check('Direct CF closing == Indirect CF closing', cfTie, '');

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
