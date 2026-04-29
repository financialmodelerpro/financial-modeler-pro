/**
 * Excel Export Fixture Runner
 *
 * Builds a deterministic xlsx from a baked-in generic sample payload by
 * calling `buildWorkbook()` directly (no Next.js server required). Used to
 * verify Phase 2 retrofit, and as the diff baseline for any future Excel
 * exporter changes.
 *
 * Usage:
 *   npx tsx scripts/excel-export-fixture.ts                 # writes default path
 *   npx tsx scripts/excel-export-fixture.ts ./out.xlsx      # custom path
 *
 * Tip: run twice across a refactor and compare with `cmp` (binary identical
 * after a deterministic-clock branch) or extract sheets and diff them with
 * `unzip -p out.xlsx xl/worksheets/sheet1.xml | xmllint --format -`.
 *
 * Generic sample data — no real client / project names. Numbers chosen so
 * every cell type fires (mixed-use 50/30/20 split, 4 construction + 5
 * operations periods, capitalized interest on, fixed-amortization debt).
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWorkbook, type ExportPayload, type FinancingResult, type CostItem } from '@modeling/lib/exporters/excel';

// ── Sample input payload ─────────────────────────────────────────────────────
function buildPayload(): ExportPayload {
  const constructionPeriods = 4;
  const operationsPeriods   = 5;
  const totalPeriods        = constructionPeriods + operationsPeriods;

  // Cost items — 4 lines per asset class, mix of methods + phasings.
  const makeCosts = (assetSeed: number): CostItem[] => [
    { id: assetSeed + 1, name: 'Land (Cash Portion)', method: 'fixed',         value: 50_000_000, startPeriod: 0, endPeriod: 0, phasing: '100',                  canDelete: false },
    { id: assetSeed + 2, name: 'Construction Cost',   method: 'rate_bua',      value: 4_500,      startPeriod: 1, endPeriod: 4, phasing: 'even',                 canDelete: true },
    { id: assetSeed + 3, name: 'Infrastructure',      method: 'rate_total_allocated', value: 200, startPeriod: 1, endPeriod: 4, phasing: '40,30,20,10',          canDelete: true },
    { id: assetSeed + 4, name: 'Professional Fee',    method: 'percent_base',  value: 8,          startPeriod: 1, endPeriod: 4, phasing: 'even',                 canDelete: true },
  ];

  // Build a financing result by running a simplified version of the same math
  // the orchestrator runs in `buildAssetFinancing`. The fixture purposely uses
  // round numbers so the exporter's totals are easy to eyeball.
  const buildFin = (totalCapex: number, debtRatio: number): FinancingResult => {
    const totalDebt   = totalCapex * debtRatio;
    const totalEquity = totalCapex - totalDebt;

    const debtAdd   = Array(totalPeriods + 1).fill(0);
    const equityAdd = Array(totalPeriods + 1).fill(0);
    for (let p = 1; p <= constructionPeriods; p++) {
      debtAdd[p]   = totalDebt   / constructionPeriods;
      equityAdd[p] = totalEquity / constructionPeriods;
    }

    const debtOpen  = Array(totalPeriods + 1).fill(0);
    const debtClose = Array(totalPeriods + 1).fill(0);
    const debtRep   = Array(totalPeriods + 1).fill(0);
    const interest  = Array(totalPeriods + 1).fill(0);
    const eqOpen    = Array(totalPeriods + 1).fill(0);
    const eqClose   = Array(totalPeriods + 1).fill(0);

    let debtBal = 0;
    let eqBal   = 0;
    for (let p = 0; p <= constructionPeriods; p++) {
      debtOpen[p] = debtBal;
      eqOpen[p]   = eqBal;
      interest[p] = debtBal * 0.075;
      debtBal += debtAdd[p];
      eqBal   += equityAdd[p];
      debtClose[p] = debtBal;
      eqClose[p]   = eqBal;
    }
    const repPerPeriod = debtClose[constructionPeriods] / operationsPeriods;
    for (let p = constructionPeriods + 1; p <= totalPeriods; p++) {
      debtOpen[p] = debtBal;
      eqOpen[p]   = eqBal;
      interest[p] = debtBal * 0.075;
      debtRep[p]  = repPerPeriod;
      debtBal -= repPerPeriod;
      debtClose[p] = Math.max(0, debtBal);
      eqClose[p]   = eqBal;
    }

    return {
      lineItems: [
        { name: 'Land (Cash Portion)',  total: totalCapex * 0.30, debtAmt: totalCapex * 0.30 * debtRatio, equityAmt: totalCapex * 0.30 * (1 - debtRatio), debtPct: debtRatio * 100 },
        { name: 'Construction Cost',    total: totalCapex * 0.50, debtAmt: totalCapex * 0.50 * debtRatio, equityAmt: totalCapex * 0.50 * (1 - debtRatio), debtPct: debtRatio * 100 },
        { name: 'Infrastructure',       total: totalCapex * 0.15, debtAmt: totalCapex * 0.15 * debtRatio, equityAmt: totalCapex * 0.15 * (1 - debtRatio), debtPct: debtRatio * 100 },
        { name: 'Professional Fee',     total: totalCapex * 0.05, debtAmt: totalCapex * 0.05 * debtRatio, equityAmt: totalCapex * 0.05 * (1 - debtRatio), debtPct: debtRatio * 100 },
      ],
      debtAdd, debtOpen, debtRep, debtClose,
      equityAdd, eqOpen, eqClose, interest,
      totalDebt, totalEquity,
      totalInterest: interest.reduce((s, v) => s + v, 0),
      totalPeriods,
    };
  };

  const totalLandValue = 250_000_000;
  const landValuePerSqm = 2_500;

  return {
    projectName:   'Sample Mixed-Use Development',
    projectType:   'mixed-use',
    country:       'Saudi Arabia',
    currency:      'SAR',
    modelType:     'annual',
    projectStart:  '2026-01-01',
    constructionPeriods, operationsPeriods,
    overlapPeriods: 0,
    projectEndDate: '2034-12-31',

    totalLandArea:    100_000,
    totalLandValue,
    landValuePerSqm,
    cashValue:        totalLandValue * 0.6,
    inKindValue:      totalLandValue * 0.4,
    cashPercent:      60,
    inKindPercent:    40,
    projectRoadsPct:  10,
    projectFAR:       1.5,
    projectNDA:       90_000,
    projectRoadsArea: 10_000,
    totalProjectGFA:  135_000,

    residentialPercent: 50, hospitalityPercent: 30, retailPercent: 20,
    residentialGFA: 67_500,  hospitalityGFA: 40_500,  retailGFA: 27_000,
    residentialBUA: 60_750,  hospitalityBUA: 34_425,  retailBUA: 25_650,
    residentialNetSaleable: 51_637, hospitalityNetSaleable: 27_540, retailNetSaleable: 23_085,
    residentialLandValue: 125_000_000, hospitalityLandValue: 75_000_000, retailLandValue: 50_000_000,

    showResidential: true, showHospitality: true, showRetail: true,
    costInputMode:   'separate',
    residentialCosts: makeCosts(100),
    hospitalityCosts: makeCosts(200),
    retailCosts:      makeCosts(300),

    interestRate:        7.5,
    financingMode:       'fixed',
    globalDebtPct:       60,
    capitalizeInterest:  true,
    repaymentPeriods:    5,
    repaymentMethod:     'fixed',
    lineRatios:          {},

    finRes:  buildFin(500_000_000, 0.6),
    finHosp: buildFin(300_000_000, 0.6),
    finRet:  buildFin(200_000_000, 0.6),

    totalCapex:   1_000_000_000,
    totalDebt:      600_000_000,
    totalEquity:    400_000_000,

    projectLabel: 'Sample Mixed-Use Development',
    versionLabel: 'Base Case',
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────
async function main() {
  const outPath = resolve(process.cwd(), process.argv[2] ?? 'scripts/excel-export-fixture.out.xlsx');
  const wb = buildWorkbook(buildPayload());
  const buf = await wb.xlsx.writeBuffer();
  writeFileSync(outPath, Buffer.from(buf));
  console.log(`Wrote ${(buf.byteLength / 1024).toFixed(1)} KB to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
