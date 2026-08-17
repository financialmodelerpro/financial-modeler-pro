/**
 * verify-y0-lump-placement.ts (2026-08-17)
 *
 * WHERE THE Y0 UPFRONT LUMP GOES, and that every surface agrees.
 *
 * A cost line's phase-local index 0 is the upfront lump: land cash, land in
 * kind, and anything following them. It belongs in the period BEFORE the phase
 * starts, which for a phase that starts with the project has to be clamped to
 * the first project period.
 *
 * THE DEFECT THIS PINS. The financing aggregate and the equity engine clamped
 * (M4 Pass 2W, 2026-05-24). The Costs tab's capex schedule did not: its guard
 * was `offset > 0`, so a phase-1 lump was added to NO column, while the model
 * placed it at index 0. Measured on a live project, 70,000,000 of phase 1 land
 * sat in the model, in the financing schedule and in the capex table's total
 * column, and in none of that table's period columns. One of the three tables
 * accumulated its row total inside the dropped branch, so it also REPORTED a
 * smaller number rather than merely misplacing it.
 *
 * Run: npx tsx scripts/verify-y0-lump-placement.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { phaseLocalToProjectIndex, projectAxisToPhaseLocal } from '../src/core/calculations/capexPhasing';
import { computeAssetCost } from '../src/core/calculations';
import { aggregateProjectCapex } from '../src/core/calculations/financing/capex';
import {
  makeBlankCostLines, makeDefaultPhase, makeDefaultProject,
  type Asset, type Parcel, type Phase, type SubUnit, type Project,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; return; }
  failures.push(`${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC_COSTS_UI = read('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx');
const SRC_FIN_CAPEX = read('src/core/calculations/financing/capex.ts');
const SRC_PHASING = read('src/core/calculations/capexPhasing.ts');

// ════════════════════════════════════════════════════════════════════════════
section('A. The rule itself');

{
  check('phase 1 (offset 0) clamps its Y0 lump onto the first period',
    phaseLocalToProjectIndex(0, 0) === 0, String(phaseLocalToProjectIndex(0, 0)));
  check('a later phase puts it in the period BEFORE the phase starts',
    phaseLocalToProjectIndex(0, 1) === 0 && phaseLocalToProjectIndex(0, 4) === 3);
  check('local 1 is the phase first period',
    phaseLocalToProjectIndex(1, 0) === 0 && phaseLocalToProjectIndex(1, 4) === 4);
  check('local i >= 1 advances one for one',
    phaseLocalToProjectIndex(3, 4) === 6 && phaseLocalToProjectIndex(2, 0) === 1);
  check('it never returns a negative index',
    [0, 1, 2, 5].every((i) => [0, 1, 3].every((o) => phaseLocalToProjectIndex(i, o) >= 0)));

  // It is the inverse of the reader used by the phasing resolver, for i >= 1.
  const series = [10, 20, 30, 40, 50, 60];
  const local = projectAxisToPhaseLocal(series, 2, 5) ?? [];
  for (let i = 1; i < local.length; i += 1) {
    check(`round trip at local ${i}`, series[phaseLocalToProjectIndex(i, 2)] === local[i],
      `${series[phaseLocalToProjectIndex(i, 2)]} vs ${local[i]}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('B. Nobody writes the rule out by hand any more');

{
  const ui = stripComments(SRC_COSTS_UI);
  check('the Costs tab has no drop guard left',
    !/offset2? > 0 && offset2? - 1/.test(ui),
    'a bare `offset > 0` guard is the defect: it drops phase 1 entirely');
  check('and no hand-written `offset - 1` placement',
    !/\w+Annual\[offset2? - 1\]/.test(ui) && !/annualRow\[offset - 1\]/.test(ui));
  const uiCalls = (ui.match(/phaseLocalToProjectIndex\(/g) ?? []).length;
  check('every Costs tab placement calls the shared rule', uiCalls >= 5, `${uiCalls} call sites`);

  const fin = stripComments(SRC_FIN_CAPEX);
  check('the financing aggregate calls it too',
    (fin.match(/phaseLocalToProjectIndex\(/g) ?? []).length >= 2);
  check('and no longer writes the ternary by hand',
    !/i === 0 \? Math\.max\(0, offset - 1\) : offset \+ i - 1/.test(fin));
  check('the rule lives in one file', stripComments(SRC_PHASING).includes('export function phaseLocalToProjectIndex('));
  // The stale docstring claimed the opposite of what the code did.
  check('the financing docstring no longer claims phase 1 drops its lump',
    !/Phase 1 \(offset = 0\) drops its Y0 lump entirely/.test(SRC_FIN_CAPEX));
}

// ════════════════════════════════════════════════════════════════════════════
section('C. End to end: the schedule carries phase 1 land');

{
  const project: Project = { ...makeDefaultProject(), startDate: '2026-01-01' };
  const phase1: Phase = { ...makeDefaultPhase('phase_1'), name: 'P1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 6 };
  const phase2: Phase = { ...makeDefaultPhase('phase_2'), id: 'phase_2', name: 'P2', startDate: '2028-01-01', constructionPeriods: 3, operationsPeriods: 6 };
  const parcels: Parcel[] = [
    { id: 'p1', phaseId: 'phase_1', name: 'Land 1', area: 10000, rate: 5000, cashPct: 60, inKindPct: 40 },
    { id: 'p2', phaseId: 'phase_2', name: 'Land 2', area: 4000, rate: 5000, cashPct: 60, inKindPct: 40 },
  ];
  const mk = (id: string, phaseId: string, parcelId: string, sqm: number): Asset => ({
    id, phaseId, name: id, type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
    landAllocation: { parcelId, sqm }, landAreaSqm: sqm,
  } as unknown as Asset);
  const assets = [mk('a1', 'phase_1', 'p1', 10000), mk('a2', 'phase_2', 'p2', 4000)];
  const subUnits: SubUnit[] = [];
  const costLines = [...makeBlankCostLines('phase_1', 4), ...makeBlankCostLines('phase_2', 3)];

  const bd1 = computeAssetCost({
    asset: assets[0], project, phase: phase1, parcels, assets, subUnits,
    costLines, costOverrides: [], landAllocationMode: 'sqm',
  });
  const landTotal1 = (bd1.byLineId['land-cash__phase_1'] ?? 0) + (bd1.byLineId['land-inkind__phase_1'] ?? 0);
  check('the phase 1 fixture actually has land (non-vacuous)', landTotal1 === 10000 * 5000, String(landTotal1));
  check('and the engine schedules it at local 0',
    (bd1.perLinePerPeriod['land-cash__phase_1'] ?? [])[0] === 10000 * 5000 * 0.6);

  // The financing aggregate: the model's own axis.
  const N = 12;
  const axis = {
    totalPeriods: N,
    phaseOffsets: new Map<string, number>([['phase_1', 0], ['phase_2', 2]]),
  } as unknown as Parameters<typeof aggregateProjectCapex>[1];
  const agg = aggregateProjectCapex({
    project, phases: [phase1, phase2], parcels, assets, subUnits,
    costLines, costOverrides: [], landAllocationMode: 'sqm', parcelFunding: [],
  }, axis);
  const landOnAxis = agg.perPeriod.landCash.reduce((s, v) => s + v, 0)
    + agg.perPeriod.landInKind.reduce((s, v) => s + v, 0);
  const landTotalBoth = 10000 * 5000 + 4000 * 5000;
  check('every currency unit of land reaches the project axis',
    Math.abs(landOnAxis - landTotalBoth) < 1, `${Math.round(landOnAxis)} vs ${landTotalBoth}`);
  check('phase 1 land lands in the FIRST period, not nowhere',
    Math.abs((agg.perPeriod.landCash[0] ?? 0) + (agg.perPeriod.landInKind[0] ?? 0) - 10000 * 5000) < 1,
    `period 0 = ${Math.round((agg.perPeriod.landCash[0] ?? 0) + (agg.perPeriod.landInKind[0] ?? 0))}`);
  check('phase 2 land lands the period before that phase starts',
    Math.abs((agg.perPeriod.landCash[1] ?? 0) + (agg.perPeriod.landInKind[1] ?? 0) - 4000 * 5000) < 1,
    `period 1 = ${Math.round((agg.perPeriod.landCash[1] ?? 0) + (agg.perPeriod.landInKind[1] ?? 0))}`);

  // THE ROW MUST FOOT. Rebuild what the Costs table now does and compare the
  // period columns to the total column.
  for (const [asset, phase, offset] of [[assets[0], phase1, 0], [assets[1], phase2, 2]] as const) {
    const bd = computeAssetCost({
      asset, project, phase, parcels, assets, subUnits,
      costLines, costOverrides: [], landAllocationMode: 'sqm',
    });
    const row = new Array<number>(N).fill(0);
    for (let i = 1; i < bd.perPeriod.length; i += 1) {
      const dest = phaseLocalToProjectIndex(i, offset);
      if (dest >= 0 && dest < N) row[dest] += bd.perPeriod[i] ?? 0;
    }
    const upfront = phaseLocalToProjectIndex(0, offset);
    if (upfront >= 0 && upfront < N) row[upfront] += bd.perPeriod[0] ?? 0;
    const rowSum = row.reduce((s, v) => s + v, 0);
    check(`${phase.name}: the period columns sum to the total column`,
      Math.abs(rowSum - bd.total) < 1, `${Math.round(rowSum)} vs ${Math.round(bd.total)}`);
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-y0-lump-placement: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
