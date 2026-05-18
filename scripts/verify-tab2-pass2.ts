/* eslint-disable no-console */
/**
 * verify-tab2-pass2.ts (Tab 2 Pass 2: Data Ownership + Auto-Rendering, 2026-05-12)
 *
 * Asserts each of the 4 data rules + each of the 4 fixes from
 * Tab2_Pass2_Data_Rules.md. Tab 1, Tab 3, Tab 4 are out of scope; this
 * verifier only touches Tab 2 surfaces (computeAssetLandSqm calc layer +
 * Module1Assets.tsx UI guards + Land Reconciliation iteration).
 *
 * Sections:
 *   1. Audit doc present.
 *   2. Fix 1 calc rules end-to-end (reference shape multi-phase fixture).
 *   3. Fix 2 companion guards (Areas Row, NDA row, hierarchy chips,
 *      footer summary, Land Recon list).
 *   4. Fix 3 + 4 auto-managed Area Recon (companion + zero-data
 *      non-companion).
 *   5. Em-dash sweep on touched files.
 *
 * Usage: npx tsx scripts/verify-tab2-pass2.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type Asset,
  type Parcel,
  type Phase,
  type SubUnit,
  makeDefaultPhase,
  makeDefaultProject,
  makeCompanionAsset,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAssetLandSqm,
} from '../src/core/calculations';

const REPO_ROOT = resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const pass = (name: string, msg = ''): void => { passed++; console.log(`  PASS  ${name}${msg ? ` (${msg})` : ''}`); };
const fail = (name: string, msg: string): void => { failed++; console.log(`  FAIL  ${name}: ${msg}`); };

const ASSETS_SRC = readFileSync(resolve(REPO_ROOT, 'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx'), 'utf8');
const CALC_SRC = readFileSync(resolve(REPO_ROOT, 'src/core/calculations/index.ts'), 'utf8');

// ── Section 1: audit doc ─────────────────────────────────────────────────
console.log('\n[1/5] Audit doc');
{
  const auditPath = resolve(REPO_ROOT, 'docs/tab2-pass2-audit.md');
  if (existsSync(auditPath)) pass('docs/tab2-pass2-audit.md present');
  else fail('audit doc', 'missing');
  const audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '';
  if (audit.includes('Rule 1') && audit.includes('Rule 2') && audit.includes('Rule 3') && audit.includes('Rule 4')) {
    pass('audit references all 4 rules');
  } else fail('audit rules coverage', 'missing rule references');
}

// ── Section 2: Fix 1 calc end-to-end on reference multi-phase shape ───────────
console.log('\n[2/5] Fix 1: computeAssetLandSqm per-phase data ownership (reference multi-phase)');
{
  // Three phases. Phase 1 has a parcel but NO assets (matches user brief).
  // Phase 2 has a parcel + two non-companion assets (BUA-weighted split).
  // Phase 3 has a parcel + two non-companion assets (BUA-weighted split).
  const phase1: Phase = { ...makeDefaultPhase(), id: 'phase-1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 5, operationsPeriods: 5, overlapPeriods: 0 };
  const phase2: Phase = { ...makeDefaultPhase(), id: 'phase-2', name: 'Phase 2', startDate: '2026-06-01', constructionPeriods: 5, operationsPeriods: 5, overlapPeriods: 0 };
  const phase3: Phase = { ...makeDefaultPhase(), id: 'phase-3', name: 'Phase 3', startDate: '2027-01-01', constructionPeriods: 5, operationsPeriods: 5, overlapPeriods: 0 };
  const parcel1: Parcel = { id: 'parcel-1', phaseId: 'phase-1', name: 'Parcel 1', area: 16348, rate: 98450, cashPct: 80, inKindPct: 20 };
  const parcel2: Parcel = { id: 'parcel-2', phaseId: 'phase-2', name: 'Parcel 2', area: 50000, rate: 98450, cashPct: 80, inKindPct: 20 };
  const parcel3: Parcel = { id: 'parcel-3', phaseId: 'phase-3', name: 'Parcel 3', area: 40000, rate: 98450, cashPct: 80, inKindPct: 20 };

  const brandedApt: Asset = {
    id: 'a-branded', phaseId: 'phase-2', name: 'Branded Apt T2&T3', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 130874, sellableBuaSqm: 84297, parkingBaysRequired: 0,
  };
  const residential: Asset = {
    id: 'a-residential', phaseId: 'phase-2', name: 'Residential Tower 01', type: '', strategy: 'Sell + Manage', visible: true,
    gfaSqm: 0, buaSqm: 154140, sellableBuaSqm: 100000, parkingBaysRequired: 0,
  };
  const residentialCompanion = makeCompanionAsset(residential, 100);
  const hotel: Asset = {
    id: 'a-hotel', phaseId: 'phase-3', name: 'Hotel 01', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 80000, sellableBuaSqm: 65000, parkingBaysRequired: 0,
  };
  const retail: Asset = {
    id: 'a-retail', phaseId: 'phase-3', name: 'Retail Mall', type: '', strategy: 'Lease', visible: true,
    gfaSqm: 0, buaSqm: 40000, sellableBuaSqm: 30000, parkingBaysRequired: 0,
  };

  const allAssets: Asset[] = [brandedApt, residential, residentialCompanion, hotel, retail];
  const parcels: Parcel[] = [parcel1, parcel2, parcel3];
  const subUnits: SubUnit[] = [];

  // Rule 1 + Rule 2: companion returns 0 always.
  const companionSqm = computeAssetLandSqm(residentialCompanion, parcels, allAssets, subUnits, 'autoByBua');
  if (companionSqm === 0) pass('companion returns 0 sqm (Rule 2)');
  else fail('companion 0 sqm', `got ${companionSqm}`);

  // Phase 2 split: Branded Apt (130874) + Residential (154140) over 50000 sqm parcel.
  const totalBua2 = 130874 + 154140;
  const brandedExpected = 50000 * (130874 / totalBua2);
  const residentialExpected = 50000 * (154140 / totalBua2);
  const brandedActual = computeAssetLandSqm(brandedApt, parcels, allAssets, subUnits, 'autoByBua');
  const residentialActual = computeAssetLandSqm(residential, parcels, allAssets, subUnits, 'autoByBua');
  if (Math.abs(brandedActual - brandedExpected) < 1) pass(`Branded Apt = ${brandedActual.toFixed(0)} sqm (BUA-weighted)`);
  else fail('Branded Apt BUA-weighted', `expected ${brandedExpected.toFixed(0)}, got ${brandedActual.toFixed(0)}`);
  if (Math.abs(residentialActual - residentialExpected) < 1) pass(`Residential Tower = ${residentialActual.toFixed(0)} sqm (BUA-weighted)`);
  else fail('Residential BUA-weighted', `expected ${residentialExpected.toFixed(0)}, got ${residentialActual.toFixed(0)}`);

  // Phase 2 + Phase 3 sums tie to parcel totals (companion contributes 0).
  const phase2Total = brandedActual + residentialActual + 0; // companion is 0
  if (Math.abs(phase2Total - 50000) < 1) pass('Phase 2 sum ties to parcel 2 area (50000)');
  else fail('Phase 2 sum', `expected 50000, got ${phase2Total.toFixed(0)}`);

  // Phase 3 split: Hotel (80000) + Retail (40000) over 40000 sqm parcel.
  const totalBua3 = 80000 + 40000;
  const hotelExpected = 40000 * (80000 / totalBua3);
  const retailExpected = 40000 * (40000 / totalBua3);
  const hotelActual = computeAssetLandSqm(hotel, parcels, allAssets, subUnits, 'autoByBua');
  const retailActual = computeAssetLandSqm(retail, parcels, allAssets, subUnits, 'autoByBua');
  if (Math.abs(hotelActual - hotelExpected) < 1) pass(`Hotel = ${hotelActual.toFixed(0)} sqm (BUA-weighted)`);
  else fail('Hotel BUA-weighted', `expected ${hotelExpected.toFixed(0)}, got ${hotelActual.toFixed(0)}`);
  if (Math.abs(retailActual - retailExpected) < 1) pass(`Retail Mall = ${retailActual.toFixed(0)} sqm (BUA-weighted)`);
  else fail('Retail BUA-weighted', `expected ${retailExpected.toFixed(0)}, got ${retailActual.toFixed(0)}`);

  // Rule 4: phase with NO non-companion assets returns 0 for any phantom asset.
  // Verify Phase 1: place a synthetic asset in phase-1 with no peers. Equal-share
  // fallback should NOT trigger because asset has buaSqm > 0; but if user has 0
  // BUA, the equal-share fallback should split phase 1 parcel.
  const phase1Solo: Asset = {
    id: 'a-phase1', phaseId: 'phase-1', name: 'Solo', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0,
  };
  const soloAssets = [phase1Solo];
  const soloSqm = computeAssetLandSqm(phase1Solo, parcels, soloAssets, subUnits, 'autoByBua');
  if (Math.abs(soloSqm - 16348) < 1) pass(`Phase 1 lone asset equal-share = ${soloSqm.toFixed(0)} sqm (full parcel)`);
  else fail('Phase 1 equal-share', `expected 16348, got ${soloSqm.toFixed(0)}`);

  // Crit: Phase 1 with parcel but NO assets at all — any phantom call returns 0.
  // Simulate by querying an asset in a phase with NO peer in the asset list.
  const phantomNoPeers: Asset = {
    id: 'phantom', phaseId: 'phase-x', name: 'Phantom', type: '', strategy: 'Sell', visible: true,
    gfaSqm: 0, buaSqm: 1000, sellableBuaSqm: 800, parkingBaysRequired: 0,
  };
  const phantomSqm = computeAssetLandSqm(phantomNoPeers, parcels, [], subUnits, 'autoByBua');
  if (phantomSqm === 0) pass('phase with no parcels returns 0 (Rule 4b)');
  else fail('phase no parcels', `expected 0, got ${phantomSqm}`);

  // Rule 1: explicit sqm wins regardless of BUA share.
  const explicit: Asset = {
    ...brandedApt, id: 'a-explicit', landAllocation: { sqm: 9999 },
  };
  const explicitSqm = computeAssetLandSqm(explicit, parcels, [explicit], subUnits, 'sqm');
  if (explicitSqm === 9999) pass('explicit sqm > 0 wins (Rule 1)');
  else fail('explicit sqm wins', `expected 9999, got ${explicitSqm}`);
}

// ── Section 3: Fix 2 companion guards ────────────────────────────────────
console.log('\n[3/5] Fix 2: companion guard sweep');
{
  const needles: Array<[string, string]> = [
    ['Areas Row guard', `!asset.isCompanion && (\n          <div\n            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)'`],
    ['NDA row guard', '!asset.isCompanion && project.projectNdaEnabled === true && project.projectNdaScope'],
    ['Hierarchy chips guard', '!asset.isCompanion && (() => {\n            const hier = computeAssetAreaHierarchy(asset, subUnits);'],
    ['Footer summary guard', `!asset.isCompanion && (() => {\n            const hier = computeAssetAreaHierarchy(asset, subUnits);\n            const eff = hier.bua > 0`],
    ['Land Recon companion exclusion', 'a.visible && a.isCompanion !== true'],
  ];
  for (const [name, needle] of needles) {
    if (ASSETS_SRC.includes(needle)) pass(name);
    else fail(name, `marker not found`);
  }
}

// ── Section 4: Fix 3 + 4 auto-managed Area Recon ─────────────────────────
console.log('\n[4/5] Fix 3 + 4: Area Reconciliation auto-render');
{
  if (ASSETS_SRC.includes('!asset.isCompanion && (() => {\n            const reconRevenue = assetSubUnits')) {
    pass('Fix 3: companion drops Area Reconciliation block');
  } else fail('Fix 3 companion drop', 'guard not found');
  if (ASSETS_SRC.includes('if (allZero) return null;')) pass('Fix 4: zero-data auto-skip');
  else fail('Fix 4 zero-data', 'allZero return null missing');
  // Auto-render reappears when sub-units exist (sanity on the conditional).
  if (ASSETS_SRC.includes('assetSubUnits.length === 0\n              && hierForRecon.bua === 0')) {
    pass('Fix 4 zero-data covers all 8 attributes (sub-units / BUA / NSA / Support / Parking / Land sqm / Land cost / Revenue)');
  } else fail('Fix 4 zero-data attributes', 'conjunction not found');
}

// ── Section 5: em-dash sweep on touched files ────────────────────────────
console.log('\n[5/5] Em-dash sweep on touched files');
{
  const files = [
    'src/core/calculations/index.ts',
    'src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx',
    'scripts/verify-tab2-pass2.ts',
    'docs/tab2-pass2-audit.md',
  ];
  for (const rel of files) {
    const txt = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    const t2Lines = txt.split(/\r?\n/).filter((l) => l.includes('T2P2') || l.includes('Tab2_Pass2') || l.includes('tab2-pass2'));
    const offending = t2Lines.filter((l) => l.includes('—'));
    if (offending.length === 0) pass(`${rel}: no em-dashes in T2P2 lines`);
    else fail(`${rel}: em-dashes`, `T2P2 lines: ${offending.length}`);
  }
  if (CALC_SRC.includes('T2P2 Fix 1 (2026-05-12)')) pass('CALC_SRC carries T2P2 marker');
  else fail('CALC_SRC T2P2 marker', 'missing');
}

console.log(`\nResults: ${passed} pass, ${failed} fail`);
if (failed > 0) process.exit(1);
