/**
 * PDF Export Fixture Runner
 *
 * Builds a deterministic PDF from a baked-in generic sample payload by
 * calling `buildPdfBuffer()` directly (no Next.js server required). Used
 * to verify Phase 3 retrofit, and as the diff baseline for any future PDF
 * exporter changes.
 *
 * Usage:
 *   npx tsx scripts/pdf-export-fixture.ts                 # writes default path
 *   npx tsx scripts/pdf-export-fixture.ts ./out.pdf       # custom path
 *
 * Tip: run twice across a refactor and compare with a PDF diff tool. PDFs
 * embed a creation-date timestamp so byte-identical compares will not work
 * even on identical input — diff visually or extract text via `pdftotext`.
 *
 * Generic sample data — no real client / project names. Mirrors the Excel
 * fixture's payload shape (slimmed to the PDF's narrower type surface).
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPdfBuffer, type ExportPayload, type FinancingResult } from '@modeling/lib/exporters/pdf';

// ── Sample input payload ─────────────────────────────────────────────────────
function buildPayload(): ExportPayload {
  const constructionPeriods = 4;
  const operationsPeriods   = 5;

  // Cost items — 4 lines per asset, mix of methods. Type is narrower than
  // the Excel fixture (no id / startPeriod / endPeriod / phasing / canDelete).
  const makeCosts = () => [
    { name: 'Land (Cash Portion)', method: 'fixed',                 value: 50_000_000 },
    { name: 'Construction Cost',   method: 'rate_bua',              value: 4_500 },
    { name: 'Infrastructure',      method: 'rate_total_allocated',  value: 200 },
    { name: 'Professional Fee',    method: 'percent_base',          value: 8 },
  ];

  // Financing result — round-number debt/equity totals so the PDF totals
  // line up at a glance.
  const buildFin = (totalCapex: number, debtRatio: number): FinancingResult => {
    const totalDebt   = totalCapex * debtRatio;
    const totalEquity = totalCapex - totalDebt;
    return {
      lineItems: [
        { name: 'Land (Cash Portion)', total: totalCapex * 0.30, debtAmt: totalCapex * 0.30 * debtRatio, equityAmt: totalCapex * 0.30 * (1 - debtRatio), debtPct: debtRatio * 100 },
        { name: 'Construction Cost',   total: totalCapex * 0.50, debtAmt: totalCapex * 0.50 * debtRatio, equityAmt: totalCapex * 0.50 * (1 - debtRatio), debtPct: debtRatio * 100 },
        { name: 'Infrastructure',      total: totalCapex * 0.15, debtAmt: totalCapex * 0.15 * debtRatio, equityAmt: totalCapex * 0.15 * (1 - debtRatio), debtPct: debtRatio * 100 },
        { name: 'Professional Fee',    total: totalCapex * 0.05, debtAmt: totalCapex * 0.05 * debtRatio, equityAmt: totalCapex * 0.05 * (1 - debtRatio), debtPct: debtRatio * 100 },
      ],
      totalDebt,
      totalEquity,
      totalInterest: totalDebt * 0.075 * (constructionPeriods / 2),
    };
  };

  const totalLandValue  = 250_000_000;
  const landValuePerSqm = 2_500;

  return {
    projectName:   'Sample Mixed-Use Development',
    projectType:   'mixed-use',
    country:       'Saudi Arabia',
    currency:      'SAR',
    modelType:     'annual',
    projectStart:  '2026-01-01',
    constructionPeriods, operationsPeriods,
    projectEndDate: '2034-12-31',

    totalLandArea:    100_000,
    totalLandValue,
    landValuePerSqm,
    cashPercent:      60,
    inKindPercent:    40,
    projectRoadsPct:  10,
    projectFAR:       1.5,
    projectNDA:       90_000,
    totalProjectGFA:  135_000,

    residentialPercent: 50, hospitalityPercent: 30, retailPercent: 20,
    residentialGFA: 67_500,  hospitalityGFA: 40_500,  retailGFA: 27_000,
    residentialBUA: 60_750,  hospitalityBUA: 34_425,  retailBUA: 25_650,

    showResidential: true, showHospitality: true, showRetail: true,
    costInputMode:   'separate',
    residentialCosts: makeCosts(),
    hospitalityCosts: makeCosts(),
    retailCosts:      makeCosts(),

    interestRate:        7.5,
    financingMode:       'fixed',
    globalDebtPct:       60,
    capitalizeInterest:  true,
    repaymentPeriods:    5,
    repaymentMethod:     'fixed',

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
  const outPath = resolve(process.cwd(), process.argv[2] ?? 'scripts/pdf-export-fixture.out.pdf');
  const buf = await buildPdfBuffer(buildPayload());
  writeFileSync(outPath, buf);
  console.log(`Wrote ${(buf.byteLength / 1024).toFixed(1)} KB to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
