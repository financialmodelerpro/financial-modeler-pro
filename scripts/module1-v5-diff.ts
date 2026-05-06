/* eslint-disable no-console */
/**
 * module1-v5-diff.ts (M2.0)
 *
 * Single regression-guard snapshot diff replacing the 3 retired
 * baselines (module1-snapshot-diff, module1-multiphase-diff,
 * module1-areaprogram-diff).
 *
 * Builds a deterministic v5 HydrateSnapshot from a fixture + every
 * derived calc result, JSON-serialises, hashes, and compares to the
 * baseline file. If they diverge, exits 1.
 *
 * Usage:
 *   - Compare:  npx tsx scripts/module1-v5-diff.ts
 *   - Refresh:  npx tsx scripts/module1-v5-diff.ts --refresh
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

import {
  buildWizardSnapshot,
  type WizardDraft,
} from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import {
  computeAssetBua,
  computeAssetSellableBua,
  computeAssetLandCost,
  computePhaseCost,
  computeAssetCost,
  computeFinancing,
  computeLandAggregate,
  computeProjectEndDate,
  distribute,
} from '../src/core/calculations';

const REFRESH = process.argv.includes('--refresh');
const BASELINE_PATH = resolve(__dirname, 'baselines', 'module1-v5.json');

// ── Deterministic fixture ─────────────────────────────────────────────────
// MAAD-flavoured Saudi mixed-use feasibility shape: 2 phases, 2 parcels,
// 4 assets across all 4 strategies, sub-unit count + sub-unit area mix.
const FIXTURE: WizardDraft = {
  projectName: 'M2.0 Diff Fixture',
  currency: 'SAR',
  modelType: 'monthly',
  startDate: '2026-01-01',
  location: 'Riyadh',
  phases: [
    { name: 'Phase 1', constructionPeriods: 24, operationsPeriods: 60, overlapPeriods: 0 },
    { name: 'Phase 2', constructionPeriods: 18, operationsPeriods: 60, overlapPeriods: 6 },
  ],
  parcels: [
    { name: 'Parcel A', area: 80000, rate: 600, cashPct: 70, inKindPct: 30 },
    { name: 'Parcel B', area: 40000, rate: 400, cashPct: 50, inKindPct: 50 },
  ],
  landAllocationMode: 'autoByBua',
  assets: [
    {
      name: 'Apartments',
      strategy: 'Sell',
      type: 'High-end Apartments',
      gfaSqm: 0,
      buaSqm: 0,
      sellableBuaSqm: 0,
      parkingBaysRequired: 200,
      subUnitName: '2BR',
      subUnitMetric: 'count',
      subUnitMetricValue: 120,
      subUnitUnitArea: 110,
      subUnitUnitPrice: 1500000,
    },
    {
      name: 'Hotel',
      strategy: 'Operate',
      type: 'Hotel 5-star',
      gfaSqm: 0,
      buaSqm: 0,
      sellableBuaSqm: 0,
      parkingBaysRequired: 80,
      subUnitName: 'Hotel Key',
      subUnitMetric: 'count',
      subUnitMetricValue: 220,
      subUnitUnitArea: 45,
      subUnitUnitPrice: 850,
    },
    {
      name: 'Retail',
      strategy: 'Lease',
      type: 'Retail',
      gfaSqm: 0,
      buaSqm: 0,
      sellableBuaSqm: 0,
      parkingBaysRequired: 60,
      subUnitName: 'GLA',
      subUnitMetric: 'area',
      subUnitMetricValue: 5500,
      subUnitUnitArea: undefined,
      subUnitUnitPrice: 1200,
    },
    {
      name: 'Branded Residences',
      strategy: 'Sell + Manage',
      type: 'Branded Residences',
      gfaSqm: 0,
      buaSqm: 0,
      sellableBuaSqm: 0,
      parkingBaysRequired: 30,
      subUnitName: 'Penthouse',
      subUnitMetric: 'count',
      subUnitMetricValue: 20,
      subUnitUnitArea: 220,
      subUnitUnitPrice: 5000000,
    },
  ],
};

const snapshot = buildWizardSnapshot(FIXTURE);

// ── Derived ───────────────────────────────────────────────────────────────
const land = computeLandAggregate(snapshot.parcels);
const projectEnd = computeProjectEndDate(snapshot.project, snapshot.phases);

const perAsset = snapshot.assets.map((a) => {
  const phase = snapshot.phases.find((p) => p.id === a.phaseId)!;
  return {
    id: a.id,
    bua: computeAssetBua(a, snapshot.subUnits),
    sellable: computeAssetSellableBua(a, snapshot.subUnits),
    land: computeAssetLandCost(a, snapshot.parcels, snapshot.assets, snapshot.subUnits, snapshot.landAllocationMode),
    cost: computeAssetCost(a, snapshot.project, phase, snapshot.parcels, snapshot.assets, snapshot.subUnits, snapshot.costLines, snapshot.costOverrides, snapshot.landAllocationMode),
  };
});

const perPhase = snapshot.phases.map((p) => ({
  id: p.id,
  cost: computePhaseCost(p, snapshot.project, snapshot.costLines, snapshot.costOverrides, snapshot.parcels, snapshot.assets, snapshot.subUnits, snapshot.landAllocationMode),
}));

const perTranche = snapshot.financingTranches.map((t) => {
  const phase = snapshot.phases.find((p) => p.id === t.phaseId)!;
  const phaseCost = perPhase.find((pp) => pp.id === phase.id)!.cost;
  const totalSpan = phase.constructionPeriods + phase.operationsPeriods - phase.overlapPeriods;
  const capex = new Array(totalSpan).fill(0);
  for (let i = 0; i < phase.constructionPeriods; i++) {
    capex[i] = phaseCost.total / phase.constructionPeriods;
  }
  const presales = new Array(totalSpan).fill(0);
  return {
    id: t.id,
    fin: computeFinancing(t, phase, capex, presales, snapshot.project),
  };
});

const distSamples = {
  even: distribute('even', 12),
  frontloaded: distribute('frontloaded', 12),
  backloaded: distribute('backloaded', 12),
  manual: distribute('manual', 4, [3, 1, 1, 1]),
};

const composite = {
  snapshot,
  derived: { land, projectEnd, perAsset, perPhase, perTranche, distSamples },
};

const json = JSON.stringify(composite, null, 2);
const sha = createHash('sha256').update(json).digest('hex');

if (REFRESH) {
  if (!existsSync(dirname(BASELINE_PATH))) mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, json);
  console.log(`Refreshed baseline. ${(json.length / 1024).toFixed(1)} KB. sha256 ${sha.slice(0, 12)}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`Baseline missing at ${BASELINE_PATH}. Run with --refresh to seed.`);
  process.exit(1);
}

const baseline = readFileSync(BASELINE_PATH, 'utf8');
if (baseline === json) {
  console.log(`OK: bit-identical with baseline. ${(json.length / 1024).toFixed(1)} KB. sha256 ${sha.slice(0, 12)}`);
  process.exit(0);
}

console.error('FAIL: snapshot drift detected.');
console.error(`Baseline ${(baseline.length / 1024).toFixed(1)} KB, current ${(json.length / 1024).toFixed(1)} KB.`);
console.error(`Run \`npx tsx scripts/module1-v5-diff.ts --refresh\` to update.`);
process.exit(1);
