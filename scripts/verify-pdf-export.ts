/* eslint-disable no-console */
/**
 * verify-pdf-export.ts
 *
 * Smoke test for the full-project PDF export (lib/pdf/generateProjectPdf).
 * Builds a real fixture (hotel + cost lines + senior debt + dividends), renders
 * the PDF headless, and checks: bytes > 0, it parses as a valid PDF, and the
 * page count matches the expected cover + one-page-per-selected-module floor.
 *
 * Run: npx tsx scripts/verify-pdf-export.ts
 */
import { PDFDocument } from 'pdf-lib';
import { generateProjectPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

function buildState(): any {
  const project: any = makeDefaultProject();
  project.name = 'Riverside Mixed-Use';
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  project.dividendPolicy = { enabled: true, payoutRatio: 100, mode: 'cash_above_min' };
  const p1: any = {
    ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01',
    constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
  };
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: Array(11).fill(0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };
  const cl = makeDefaultCostLines('p1', 2);
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  const tr = makeDefaultFinancingTranche('t1', 'p1');
  return { project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [tr], equityContributions: [] };
}

async function main(): Promise<void> {
  console.log('=== PDF export smoke test ===');
  const allKeys = ['module1', 'module2', 'module3', 'module4', 'module5'];

  // Full export.
  const bytes = await generateProjectPdf({
    state: buildState(),
    projectName: 'Riverside Mixed-Use',
    versionLabel: 'v1.0',
    dateLabel: '2 June 2026',
    selectedModuleKeys: allKeys,
  });
  check('returns bytes', bytes instanceof Uint8Array);
  check('file size > 0', bytes.length > 0, `len=${bytes.length}`);
  check('non-trivial size (> 2 KB)', bytes.length > 2048, `len=${bytes.length}`);

  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();
  // Cover (1) + at least one page per selected module section.
  check('page count >= cover + 5 modules', pageCount >= 1 + allKeys.length, `pages=${pageCount}`);

  // Subset export (single module): cover + at least one module page.
  const subsetBytes = await generateProjectPdf({
    state: buildState(),
    projectName: 'Riverside Mixed-Use',
    versionLabel: null,
    dateLabel: '2 June 2026',
    selectedModuleKeys: ['module4'],
  });
  const subsetDoc = await PDFDocument.load(subsetBytes);
  check('subset page count >= cover + 1', subsetDoc.getPageCount() >= 2, `pages=${subsetDoc.getPageCount()}`);
  check('subset smaller than full', subsetBytes.length < bytes.length, `subset=${subsetBytes.length} full=${bytes.length}`);

  // Empty selection still produces a valid (cover-only) document.
  const coverOnly = await generateProjectPdf({
    state: buildState(), projectName: 'X', versionLabel: null, dateLabel: 'd', selectedModuleKeys: [],
  });
  const coverDoc = await PDFDocument.load(coverOnly);
  check('empty selection => cover page only', coverDoc.getPageCount() === 1, `pages=${coverDoc.getPageCount()}`);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
