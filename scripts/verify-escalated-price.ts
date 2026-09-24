/**
 * verify-escalated-price.ts (2026-09-24)
 *
 * Pins Module 2's table 2a ("Sale price per sqm per year, after indexation"),
 * built once by `buildEscalatedPriceTable` for the screen, the PDF and the
 * workbook:
 *
 *   A. ONE factor row, then ONE price PER SQM row per sub-unit.
 *   B. An AREA row is its base price x the factor, exactly what it was before
 *      (the change moves no figure on an area row).
 *   C. A UNIT row reads per sqm as price per unit over the area one unit
 *      counts, so area sold x that rate = units sold x price per unit, the
 *      revenue 2b shows. A unit row with no area says so and prints no guess.
 *   D. All three surfaces call the one builder; no copy of the loop is left.
 *
 * Run: npx tsx scripts/verify-escalated-price.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'node:fs';
import { applyIndexation } from '../src/core/calculations/revenue';
import { computeSubUnitArea } from '../src/core/calculations';
import { buildEscalatedPriceTable } from '../src/hubs/modeling/platforms/refm/lib/reports/revenueOutputReports';
import type { Asset, SubUnit } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}
const src = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

const asset = { id: 'a1', strategy: 'Sell', type: 'Villas' } as unknown as Asset;
const areaRow = { id: 's1', assetId: 'a1', name: '1 BR', category: 'Sellable', metric: 'area', metricValue: 1000, unitPrice: 40000 } as unknown as SubUnit;
const unitRow = { id: 's2', assetId: 'a1', name: '2 BR', category: 'Sellable', metric: 'units', metricValue: 10, unitArea: 150, unitPrice: 1_500_000 } as unknown as SubUnit;
const noArea = { id: 's3', assetId: 'a1', name: 'Plot', category: 'Sellable', metric: 'units', metricValue: 4, unitPrice: 900_000 } as unknown as SubUnit;
const idx = { method: 'yoy_compound', rate: 0.05, startYear: 1 } as Parameters<typeof applyIndexation>[2];
const N = 6;
const t = buildEscalatedPriceTable([areaRow, unitRow, noArea], () => asset, idx, N, 'SAR', (v) => v.toLocaleString('en-US', { maximumFractionDigits: 2 }));

console.log('=== A. One factor row, then one price per sqm row per sub-unit ===');
check('A1 the factor row is the indexation factor at each year', t.factor.length === N && t.factor.every((f, i) => near(f, applyIndexation(1, i, idx))));
check('A2 one row per sub-unit, each labelled per sqm', t.rows.length === 3 && t.rows.slice(0, 2).every((r) => /\/ sqm\)$/.test(r.label)), t.rows.map((r) => r.label).join(' | '));

console.log('\n=== B. An area row is unchanged: base x factor ===');
check('B1 the area row is applyIndexation(base, year), exactly what 2a printed before',
  t.rows[0].values.every((v, i) => v === applyIndexation(40000, i, idx)) && t.rows[0].basePerSqm === 40000);

console.log('\n=== C. A unit row, per sqm, true to the revenue ===');
const perUnitArea = computeSubUnitArea(unitRow, asset) / 10;
check('C0 the unit row has an area per unit to divide by', perUnitArea > 0, String(perUnitArea));
check('C1 per sqm = price per unit over the area one unit counts, then escalated',
  near(t.rows[1].basePerSqm ?? NaN, 1_500_000 / perUnitArea) && t.rows[1].values.every((v, i) => near(v, applyIndexation(1_500_000 / perUnitArea, i, idx))));
const unitsSold = 3, year = 3;
check('C2 area sold x price per sqm = units sold x price per unit (the revenue 2b shows)',
  near(unitsSold * perUnitArea * t.rows[1].values[year], unitsSold * applyIndexation(1_500_000, year, idx), 1e-3));
check('C3 the label states both prices', /1,500,000 \/ unit = 10,000 \/ sqm/.test(t.rows[1].label), t.rows[1].label);
check('C4 a unit row with no area says so and prints no guessed price',
  t.rows[2].basePerSqm === null && t.rows[2].values.every((v) => v === 0) && /no unit area, so no price per sqm/.test(t.rows[2].label), t.rows[2].label);

console.log('\n=== D. One builder on every surface ===');
const surfaces = {
  screen: src('src/hubs/modeling/platforms/refm/components/modules/Module2RevenueOutput.tsx'),
  pdf: src('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts'),
  workbook: src('src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts'),
};
for (const [name, s] of Object.entries(surfaces)) {
  check(`D1 the ${name} builds 2a through buildEscalatedPriceTable, titled per sqm`,
    /buildEscalatedPriceTable\(/.test(s) && /2a\. Sale price per sqm per year, after indexation/.test(s)
    && !/2a\. Sale price per year, after indexation \(per sub-unit\)/.test(s));
}
check('G the builder file has no em dashes', !src('src/hubs/modeling/platforms/refm/lib/reports/revenueOutputReports.ts').includes('—'));

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
if (failed) { console.log(fails.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
