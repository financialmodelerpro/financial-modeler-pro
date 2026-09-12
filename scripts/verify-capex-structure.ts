/**
 * verify-capex-structure.ts (2026-08-17)
 *
 * The thirteen defects found by entering a real project end to end. Everything
 * here was reported from the SCREEN, not by a check, so each section pins the
 * behaviour a user would have to re-discover.
 *
 *   A. Land parcels are project-wide. A phase 2 asset can draw on a phase 1
 *      parcel, and the two weighted scopes are distinct and both resolve.
 *   B. No silent zero. Every path that yields a zero land rate says WHY.
 *   C. The period window follows the construction window, and the wizard seeds
 *      it from the phase rather than from the parameter default of 24.
 *   D. A followed source owns the window, and the engine reports the window it
 *      actually spent in.
 *   E. Stage is a per-line choice, and one derivation feeds every total.
 *   F. Catalog order: land, hard, soft, developer fee, contingency, MARKETING
 *      LAST, with the cascade wired upward-only.
 *   G. Ordering: insert anywhere, move within the phase, and the base picker
 *      follows position rather than creation order.
 *   H. The percent-of-selected base is reported, so a row can say what the
 *      percentage is charged on.
 *   I. The stale 1-to-25 windows on already-saved projects are repaired, and
 *      only those.
 *
 * Run: npx tsx scripts/verify-capex-structure.ts
 * No em dashes in this file.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  makeBlankCostLines, makeDefaultCostLines, makeDefaultPhase, makeDefaultProject,
  deriveCostWindow, STANDARD_COST_LINE_IDS,
  PARCEL_WEIGHTED_AVG, PARCEL_WEIGHTED_AVG_ALL, PARCEL_CUSTOM_RATE, isParcelSentinel,
  type Asset, type CostLine, type Parcel, type Phase, type SubUnit, type Project,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import {
  computeAssetCost, computeAssetLandBreakdown, computeSubUnitArea, resolveSubUnitMetric, calculateItemTotal,
  costLineBasisQuantity, costLineCaption, resolveAssetAreaMetrics,
  resolveAssetParkingArea, resolveAssetParkingBays, resolveAssetNetDevelopableArea,
  resolveAssetFootprintArea, resolveAssetLandscapeArea, deriveCostStage, landRateIssueText, isLandValueLine,
} from '../src/core/calculations';
import { eligibleBaseLines, assetVisibleLines } from '../src/core/calculations/selectedBase';
import { planRetailCompanionOverrides } from '../src/core/calculations/retailCompanion';
import { applyReferenceCostBases } from '../src/core/calculations/costBases';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCapexReport, assetCapexCategory } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { buildExcelSampleState } from './excelSampleState';
import { selectableCostMethods, COST_METHOD_LABELS, COST_METHOD_BASIS_HELP, type CostMethod } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { repairStaleWizardCostWindows } from '../src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { buildWizardSnapshot } from '../src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot';
import type { HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

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
const REFM = 'src/hubs/modeling/platforms/refm';
const SRC_COSTS_UI = read(`${REFM}/components/modules/Module1Costs.tsx`);
const SRC_ASSETS_UI = read(`${REFM}/components/modules/Module1Assets.tsx`);
const SRC_LABEL_UI = read(`${REFM}/components/ui/InputLabel.tsx`);
const SRC_STORE = read(`${REFM}/lib/state/module1-store.ts`);
const SRC_WIZARD = read(`${REFM}/lib/wizard/buildWizardSnapshot.ts`);

const base = (id: string): string => id.split('__')[0];

// ── Fixture: two phases, one parcel, bought in phase 1 ─────────────────────
const PHASE1: Phase = { ...makeDefaultPhase('phase_1'), name: 'Phase 1', constructionPeriods: 4, operationsPeriods: 8 };
const PHASE2: Phase = { ...makeDefaultPhase('phase_2'), name: 'Phase 2', constructionPeriods: 3, operationsPeriods: 8 };
const PARCELS: Parcel[] = [
  { id: 'parcel_1', phaseId: 'phase_1', name: 'Land 1', area: 24000, rate: 5000, cashPct: 60, inKindPct: 40 },
  { id: 'parcel_2', phaseId: 'phase_1', name: 'Land 2', area: 6000, rate: 1000, cashPct: 100, inKindPct: 0 },
];
const mkAsset = (id: string, phaseId: string, alloc: Asset['landAllocation']): Asset => ({
  id, phaseId, name: id, type: '', strategy: 'Sell', visible: true,
  gfaSqm: 0, buaSqm: 0, sellableBuaSqm: 0, parkingBaysRequired: 0, status: 'planned',
  landAllocation: alloc, landAreaSqm: alloc?.sqm ?? 0,
} as unknown as Asset);
const SUBS: SubUnit[] = [];

// ════════════════════════════════════════════════════════════════════════════
section('A. A parcel is project-wide, and weighted has two scopes');

{
  const p2Asset = mkAsset('a_p2', 'phase_2', { parcelId: 'parcel_1', sqm: 7500 });
  const p1Asset = mkAsset('a_p1', 'phase_1', { parcelId: 'parcel_1', sqm: 11000 });
  const assets = [p1Asset, p2Asset];
  const bdP2 = computeAssetLandBreakdown(p2Asset, PARCELS, assets, SUBS, 'sqm');
  check('a phase 2 asset resolves a phase 1 parcel', bdP2.rate === 5000, `rate=${bdP2.rate}`);
  check('and carries its land value', bdP2.landValue === 7500 * 5000, `value=${bdP2.landValue}`);
  check('with no rate issue raised', bdP2.rateIssue === undefined, String(bdP2.rateIssue));

  const bdP1 = computeAssetLandBreakdown(p1Asset, PARCELS, assets, SUBS, 'sqm');
  check('a same-phase reference is unchanged', bdP1.rate === 5000 && bdP1.landValue === 11000 * 5000);

  // Weighted, this phase: both parcels are in phase 1, so 24000 x 5000 +
  // 6000 x 1000 over 30000 sqm.
  const wPhase = computeAssetLandBreakdown(
    mkAsset('a_w', 'phase_1', { parcelId: PARCEL_WEIGHTED_AVG, sqm: 1000 }), PARCELS, assets, SUBS, 'sqm');
  const expected = (24000 * 5000 + 6000 * 1000) / 30000;
  check('weighted (this phase) resolves the blended rate', Math.abs(wPhase.rate - expected) < 1e-9, `${wPhase.rate} vs ${expected}`);

  // The phase-scoped option on a phase with NO parcels of its own is exactly
  // the reported defect: it resolves to zero, and now says so.
  const wPhase2 = computeAssetLandBreakdown(
    mkAsset('a_w2', 'phase_2', { parcelId: PARCEL_WEIGHTED_AVG, sqm: 1000 }), PARCELS, assets, SUBS, 'sqm');
  check('weighted (this phase) on a parcel-less phase is zero', wPhase2.rate === 0);
  check('and reports no_parcels_in_scope', wPhase2.rateIssue === 'no_parcels_in_scope', String(wPhase2.rateIssue));

  const wAll = computeAssetLandBreakdown(
    mkAsset('a_wall', 'phase_2', { parcelId: PARCEL_WEIGHTED_AVG_ALL, sqm: 1000 }), PARCELS, assets, SUBS, 'sqm');
  check('weighted (all parcels) answers on that same phase', Math.abs(wAll.rate - expected) < 1e-9, `rate=${wAll.rate}`);
  check('and raises no issue', wAll.rateIssue === undefined);

  check('the two weighted sentinels are distinct', String(PARCEL_WEIGHTED_AVG) !== String(PARCEL_WEIGHTED_AVG_ALL));
  check('isParcelSentinel covers all three', isParcelSentinel(PARCEL_WEIGHTED_AVG)
    && isParcelSentinel(PARCEL_WEIGHTED_AVG_ALL) && isParcelSentinel(PARCEL_CUSTOM_RATE)
    && !isParcelSentinel('parcel_1'));

  // Multi-parcel splits resolve project-wide too.
  const split = computeAssetLandBreakdown(
    mkAsset('a_split', 'phase_2', { multiParcelSplits: [{ parcelId: 'parcel_1', sqm: 1000 }, { parcelId: 'parcel_2', sqm: 1000 }] }),
    PARCELS, assets, SUBS, 'sqm');
  check('multi-parcel splits resolve across phases', split.landValue === 1000 * 5000 + 1000 * 1000, `value=${split.landValue}`);

  // The UI offers every parcel, not just the phase's.
  check('the parcel dropdown maps over every parcel', /\{parcels\.map\(\(p\) => \(\s*<option/.test(SRC_ASSETS_UI));
  check('the dropdown carries the all-parcels option', SRC_ASSETS_UI.includes('PARCEL_WEIGHTED_AVG_ALL'));
  check('each weighted option prints its resolved rate',
    SRC_ASSETS_UI.includes('phaseWeightedRate') && SRC_ASSETS_UI.includes('allWeightedRate'));
}

// ════════════════════════════════════════════════════════════════════════════
section('B. A zero land rate always says why');

{
  const assets: Asset[] = [];
  const dangling = computeAssetLandBreakdown(
    mkAsset('a_x', 'phase_1', { parcelId: 'parcel_deleted', sqm: 1000 }), PARCELS, assets, SUBS, 'sqm');
  check('a parcel id that matches nothing is flagged', dangling.rateIssue === 'parcel_missing', String(dangling.rateIssue));
  check('and still reports a zero value rather than guessing', dangling.landValue === 0);

  const zeroRate = computeAssetLandBreakdown(
    mkAsset('a_z', 'phase_1', { parcelId: 'parcel_zero', sqm: 1000 }),
    [...PARCELS, { id: 'parcel_zero', phaseId: 'phase_1', name: 'Zero', area: 100, rate: 0, cashPct: 100, inKindPct: 0 }],
    assets, SUBS, 'sqm');
  check('a parcel with a zero rate is flagged', zeroRate.rateIssue === 'zero_parcel_rate', String(zeroRate.rateIssue));

  const zeroCustom = computeAssetLandBreakdown(
    mkAsset('a_c', 'phase_2', { parcelId: PARCEL_CUSTOM_RATE, sqm: 1000, customRate: 0 }), PARCELS, assets, SUBS, 'sqm');
  check('a custom rate left at zero is flagged', zeroCustom.rateIssue === 'zero_custom_rate', String(zeroCustom.rateIssue));

  const goodCustom = computeAssetLandBreakdown(
    mkAsset('a_c2', 'phase_2', { parcelId: PARCEL_CUSTOM_RATE, sqm: 1000, customRate: 5000 }), PARCELS, assets, SUBS, 'sqm');
  check('a real custom rate raises nothing', goodCustom.rateIssue === undefined && goodCustom.rate === 5000);

  // A REAL rate must never be flagged: the check has to be able to stay quiet.
  const clean = computeAssetLandBreakdown(
    mkAsset('a_ok', 'phase_2', { parcelId: 'parcel_1', sqm: 1000 }), PARCELS, assets, SUBS, 'sqm');
  check('a resolved rate raises no issue', clean.rateIssue === undefined);

  for (const issue of ['parcel_missing', 'zero_parcel_rate', 'no_parcels_in_scope', 'zero_custom_rate'] as const) {
    check(`landRateIssueText covers ${issue}`, landRateIssueText(issue).length > 20);
  }
  check('the asset card renders the reason', SRC_ASSETS_UI.includes('landRateIssueText(landBreakdown.rateIssue)'));
  check('and marks the cell', SRC_ASSETS_UI.includes('data-rate-issue'));
}

// ════════════════════════════════════════════════════════════════════════════
section('C. The period window follows the construction window');

{
  for (const cp of [3, 4, 8, 24]) {
    const lines = makeBlankCostLines('phase_1', cp);
    const bad = lines.filter((l) => base(l.id) !== 'land-cash' && base(l.id) !== 'land-inkind' && base(l.id) !== 'rett')
      .filter((l) => l.endPeriod !== cp);
    check(`cp=${cp}: every non-land line ends at cp`, bad.length === 0, bad.map((l) => `${base(l.id)} ${l.startPeriod}-${l.endPeriod}`).join(', '));
    const land = lines.filter((l) => base(l.id) === 'land-cash' || base(l.id) === 'land-inkind' || base(l.id) === 'rett');
    check(`cp=${cp}: land rows stay in the Y0 slot`, land.every((l) => l.startPeriod === 0 && l.endPeriod === 0));
    check(`cp=${cp}: no line ends at the old 25`, lines.every((l) => l.endPeriod !== 25) || cp === 24);
  }
  check('every seeded line declares that it follows construction',
    makeBlankCostLines('phase_1', 4).every((l) => l.windowFollowsConstruction === true));
  check('a start never exceeds its end', makeBlankCostLines('phase_1', 1).every((l) => l.startPeriod <= l.endPeriod));

  // THE WIZARD IS THE DEFECT'S ORIGIN. It must pass the phase length.
  check('the wizard passes the phase construction length',
    /makeBlankCostLines\(p\.id, p\.constructionPeriods\)/.test(SRC_WIZARD));
  const draft: Parameters<typeof buildWizardSnapshot>[0] = {
    projectName: 'T', currency: 'SAR', modelType: 'annual', outputGranularity: 'annual',
    startDate: '2026-01-01', location: '', displayScale: 'full', projectType: 'Mixed-Use',
    phases: [
      { name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 4, operationsPeriods: 8, overlapPeriods: 0 },
      { name: 'Phase 2', startDate: '2030-01-01', constructionPeriods: 3, operationsPeriods: 8, overlapPeriods: 0 },
    ],
    parcels: [], landAllocationMode: 'sqm',
  };
  const wiz = buildWizardSnapshot(draft);
  const p1Lines = wiz.costLines.filter((c) => c.phaseId === 'phase_1' && base(c.id) === 'construction-bua');
  const p2Lines = wiz.costLines.filter((c) => c.phaseId === 'phase_2' && base(c.id) === 'construction-bua');
  check('wizard: a 4-period phase seeds 1 to 4', p1Lines[0]?.endPeriod === 4, `${p1Lines[0]?.startPeriod}-${p1Lines[0]?.endPeriod}`);
  check('wizard: a 3-period phase seeds 1 to 3', p2Lines[0]?.endPeriod === 3, `${p2Lines[0]?.startPeriod}-${p2Lines[0]?.endPeriod}`);
  check('wizard: nothing runs to 25', wiz.costLines.every((c) => c.endPeriod !== 25));

  // The store re-derives when the phase length changes, and ONLY for lines
  // that declare they follow it.
  check('updatePhase re-derives the following lines', SRC_STORE.includes('windowFollowsConstruction')
    && SRC_STORE.includes('deriveCostWindow(deriveLineBaseId(c.id), after.constructionPeriods)'));
  check('typing a window clears the flag',
    /onUpdateLine\(\{ startPeriod: n, windowFollowsConstruction: false \}\)/.test(SRC_COSTS_UI)
    && /onUpdateLine\(\{ endPeriod: n, windowFollowsConstruction: false \}\)/.test(SRC_COSTS_UI));
  check('and the row offers the way back', SRC_COSTS_UI.includes('followConstructionWindow'));
}

// ════════════════════════════════════════════════════════════════════════════
section('D. A followed source owns the window, and the engine reports it');

{
  const project: Project = { ...makeDefaultProject(), startDate: '2026-01-01' };
  const asset = mkAsset('a1', 'phase_1', { parcelId: 'parcel_1', sqm: 10000 });
  const lines = makeBlankCostLines('phase_1', 4).map((l) => (
    base(l.id) === 'marketing' ? { ...l, value: 10 } : l));
  const subs: SubUnit[] = [{
    id: 's1', assetId: 'a1', name: 'Apts', category: 'Sellable', metric: 'units',
    metricValue: 10, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit];
  // Collections arriving in phase-local periods 2 and 3 only.
  const collections = [0, 0, 500, 500, 0, 0];
  const bd = computeAssetCost({
    asset, project, phase: PHASE1, parcels: PARCELS, assets: [asset], subUnits: subs,
    costLines: lines, costOverrides: [], landAllocationMode: 'sqm',
    collectionsPerPeriod: collections,
  });
  const mkt = lines.find((l) => base(l.id) === 'marketing')!;
  const win = bd.resolvedWindowByLineId[mkt.id];
  // Every line the engine charges reports a window. 2026-08-17c: that is every
  // seeded line again, because nothing is gated any more (the country gate was
  // retired: see verify-no-hidden-cost-lines).
  check('the fixture is non-vacuous', lines.length > 0, `${lines.length} lines`);
  check('the engine reports a window for every seeded line',
    lines.every((l) => bd.resolvedWindowByLineId[l.id] !== undefined),
    lines.filter((l) => bd.resolvedWindowByLineId[l.id] === undefined).map((l) => l.id).join(','));
  check('and none for a line that is not in this phase at all',
    Object.keys(bd.resolvedWindowByLineId).every((id) => lines.some((l) => l.id === id)),
    Object.keys(bd.resolvedWindowByLineId).filter((id) => !lines.some((l) => l.id === id)).join(','));
  check('marketing takes its window from collections', win?.startPeriod === 2 && win?.endPeriod === 3,
    `${win?.startPeriod}-${win?.endPeriod}`);
  check('and names the source', win?.source === 'collections', String(win?.source));
  check('which is NOT the window stored on the line', mkt.startPeriod !== 2 || mkt.endPeriod !== 3);

  // No collections: the follow degrades, and says so rather than showing a
  // construction window as though it were the answer.
  const bdNone = computeAssetCost({
    asset, project, phase: PHASE1, parcels: PARCELS, assets: [asset], subUnits: subs,
    costLines: lines, costOverrides: [], landAllocationMode: 'sqm',
  });
  check('with no collections the follow is degraded', bdNone.resolvedWindowByLineId[mkt.id]?.degraded === true);

  // A line on its own window reports itself.
  const cbua = lines.find((l) => base(l.id) === 'construction-bua')!;
  check('an own-window line reports its own window',
    bd.resolvedWindowByLineId[cbua.id]?.startPeriod === cbua.startPeriod
    && bd.resolvedWindowByLineId[cbua.id]?.endPeriod === cbua.endPeriod);

  check('the row renders the derived window instead of inputs',
    SRC_COSTS_UI.includes('windowIsDerived ? (') && SRC_COSTS_UI.includes('cost-${asset.id}-${line.id}-window-derived'));
  check('and says when the source is empty', SRC_COSTS_UI.includes('window-degraded'));
}

// ════════════════════════════════════════════════════════════════════════════
section('E. Stage is a per-line choice with one derivation');

{
  const line = makeBlankCostLines('phase_1', 4).find((l) => base(l.id) === 'construction-bua')!;
  check('a catalog line derives its catalog stage', deriveCostStage(line) === 'hard');
  check('an override wins', deriveCostStage({ ...line, stageOverride: 'marketing' }) === 'marketing');
  check('clearing it returns to the catalog', deriveCostStage({ ...line, stageOverride: undefined }) === 'hard');
  check('the override beats a stale stored stage',
    deriveCostStage({ ...line, stage: 'land', stageOverride: 'soft' }) === 'soft');
  check('and the id map still beats a stale stored stage',
    deriveCostStage({ ...line, stage: 'land' }) === 'hard');

  // pre-operating: the map and the seed agreed only after 2026-08-17.
  const preOp = makeBlankCostLines('phase_1', 4).find((l) => base(l.id) === 'pre-operating')!;
  check('pre-operating is soft in the seed', preOp.stage === 'soft');
  check('pre-operating is soft in the derivation', deriveCostStage(preOp) === 'soft');

  // The engine's stage rollup must follow the derivation, not the raw field.
  const project: Project = { ...makeDefaultProject(), startDate: '2026-01-01' };
  // The seed prices superstructure on Main Asset GFA since 2026-09-12, so the
  // fixture states one: 1,000 sqm, the same figure its sub-units carry.
  const asset = { ...mkAsset('a1', 'phase_1', { parcelId: 'parcel_1', sqm: 10000 }), derivedAreas: { mainAssetGfaSqm: 1000 } } as Asset;
  const subs: SubUnit[] = [{
    id: 's1', assetId: 'a1', name: 'Apts', category: 'Sellable', metric: 'units',
    metricValue: 10, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit];
  const withRate = makeBlankCostLines('phase_1', 4).map((l) => (
    base(l.id) === 'construction-bua' ? { ...l, value: 1000 } : l));
  const run = (ls: CostLine[]) => computeAssetCost({
    asset, project, phase: PHASE1, parcels: PARCELS, assets: [asset], subUnits: subs,
    costLines: ls, costOverrides: [], landAllocationMode: 'sqm',
  });
  const before = run(withRate);
  const after = run(withRate.map((l) => (base(l.id) === 'construction-bua' ? { ...l, stageOverride: 'marketing' as const } : l)));
  check('reclassifying moves the money between stage buckets',
    before.byStage.hard > 0 && after.byStage.hard === 0 && Math.abs(after.byStage.marketing - before.byStage.hard) < 1e-6,
    `hard ${before.byStage.hard} -> ${after.byStage.hard}, marketing ${after.byStage.marketing}`);
  check('and does not change the asset total', Math.abs(after.total - before.total) < 1e-6);
  check('the row renders a stage selector', SRC_COSTS_UI.includes('writeStage(e.target.value as CostStage)'));
  check('and clears the override when the catalog value is picked',
    SRC_COSTS_UI.includes('stageOverride: next === catalogStage ? undefined : next'));
}

// ════════════════════════════════════════════════════════════════════════════
section('F. Catalog order: developer fee, contingency, marketing last');

{
  const lines = makeBlankCostLines('phase_1', 4);
  const order = lines.map((l) => base(l.id));
  check('marketing is LAST', order[order.length - 1] === 'marketing', order.join(' > '));
  check('the developer fee exists', order.includes('developer-fee'));
  check('the developer fee sits above the contingency',
    order.indexOf('developer-fee') < order.indexOf('contingency'));
  check('the contingency sits above marketing', order.indexOf('contingency') < order.indexOf('marketing'));
  check('land leads', order[0] === 'land-cash' && order[1] === 'land-inkind');
  check('hard costs precede soft costs',
    Math.max(...lines.map((l, i) => (deriveCostStage(l) === 'hard' ? i : -1)))
    < Math.min(...lines.map((l, i) => (deriveCostStage(l) === 'soft' ? i : Number.MAX_SAFE_INTEGER))));
  check('every seeded id appears exactly once, and is a known catalog id',
    new Set(order).size === order.length
    && order.every((id) => (STANDARD_COST_LINE_IDS as readonly string[]).includes(id)),
    order.join(','));
  // 2026-08-17c: `rett` is still a known id (existing lines resolve their
  // identity through it and the picker offers it) but it is NOT seeded. A
  // country-gated row that was present and invisible is what allowed a cost to
  // be charged unseen, and later to be doubled. See verify-no-hidden-cost-lines.
  check('the transfer tax is a known id but is NOT seeded',
    (STANDARD_COST_LINE_IDS as readonly string[]).includes('rett') && !order.includes('rett'));

  // The cascade is expressible: every seeded selection points UPWARD.
  const visible = assetVisibleLines(lines, 'phase_1', 'a1');
  for (const l of lines) {
    const sel = l.selectedLineIds ?? [];
    if (sel.length === 0) continue;
    const allowed = new Set(eligibleBaseLines(visible, l.id).map((c) => c.id));
    const bad = sel.filter((id) => !allowed.has(id) && visible.some((v) => v.id === id));
    check(`${base(l.id)} charges only on lines above it`, bad.length === 0, bad.map(base).join(', '));
  }
  const fee = lines.find((l) => base(l.id) === 'developer-fee')!;
  check('the developer fee seeds at zero', fee.value === 0);
  // NOTE the exact ids: `landscaping` also starts with "land".
  const LAND_IDS = new Set(['land-cash', 'land-inkind', 'rett']);
  check('its base is the hard and soft lines, not land',
    (fee.selectedLineIds ?? []).every((id) => !LAND_IDS.has(base(id)))
    && (fee.selectedLineIds ?? []).includes('construction-bua__phase_1'),
    (fee.selectedLineIds ?? []).map(base).join(', '));
  const cont = lines.find((l) => base(l.id) === 'contingency')!;
  check('the contingency charges on the developer fee',
    (cont.selectedLineIds ?? []).some((id) => base(id) === 'developer-fee'));
  check('and marketing is in NOBODY\'s base, because it is last',
    lines.every((l) => !(l.selectedLineIds ?? []).some((id) => base(id) === 'marketing')));

  // The reference seed keeps its benchmark rates, and the new line is inert in
  // it, so no fixture-based total moves.
  const ref = makeDefaultCostLines('phase_1', 4, 'reference');
  check('the reference seed keeps its rates', ref.find((l) => base(l.id) === 'construction-bua')?.value === 4500);
  check('and the developer fee is inert there too', ref.find((l) => base(l.id) === 'developer-fee')?.value === 0);
}

// ════════════════════════════════════════════════════════════════════════════
section('G. Ordering: insert anywhere, move, and position governs the base');

{
  // The positional rule with a line inserted ABOVE an existing consumer.
  const lines = makeBlankCostLines('phase_1', 4);
  const contingency = lines.find((l) => base(l.id) === 'contingency')!;
  const custom: CostLine = {
    id: 'custom-1__phase_1', phaseId: 'phase_1', name: 'Site works', method: 'fixed', value: 100,
    stage: 'hard', scope: 'direct', allocationBasis: 'per_asset', startPeriod: 1, endPeriod: 4, phasing: 'even',
  };
  const idx = lines.indexOf(contingency);
  const above = [...lines.slice(0, idx), custom, ...lines.slice(idx)];
  const below = [...lines.slice(0, idx + 1), custom, ...lines.slice(idx + 1)];
  const eligibleAbove = eligibleBaseLines(assetVisibleLines(above, 'phase_1', 'a1'), contingency.id);
  const eligibleBelow = eligibleBaseLines(assetVisibleLines(below, 'phase_1', 'a1'), contingency.id);
  check('a line inserted ABOVE is offered to the consumer', eligibleAbove.some((l) => l.id === custom.id));
  check('a line inserted BELOW is not', !eligibleBelow.some((l) => l.id === custom.id));
  check('so position governs, not creation order', true);

  check('the store can insert near an anchor', SRC_STORE.includes('insertCostLineNear:'));
  check('and move within the phase', SRC_STORE.includes('moveCostLine:')
    && SRC_STORE.includes("s.costLines[nIdx].phaseId !== line.phaseId"));
  check('the row exposes both', SRC_COSTS_UI.includes('insert-above') && SRC_COSTS_UI.includes('move-up'));
  check('a move swaps with the row the user can see',
    /onMoveLine\(\s*line\.id,\s*direction,\s*\(direction === 'up' \? lines\[idx - 1\] : lines\[idx \+ 1\]\)\?\.id,?\s*\)/.test(SRC_COSTS_UI)
    || SRC_COSTS_UI.includes("(direction === 'up' ? lines[idx - 1] : lines[idx + 1])?.id"));
  check('a reference that has fallen below is named on the row', SRC_COSTS_UI.includes('base-dropped'));
  check('a custom line is created from ONE shared factory', SRC_COSTS_UI.includes('function makeCustomCostLine('));
  check('which takes this phase\'s construction length, not the longest',
    !SRC_COSTS_UI.includes('phases.reduce((m, p) => Math.max(m, p.constructionPeriods), 0)')
    || !/onAddCustom=\{\(\) => \{[\s\S]*maxCp/.test(SRC_COSTS_UI));
}

// ════════════════════════════════════════════════════════════════════════════
section('H. The percent-of-selected base is reported');

{
  const project: Project = { ...makeDefaultProject(), startDate: '2026-01-01' };
  const asset = { ...mkAsset('a1', 'phase_1', { parcelId: 'parcel_1', sqm: 10000 }), derivedAreas: { mainAssetGfaSqm: 1000 } } as Asset;
  const subs: SubUnit[] = [{
    id: 's1', assetId: 'a1', name: 'Apts', category: 'Sellable', metric: 'units',
    metricValue: 10, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit];
  const lines = makeBlankCostLines('phase_1', 4).map((l) => {
    if (base(l.id) === 'construction-bua') return { ...l, value: 1000 }; // 1000 x 1000 sqm Main Asset GFA
    if (base(l.id) === 'contingency') return { ...l, value: 10 };
    return l;
  });
  const bd = computeAssetCost({
    asset, project, phase: PHASE1, parcels: PARCELS, assets: [asset], subUnits: subs,
    costLines: lines, costOverrides: [], landAllocationMode: 'sqm',
  });
  const cont = lines.find((l) => base(l.id) === 'contingency')!;
  const reported = bd.selectedBaseByLineId[cont.id];
  check('the engine reports a base for a percent line', reported !== undefined);
  check('and the line total is exactly the rate on that base',
    Math.abs((bd.byLineId[cont.id] ?? 0) - reported * 0.10) < 1e-6,
    `total=${bd.byLineId[cont.id]} base=${reported}`);
  check('the base is not zero when the selection resolves', reported > 0, String(reported));
  check('the caption is handed the base', /selectedTotal: selectedBase/.test(SRC_COSTS_UI));
  check('and the picker shows it too', SRC_COSTS_UI.includes('pct-picker-base'));
}

// ════════════════════════════════════════════════════════════════════════════
section('I. Stale wizard windows are repaired, and nothing else is');

{
  const stale = (over: Partial<CostLine>): CostLine => ({
    id: 'construction-bua__phase_1', phaseId: 'phase_1', name: 'Construction (BUA)',
    method: 'rate_per_bua', value: 0, stage: 'hard', scope: 'direct', allocationBasis: 'bua_share',
    startPeriod: 1, endPeriod: 25, phasing: 'even', ...over,
  });
  const snapOf = (lines: CostLine[], cp = 4): HydrateSnapshot => ({
    project: makeDefaultProject(),
    phases: [{ ...PHASE1, constructionPeriods: cp }],
    parcels: [], assets: [], subUnits: [], costLines: lines, costOverrides: [],
    financingTranches: [], equityContributions: [], landAllocationMode: 'sqm',
  } as unknown as HydrateSnapshot);

  const repaired = repairStaleWizardCostWindows(snapOf([stale({})]));
  check('a stale 1-to-25 line is pulled back to the construction window',
    repaired.costLines[0].startPeriod === 1 && repaired.costLines[0].endPeriod === 4,
    `${repaired.costLines[0].startPeriod}-${repaired.costLines[0].endPeriod}`);
  check('and is marked as following it', repaired.costLines[0].windowFollowsConstruction === true);
  check('the repair is idempotent',
    JSON.stringify(repairStaleWizardCostWindows(repaired)) === JSON.stringify(repaired));

  const edited = repairStaleWizardCostWindows(snapOf([stale({ startPeriod: 2, endPeriod: 9 })]));
  check('a window the user has touched is left alone',
    edited.costLines[0].startPeriod === 2 && edited.costLines[0].endPeriod === 9
    && edited.costLines[0].windowFollowsConstruction === undefined);

  const cp24 = repairStaleWizardCostWindows(snapOf([stale({})], 24));
  check('a 24-period phase is left alone (stale and deliberate are the same numbers)',
    cp24.costLines[0].endPeriod === 25 && cp24.costLines[0].windowFollowsConstruction === undefined);

  const declared = repairStaleWizardCostWindows(snapOf([stale({ windowFollowsConstruction: false })]));
  check('a line that already declares ownership is left alone',
    declared.costLines[0].endPeriod === 25);

  const customLine = repairStaleWizardCostWindows(snapOf([stale({ id: 'custom-99__phase_1' })]));
  check('a custom line is left alone (no per-phase fingerprint)', customLine.costLines[0].endPeriod === 25);

  // THE CLAMPED SHAPE. A snapshot that has been opened and saved once since the
  // wizard wrote it no longer holds 25: Pass 8 Fix 5 clamps the end to the
  // project's maxCp + 1, and T3ClampStartEnd lifts an end that fell below its
  // start. Measured on the live project: 1-25 -> 1-5, 12-25 -> 12-12,
  // 18-25 -> 18-18 on a project whose longest phase is 4 periods.
  const twoPhase = (lines: CostLine[]): HydrateSnapshot => ({
    project: makeDefaultProject(),
    phases: [{ ...PHASE1, constructionPeriods: 4 }, { ...PHASE2, id: 'phase_2', constructionPeriods: 3 }],
    parcels: [], assets: [], subUnits: [], costLines: lines, costOverrides: [],
    financingTranches: [], equityContributions: [], landAllocationMode: 'sqm',
  } as unknown as HydrateSnapshot);
  const p2 = (id: string, s: number, e: number): CostLine => ({
    ...stale({}), id: `${id}__phase_2`, phaseId: 'phase_2', startPeriod: s, endPeriod: e,
  });
  const clamped = repairStaleWizardCostWindows(twoPhase([
    p2('construction-bua', 1, 5), p2('landscaping', 12, 12), p2('pre-operating', 18, 18),
    // Phase 1's own, deliberately set by the user to the construction window.
    { ...stale({}), startPeriod: 1, endPeriod: 4 },
  ]));
  check('a clamped 1-to-5 on a 3-period phase is repaired',
    clamped.costLines[0].startPeriod === 1 && clamped.costLines[0].endPeriod === 3,
    `${clamped.costLines[0].startPeriod}-${clamped.costLines[0].endPeriod}`);
  check('a clamped 12-to-12 is repaired',
    clamped.costLines[1].startPeriod === 1 && clamped.costLines[1].endPeriod === 3,
    `${clamped.costLines[1].startPeriod}-${clamped.costLines[1].endPeriod}`);
  check('a clamped 18-to-18 is repaired',
    clamped.costLines[2].startPeriod === 1 && clamped.costLines[2].endPeriod === 3,
    `${clamped.costLines[2].startPeriod}-${clamped.costLines[2].endPeriod}`);
  check('the other phase, already at its own construction window, is untouched',
    clamped.costLines[3].endPeriod === 4 && clamped.costLines[3].windowFollowsConstruction === undefined);

  const midStart = repairStaleWizardCostWindows(snapOf([stale({ id: 'landscaping__phase_1', startPeriod: 12, endPeriod: 25 })]));
  check('the mid-build starters are repaired on their own fingerprint',
    midStart.costLines[0].startPeriod === deriveCostWindow('landscaping', 4).startPeriod
    && midStart.costLines[0].endPeriod === 4,
    `${midStart.costLines[0].startPeriod}-${midStart.costLines[0].endPeriod}`);
  const landRow = repairStaleWizardCostWindows(snapOf([stale({ id: 'land-cash__phase_1', startPeriod: 0, endPeriod: 0 })]));
  check('the land rows are never touched',
    landRow.costLines[0].startPeriod === 0 && landRow.costLines[0].endPeriod === 0
    && landRow.costLines[0].windowFollowsConstruction === undefined);
}

// ════════════════════════════════════════════════════════════════════════════
section('K. Area x unit size = count: only two of the three are inputs');

{
  // Area, Unit Size and Count are one identity, so all three cannot be inputs.
  // Area and Unit Size are authoritative; Count is derived and read-only. The
  // one exception is the same rule: with no unit size there is nothing to
  // divide by, so the count becomes the input (the existing-operations case).
  check('the row computes whether the count is derived',
    /const countIsDerived = isUnits && unitArea > 0/.test(SRC_ASSETS_UI));
  check('a derived count renders as an output, not an input',
    /countIsDerived \? \(/.test(SRC_ASSETS_UI) && SRC_ASSETS_UI.includes("data-derived=\"true\""));
  check('and says so beside the unit label',
    SRC_ASSETS_UI.includes("countIsDerived ? ' (derived)' : ''"));
  check('the count is editable ONLY when there is no unit size to divide by',
    /countIsDerived \? \([\s\S]{0,1200}?\) : \([\s\S]{0,400}?onChange=\{\(n\) => onEditCount\(n\)\}/.test(SRC_ASSETS_UI));
  check('a snapped area is stated rather than silently rewritten',
    SRC_ASSETS_UI.includes('-area-snapped') && SRC_ASSETS_UI.includes('you entered'));

  // The identity itself, through the engine's own area function.
  const mk = (metricValue: number, unitArea: number): SubUnit => ({
    id: 's1', assetId: 'a1', name: 'Keys', category: 'Operable', metric: 'units',
    metricValue, unitArea, unitPrice: 0,
  } as unknown as SubUnit);
  check('area = count x unit size', computeSubUnitArea(mk(160, 83), undefined) === 13280);
  const typedArea = 13300;
  const size = 83;
  const derivedCount = Math.round(typedArea / size);
  check('a typed area derives the count', derivedCount === 160, String(derivedCount));
  check('and the area it resolves to is the snapped one, which the row states',
    computeSubUnitArea(mk(derivedCount, size), undefined) === 13280);
  check('a whole-number division does not snap at all',
    computeSubUnitArea(mk(Math.round(13280 / 83), 83), undefined) === 13280);

  // ── THE METRIC IS THE ASSET'S (2026-09-10, docs/TRAPS.md 7.32) ───────────
  //
  // `Asset.subUnitMetric` is an asset-level override that says how THIS
  // asset's parts are measured, and every surface has read it that way for
  // months. The ENGINE asked the ROW alone, so where a user switched an asset
  // from counting units to stating areas and the rows kept their old metric,
  // the two disagreed. On the live reference project one row did exactly that:
  // "2 BR", 10,098.23 sqm under an asset whose metric is 'area', read as a
  // COUNT of 10,098 units at 190 sqm each. 1.93m sqm of BUA and 10.3bn of cost
  // on one asset, while every screen showed the right area.
  const areaAsset = { id: 'a1', subUnitMetric: 'area' } as unknown as Asset;
  const unitsAsset = { id: 'a1', subUnitMetric: 'units' } as unknown as Asset;
  const noStatement = { id: 'a1' } as unknown as Asset;
  check('M1 the ASSET s metric wins over the row s, in the direction that bit',
    // Row says units, asset says area: 10,098.23 is an AREA, not a count.
    computeSubUnitArea(mk(10098.23, 190), areaAsset) === 10098.23
    // ... and the old answer, which is what the engine used to return.
    && Math.abs(computeSubUnitArea(mk(10098.23, 190), undefined) - 1918663.7) < 0.1,
    String(computeSubUnitArea(mk(10098.23, 190), areaAsset)));
  check('M2 and in the other direction too, so this is a rule and not a patch',
    // Row says units and so does the asset: still a count.
    computeSubUnitArea(mk(160, 83), unitsAsset) === 13280
    // An area row under an asset that counts is read as a count.
    && computeSubUnitArea({ ...mk(160, 83), metric: 'area' } as SubUnit, unitsAsset) === 13280);
  check('M3 an asset that states NOTHING leaves the row s own metric standing',
    computeSubUnitArea(mk(160, 83), noStatement) === 13280
    && computeSubUnitArea(mk(160, 83), undefined) === 13280
    && resolveSubUnitMetric(mk(160, 83), noStatement) === 'units');
  check('M4 legacy count is units, on either statement',
    resolveSubUnitMetric({ ...mk(1, 1), metric: 'count' } as unknown as SubUnit, undefined) === 'units'
    && resolveSubUnitMetric(mk(1, 1), { id: 'a', subUnitMetric: 'count' } as unknown as Asset) === 'units');
  // M5 THE RULE HAS ONE HOME. The platform's table rules kept a private copy
  // for one day, which is how the engine and the screen disagreed in the first
  // place; both read the core rule now.
  // ── P1 to P6. THE CHAIN'S QUANTITIES REACH A COST METHOD (2026-09-10) ────
  //
  // Two methods already existed and multiplied a field nothing wrote for a
  // host: `rate_per_parking_bay` reads `parkingBaysRequired`, which the asset
  // factory seeds at 0 and only a retail companion ever updates. Three more
  // quantities the chain derives had no method at all.
  const withDerived = (over: Record<string, unknown>, derived: Record<string, number>): Asset =>
    ({ id: 'a1', phaseId: 'p1', name: 'A', strategy: 'Sell', ...over, derivedAreas: derived } as unknown as Asset);
  check('P1 TYPED WINS on parking, and a SEEDED ZERO is not typed',
    // A typed area beats a derived one.
    resolveAssetParkingArea(withDerived({ parkingArea: 2800 }, { parkingAreaSqm: 3560 })) === 2800
    // A seeded 0 is not a decision: the factory writes it, so the derived
    // figure stands (the same rule the seeded landAllocation.sqm taught).
    && resolveAssetParkingArea(withDerived({ parkingArea: 0 }, { parkingAreaSqm: 3560 })) === 3560
    && resolveAssetParkingBays(withDerived({ parkingBaysRequired: 0 }, { parkingBays: 89 })) === 89
    && resolveAssetParkingBays(withDerived({ parkingBaysRequired: 12 }, { parkingBays: 89 })) === 12);
  check('P2 with nothing derived and nothing typed the answer is ZERO, never a guess',
    resolveAssetParkingArea({ id: 'a', phaseId: 'p' } as unknown as Asset) === 0
    && resolveAssetLandscapeArea({ id: 'a', phaseId: 'p' } as unknown as Asset) === 0
    && resolveAssetFootprintArea({ id: 'a', phaseId: 'p' } as unknown as Asset) === 0
    && resolveAssetNetDevelopableArea({ id: 'a', phaseId: 'p' } as unknown as Asset) === 0);
  check('P3 the three chain-only figures read the derived bag and have no typed counterpart',
    resolveAssetNetDevelopableArea(withDerived({}, { netDevelopableSqm: 10454.12 })) === 10454.12
    && resolveAssetFootprintArea(withDerived({}, { footprintSqm: 6272.47 })) === 6272.47
    && resolveAssetLandscapeArea(withDerived({}, { landscapeSqm: 4181.65 })) === 4181.65);
  // P4 A METHOD IS REGISTERED IN FIVE PLACES OR IT IS HALF ADDED. The union,
  // the picker order, the label map, the unit label and the two report
  // surfaces: miss one and the method exists and renders as a blank.
  const NEW_METHODS = ['rate_x_net_developable_area', 'rate_x_footprint_area', 'rate_x_landscape_area',
    'rate_x_main_asset_gfa', 'rate_x_retail_parking_area', 'rate_x_retail_gfa'];
  const typesSrc2 = fs.readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-types.ts', 'utf8');
  const costsSrc2 = fs.readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  const capexSrc2 = fs.readFileSync('src/hubs/modeling/platforms/refm/lib/reports/capexReports.ts', 'utf8');
  const engineSrc2 = fs.readFileSync('src/core/calculations/index.ts', 'utf8');
  check('P4 each new method is in the union, the order, the labels, the unit and BOTH report surfaces',
    NEW_METHODS.every((m) => (typesSrc2.match(new RegExp(m, 'g')) ?? []).length >= 3
      && costsSrc2.includes(m)
      && (capexSrc2.match(new RegExp(m, 'g')) ?? []).length === 2
      && engineSrc2.includes(`case '${m}':`)),
    NEW_METHODS.filter((m) => !engineSrc2.includes(`case '${m}':`)).join(',') || 'all registered');
  // P4b A PICKER OFFERS WHAT EXISTS, and all three pickers offer the SAME
  // thing. Each had its own inline filter and all three had drifted: two hid
  // `rate_per_parking_bay`, which was right while the field it multiplies was
  // seeded at 0 and written by nothing and wrong the moment the derived bag
  // gave it a quantity, and the per-asset row picker ignored the retired list
  // altogether. There is ONE rule now and the pickers call it.
  check('P4b the three cost-method pickers share ONE rule, so they cannot offer different sets',
    (costsSrc2.match(/selectableCostMethods\(/g) ?? []).length === 3
    && !costsSrc2.includes('COST_METHODS.filter')
    && !costsSrc2.includes("m !== 'rate_per_parking_bay'"));
  check('P4c every method that computes can be picked, the new three and the parking bay included',
    [...NEW_METHODS, 'rate_per_parking_bay', 'rate_x_parking_area']
      .every((m) => (selectableCostMethods() as readonly string[]).includes(m)));
  check('P4d a RETIRED method is offered only to a line already on it, never to a new one',
    !(selectableCostMethods() as readonly string[]).includes('rate_per_nda')
    && (selectableCostMethods('rate_per_nda') as readonly string[]).includes('rate_per_nda')
    // A select whose value is absent from its options renders as the FIRST
    // option and rewrites itself on the next change event. RE HUB carries two
    // rate_per_nda lines, so this is the difference between hiding a method
    // and silently converting a live cost line to Fixed Amount.
    && (selectableCostMethods('rate_per_nda') as readonly string[])[0] !== 'rate_per_nda');

  // P4e A CHAIN-ONLY METHOD SAYS WHY IT IS EMPTY. Landscape, footprint and net
  // developable area have NO typed counterpart: they reach the engine only
  // through the derived bag. Saying 'no landscape area defined yet' sends a
  // reader looking for a field that does not exist; the caption names the
  // switch instead, the way the retired roads method says why it charges
  // nothing.
  //
  // RE-AIMED 2026-09-11: this read the ENGINE SOURCE for `noDerived('...')`
  // call sites. The twelve quantity cases then moved behind one shared rule so
  // the caption and the pooled line figure could not name two different areas,
  // and the check failed on a refactor that changed no behaviour at all. It
  // runs the caption now, which is what a user reads.
  {
    const emptyMetrics = {
      landSqm: 0, ndaSqm: 0, roadsSqm: 0, nsa: 0, bua: 0, gfa: 0,
      unitCount: 0, parkingBays: 0, supportArea: 0, parkingArea: 0,
      netDevelopableArea: 0, footprintArea: 0, landscapeArea: 0,
      landValue: 0, cashLandValue: 0, inKindLandValue: 0, totalRevenue: 0,
    } as unknown as Parameters<typeof costLineCaption>[0]['metrics'];
    const emptyCap = (m: string): string => costLineCaption({
      line: { id: 'l', name: 'l', method: m, value: 1 } as unknown as Parameters<typeof costLineCaption>[0]['line'],
      asset: { id: 'a', phaseId: 'p' } as unknown as Parameters<typeof costLineCaption>[0]['asset'],
      metrics: emptyMetrics,
      parkingBays: 0,
      resolvedTotal: 0,
    });
    // Retail parking is NOT chain-only: a strip reads its stamped figure, so it
    // keeps the ordinary 'not defined yet' sentence and is tested by P4e-b.
    const CHAIN_ONLY = NEW_METHODS.filter((m) => m !== 'rate_x_retail_parking_area' && m !== 'rate_x_retail_gfa');
    check('P4e a chain-only method says the plot states no chain inputs, not a field that does not exist',
      CHAIN_ONLY.every((m) => emptyCap(m).includes('states no chain inputs'))
      && CHAIN_ONLY.every((m) => !emptyCap(m).includes('defined yet')),
      CHAIN_ONLY.map((m) => `${m}: ${emptyCap(m)}`).join(' | '));
    // And the ones that DO have a typed field keep the ordinary sentence.
    check('P4e-b a method with a real field still says the field is not defined yet',
      emptyCap('rate_per_land').includes('no Plot area defined yet'),
      emptyCap('rate_per_land'));
  }
  // P4f ONE VOCABULARY, AND IT PROVES ONLY THAT THE WORDS ARE THE TAB'S. Which
  // quantity each word belongs to is P4h's job, because this check passed on an
  // inverted pair: both tiers have a name in both vocabularies, so swapping two
  // labels leaves every name present and correctly spelled.
  // Picking a cost basis is choosing which column on the
  // assets tab this rate multiplies, so the picker names the quantity the tab
  // names. Seven did not, 'Sellable BUA' for the column headed NSA or GLA being
  // the worst of them.
  check('P4f the picker names the quantity the assets tab names',
    (() => {
      const tabSrc2 = fs.readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
      const PAIRS: [string, string][] = [
        ['rate_per_land', 'Plot Area (sqm)'],
        // THE OUTER TWO CROSS, and this table had them backwards for the hours
        // between the rename and its correction. The PAIRING is proven by the
        // arithmetic in P4h; this only checks that the words on the label are
        // words the tab actually heads a column with.
        ['rate_per_gfa', 'Total BUA (sqm)'],
        ['rate_per_bua', 'Total GFA (sqm)'],
        ['rate_per_nsa', 'NSA or GLA (sqm)'],
        ['rate_per_unit', 'Units or Keys'],
        ['rate_per_parking_bay', 'Parking Slots'],
        ['rate_x_net_developable_area', 'Net Developable Area (sqm)'],
        ['rate_x_footprint_area', 'Building Footprint (sqm)'],
        ['rate_x_landscape_area', 'Landscape and Open Area (sqm)'],
        ['rate_x_main_asset_gfa', 'Main Asset GFA (sqm)'],
        ['rate_x_retail_parking_area', 'Retail Parking Area (sqm)'],
        ['rate_x_retail_gfa', 'Retail GFA (sqm)'],
      ];
      return PAIRS.every(([m, col]) => {
        const bare = col.replace(' (sqm)', '');
        // the tab really does head a column with it, and the picker really
        // does name the quantity that way
        return tabSrc2.includes('>' + col + '<') && COST_METHOD_LABELS[m as CostMethod].endsWith(bare);
      });
    })(),
    'a method names a quantity the assets tab does not');
  // ASKED OF THE MAP, NOT THE FILE: this file's own docblock quotes the old
  // name to explain why it went, and a bare file scan read that sentence as
  // the thing it says is gone.
  check('P4g and the old third name for NSA is gone from every label',
    !Object.values(COST_METHOD_LABELS).some((l) => l.includes('Sellable BUA')));

  // ── P4h THE TIER ARITHMETIC, NOT THE TIER NAME (2026-09-11) ───────────
  //
  // Two labels shipped INVERTED on 2026-09-11 and passed P4f, which compared
  // the label to the assets tab's column headers. It could not catch it: both
  // quantities have a name in both vocabularies, and the two cross at the outer
  // tiers, so swapping them leaves every name still present and still spelled
  // correctly. A name check can only ever prove the words exist.
  //
  // So this runs the engine. One asset with three DIFFERENT numbers in it, so
  // no two tiers can be confused by coincidence, and each method is asked what
  // it actually multiplies:
  //
  //   nsa 1,000 + support 100 = bua 1,100          the tab's TOTAL GFA
  //   bua 1,100 + parking 250 = gfa 1,350          the tab's TOTAL BUA
  //
  // If the labels are ever swapped again, the method labelled with the tab's
  // Total GFA will return 1,350 here and this fails.
  {
    const tierMetrics = {
      landSqm: 0, ndaSqm: 0, roadsSqm: 0,
      nsa: 1000, bua: 1100, gfa: 1350,
      unitCount: 0, parkingBays: 0,
      supportArea: 100, parkingArea: 250,
      netDevelopableArea: 0, footprintArea: 0, landscapeArea: 0,
      landValue: 0, cashLandValue: 0, inKindLandValue: 0, totalRevenue: 0,
    } as unknown as Parameters<typeof calculateItemTotal>[1]['metrics'];
    const at = (method: string): number => calculateItemTotal(
      { id: 'l', name: 'l', method, value: 1 } as unknown as Parameters<typeof calculateItemTotal>[0],
      { asset: { id: 'a', phaseId: 'p' } as never, metrics: tierMetrics, resolvedDirectLineTotals: {} },
    );
    check('P4h the tiers are arithmetic: NSA is the sub-units, +support, +parking',
      at('rate_per_nsa') === 1000 && at('rate_per_bua') === 1100 && at('rate_per_gfa') === 1350,
      `nsa=${at('rate_per_nsa')} bua=${at('rate_per_bua')} gfa=${at('rate_per_gfa')}`);
    // THE LABEL IS TIED TO THE SUM, which is the half P4f cannot do. The method
    // the picker calls "Total GFA" must charge the floor area WITHOUT parking,
    // and the one it calls "Total BUA" must charge the outermost tier.
    const labelled = (tab: string): string | undefined =>
      (Object.keys(COST_METHOD_LABELS) as CostMethod[])
        .find((m) => COST_METHOD_LABELS[m] === `Rate ${String.fromCharCode(215)} ${tab}`);
    const totalGfaMethod = labelled('Total GFA');
    const totalBuaMethod = labelled('Total BUA');
    check('P4h-b exactly one method is labelled with each outer tier',
      totalGfaMethod !== undefined && totalBuaMethod !== undefined && totalGfaMethod !== totalBuaMethod,
      `${totalGfaMethod} / ${totalBuaMethod}`);
    check('P4h-c the method labelled TOTAL GFA charges NSA + support, parking EXCLUDED',
      totalGfaMethod !== undefined && at(totalGfaMethod) === 1100,
      `${totalGfaMethod} charges ${totalGfaMethod ? at(totalGfaMethod) : '-'}, expected 1100`);
    check('P4h-d the method labelled TOTAL BUA charges NSA + support + parking',
      totalBuaMethod !== undefined && at(totalBuaMethod) === 1350,
      `${totalBuaMethod} charges ${totalBuaMethod ? at(totalBuaMethod) : '-'}, expected 1350`);
    // AND THE TOOLTIP SAYS THE SUM. A label can be re-pointed; a tooltip that
    // spells out "NSA + Support + Parking" is what makes the next rename safe.
    check('P4h-e each outer tier states its arithmetic in the tooltip, not just a name',
      (COST_METHOD_BASIS_HELP[totalGfaMethod as CostMethod] ?? '').includes('NSA + Support, parking EXCLUDED')
      && (COST_METHOD_BASIS_HELP[totalBuaMethod as CostMethod] ?? '').includes('NSA + Support + Parking'));
  }

  // ── P4i THE CAPTION CHARGES WHAT IT SAYS, AND THE LINE FIGURE SUMS ────
  //
  // P4h pinned the PICKER's labels to the arithmetic. The Costs screen's row
  // CAPTION was a fourth surface naming the same two tiers and 06aded4c did not
  // reach it, so on 2026-09-11 the picker said "Rate x Total BUA" while the
  // caption one cell to its right said "Total GFA" about the same method and the
  // same number. Measured on the live projects: 16 captions, both directions,
  // every figure unchanged and only the WORD wrong.
  //
  // So the caption now reads the quantity from ONE shared rule,
  // `costLineBasisQuantity`, and this asks that rule and the caption itself what
  // they multiply rather than what they are called.
  {
    const tiers = {
      landSqm: 0, ndaSqm: 0, roadsSqm: 0,
      nsa: 1000, bua: 1100, gfa: 1350,
      unitCount: 0, parkingBays: 0,
      supportArea: 100, parkingArea: 250,
      netDevelopableArea: 0, footprintArea: 0, landscapeArea: 0,
      landValue: 0, cashLandValue: 0, inKindLandValue: 0, totalRevenue: 0,
    } as unknown as Parameters<typeof costLineBasisQuantity>[1];
    const qty = (m: string): { value: number; unit: string } | null =>
      costLineBasisQuantity(m as CostMethod, tiers, { parkingBays: 0 });
    check('P4i the shared quantity rule returns the SUM, not a name',
      qty('rate_per_nsa')?.value === 1000 && qty('rate_per_bua')?.value === 1100 && qty('rate_per_gfa')?.value === 1350,
      `nsa=${qty('rate_per_nsa')?.value} bua=${qty('rate_per_bua')?.value} gfa=${qty('rate_per_gfa')?.value}`);
    check('P4i-b the tier NAMED Total GFA is the one WITHOUT parking, and Total BUA the one with',
      qty('rate_per_bua')?.unit === 'sqm Total GFA' && qty('rate_per_gfa')?.unit === 'sqm Total BUA',
      `bua->${qty('rate_per_bua')?.unit} gfa->${qty('rate_per_gfa')?.unit}`);
    // AND THE CAPTION A USER READS, not just the helper behind it.
    const cap = (m: string): string => costLineCaption({
      line: { id: 'l', name: 'l', method: m, value: 1 } as unknown as Parameters<typeof costLineCaption>[0]['line'],
      asset: { id: 'a', phaseId: 'p' } as unknown as Parameters<typeof costLineCaption>[0]['asset'],
      metrics: tiers as unknown as Parameters<typeof costLineCaption>[0]['metrics'],
      parkingBays: 0,
      resolvedTotal: 0,
    });
    check('P4i-c the caption prints the tier it actually multiplies',
      cap('rate_per_gfa').includes('1,350') && cap('rate_per_gfa').includes('Total BUA')
      && cap('rate_per_bua').includes('1,100') && cap('rate_per_bua').includes('Total GFA'),
      `${cap('rate_per_gfa')} || ${cap('rate_per_bua')}`);
    // THE POOLED LINE FIGURE IS A PLAIN SUM AND CARRIES NO RATE. Two plots on
    // one consolidation line can hold different per-asset overrides, so a pooled
    // rate x quantity would name an amount the engine never charged.
    const half = { ...tiers, nsa: 400, bua: 440, gfa: 540, supportArea: 40, parkingArea: 100 } as typeof tiers;
    const pooledGfa = (tiers as { gfa: number }).gfa + (half as { gfa: number }).gfa;
    check('P4i-d the line figure is the plots summed, with no rate in it',
      qty('rate_per_gfa')?.value !== undefined
      && costLineBasisQuantity('rate_per_gfa' as CostMethod, { ...tiers, gfa: pooledGfa } as typeof tiers, { parkingBays: 0 })?.value === 1890
      && Object.keys(costLineBasisQuantity('rate_per_gfa' as CostMethod, tiers, { parkingBays: 0 }) ?? {}).every((k) => k !== 'rate' && k !== 'amount'),
      `pooled=${pooledGfa}`);
  }

  // ── P4j THE PICKER FOLLOWS TABLE 4 (2026-09-12) ──────────────────────
  //
  // Picking a basis is choosing a column on the assets tab, so the picker
  // offers the area methods in the order the tab lists its columns. Read from
  // the tab's own header row, so a column added or moved there moves this.
  {
    const tabSrc3 = fs.readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
    const rs = tabSrc3.indexOf('function AssetResultsTable(');
    const re = tabSrc3.indexOf('function MergedLineTable(');
    const results = rs >= 0 && re > rs ? tabSrc3.slice(rs, re) : '';
    const headers = [...results.matchAll(/<th style=\{TH_N\}[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].replace(' (sqm)', '').trim());
    const colIndex = (m: CostMethod): number => headers.indexOf(COST_METHOD_LABELS[m].replace(/^Rate \u00d7 /, ''));
    const offered = selectableCostMethods().filter((m) => colIndex(m) >= 0);
    const seq = offered.map(colIndex);
    check('P4j every area method the picker offers is in the order the assets tab lists its columns',
      headers.length >= 20 && offered.length >= 13 && seq.every((v, i) => i === 0 || v >= seq[i - 1]),
      offered.map((m) => `${COST_METHOD_LABELS[m]}@${colIndex(m)}`).join(' > '));
    check('P4j-b the lump sum leads and the percentages close',
      selectableCostMethods()[0] === 'fixed'
      && selectableCostMethods().slice(-8).every((m) => m.startsWith('percent_')));
  }

  // ── P4k A STRIP IS PRICED ON ITS RETAIL GFA, A HOST ON ITS MAIN GFA ───
  //
  // The reference prices a host's superstructure on Main Asset GFA and the
  // retail strip on Retail GFA at its own rate, so the two methods are
  // MIRRORS across a host and its strip, like the two parking methods: each
  // reads its own figure on one side and 0 on the other, so no square metre
  // is priced twice and none is priced by nothing. Run against the engine.
  {
    const strip = {
      id: 's', phaseId: 'p', isCompanion: true, companionType: 'retail', strategy: 'Lease', visible: true,
      buaSqm: 1825.69, sellableBuaSqm: 1825.69, parkingArea: 2920, parkingBaysRequired: 73, landAllocation: {},
    } as unknown as Asset;
    const host = {
      id: 'h', phaseId: 'p', visible: true, landAllocation: {},
      derivedAreas: { totalGfaSqm: 25279.1, retailGfaSqm: 1254.49, mainAssetGfaSqm: 19006.63, parkingAreaSqm: 3560, retailParkingAreaSqm: 2000 },
    } as unknown as Asset;
    const project = makeDefaultProject();
    const mOf = (a: Asset) => resolveAssetAreaMetrics(a, project, [], [strip, host], [], 'sqm');
    const ms = mOf(strip), mh = mOf(host);
    check('P4k the strip\'s Retail GFA is its own floor area and a host\'s is 0',
      Math.abs(ms.retailGfa - 1825.69) < 1e-9 && mh.retailGfa === 0, `strip ${ms.retailGfa} host ${mh.retailGfa}`);
    check('P4k-b Main Asset GFA is the chain\'s on a host and 0 on the strip; parking mirrors the same way',
      Math.abs(mh.mainAssetGfa - 19006.63) < 1e-9 && ms.mainAssetGfa === 0
      && mh.parkingArea === 3560 && ms.parkingArea === 0
      && mh.retailParkingArea === 0 && ms.retailParkingArea === 2920,
      `host main ${mh.mainAssetGfa} strip main ${ms.mainAssetGfa}`);
    const at = (a: Asset, m: string, v: number): number => calculateItemTotal(
      { id: 'l', name: 'l', method: m, value: v } as unknown as Parameters<typeof calculateItemTotal>[0],
      { asset: a, metrics: mOf(a), resolvedDirectLineTotals: {} });
    check('P4k-c Rate x Retail GFA charges the strip and nothing on the host; Rate x Main Asset GFA the reverse',
      Math.abs(at(strip, 'rate_x_retail_gfa', 2200) - 1825.69 * 2200) < 1e-6 && at(host, 'rate_x_retail_gfa', 2200) === 0
      && Math.abs(at(host, 'rate_x_main_asset_gfa', 11000) - 19006.63 * 11000) < 1e-6 && at(strip, 'rate_x_main_asset_gfa', 11000) === 0);
    const capOf = (a: Asset, m: string): string => costLineCaption({
      line: { id: 'l', name: 'l', method: m, value: 1 } as unknown as Parameters<typeof costLineCaption>[0]['line'],
      asset: a, metrics: mOf(a), parkingBays: 0, resolvedTotal: 0,
    });
    check('P4k-d a strip on Main Asset GFA is told its floor area is Retail GFA, never sent to a plot row it does not have',
      capOf(strip, 'rate_x_main_asset_gfa').includes('0 on a retail strip')
      && capOf(strip, 'rate_x_main_asset_gfa').includes('Rate \u00d7 Retail GFA')
      && !capOf(strip, 'rate_x_main_asset_gfa').includes('states no chain inputs'),
      capOf(strip, 'rate_x_main_asset_gfa'));
    check('P4k-e a host on Retail GFA is told the strip carries it, and a plot with no chain keeps the chain sentence',
      capOf(host, 'rate_x_retail_gfa').includes('charged on the retail strip, 0 on a host')
      && capOf({ id: 'x', phaseId: 'p', landAllocation: {} } as unknown as Asset, 'rate_x_main_asset_gfa').includes('states no chain inputs'),
      capOf(host, 'rate_x_retail_gfa'));
    // THE CAPTION ON A STRIP CHARGES WHAT IT SAYS. The typed-parking fallback
    // made it print the strip's retail parking beside an engine charging 0.
    check('P4k-f a strip on Rate x Parking Area is told its parking is retail parking, and the quantity is the engine\'s 0',
      capOf(strip, 'rate_x_parking_area').includes('reads 0 on a retail strip')
      && capOf(strip, 'rate_x_parking_area').includes('Rate \u00d7 Retail Parking Area')
      && costLineBasisQuantity('rate_x_parking_area' as CostMethod, mOf(strip), { parkingBays: 0 })?.value === 0
      && at(strip, 'rate_x_parking_area', 1) === 0,
      capOf(strip, 'rate_x_parking_area'));
    // A NEW STRIP GETS ITS OWN BASES, an existing override is never touched.
    const lines = [
      { id: 'construction-bua__p', phaseId: 'p', value: 4200, phasing: 'even' },
      { id: 'construction-parking__p', phaseId: 'p', value: 3000, phasing: 'even' },
      { id: 'construction-bua__q', phaseId: 'q', value: 5800, phasing: 'even' },
    ];
    const seeded = planRetailCompanionOverrides([{ id: 's', phaseId: 'p' }], lines, []);
    check('P4k-g a new strip is put on Rate x Retail GFA and Rate x Retail Parking Area at its own phase\'s line rates',
      seeded.length === 2
      && seeded.some((o) => o.lineId === 'construction-bua__p' && o.method === 'rate_x_retail_gfa' && o.value === 4200 && o.overridden === true)
      && seeded.some((o) => o.lineId === 'construction-parking__p' && o.method === 'rate_x_retail_parking_area' && o.value === 3000),
      JSON.stringify(seeded));
    check('P4k-h an override that already exists is left alone, and a phase with no such line seeds nothing',
      planRetailCompanionOverrides([{ id: 's', phaseId: 'p' }], lines, [{ assetId: 's', lineId: 'construction-bua__p' }]).length === 1
      && planRetailCompanionOverrides([{ id: 's', phaseId: 'q' }], lines, []).length === 1
      && planRetailCompanionOverrides([{ id: 's', phaseId: 'z' }], lines, []).length === 0);
    const storeSrc2 = fs.readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
    check('P4k-i the store seeds them for the companions it ADDED and only those',
      storeSrc2.includes('planRetailCompanionOverrides(')
      && /r\.added\.length > 0/.test(storeSrc2)
      && /r\.assets\.filter\(\(a\) => r\.added\.includes\(a\.id\)\)/.test(storeSrc2));
    // THE SEED IS ON THE REFERENCE BASES, RATES BLANK, NO RETIRED METHOD.
    const seedLines = makeBlankCostLines('p', 12);
    const methodOf = (base: string): string => String(seedLines.find((l) => l.id === `${base}__p`)?.method);
    check('P4k-j a new phase seeds superstructure on Main Asset GFA, parking and landscape on their areas, infrastructure on plot area',
      methodOf('construction-bua') === 'rate_x_main_asset_gfa'
      && methodOf('construction-parking') === 'rate_x_parking_area'
      && methodOf('landscaping') === 'rate_x_landscape_area'
      && methodOf('infrastructure') === 'rate_per_land',
      ['construction-bua', 'construction-parking', 'landscaping', 'infrastructure'].map((b) => `${b}=${methodOf(b)}`).join(' '));
    check('P4k-k no seeded line is on a retired method, and every unlocked seeded rate is blank',
      seedLines.every((l) => (selectableCostMethods() as readonly string[]).includes(String(l.method)))
      && seedLines.filter((l) => l.isLocked !== true).every((l) => l.value === 0));
    // DERIVED WINS, ABSENT FALLS BACK, for Main Asset GFA too: a plot the chain
    // never ran on (typed areas, sub-units, no land planning) is priced on its
    // Total GFA, the reference's own rule with zero retail, not on nothing.
    const typedOnly = { id: 't', phaseId: 'p', visible: true, landAllocation: {}, buaSqm: 1300 } as unknown as Asset;
    check('P4k-l a plot with no chain inputs reads Main Asset GFA = its Total GFA; one with a chain reads what the chain derived',
      mOf(typedOnly).mainAssetGfa === 1300 && mOf(typedOnly).bua === 1300
      && Math.abs(mOf(host).mainAssetGfa - 19006.63) < 1e-9 && Math.abs(mOf(host).bua - (25279.1 - 1254.49)) < 1e-6,
      `typed ${mOf(typedOnly).mainAssetGfa} host ${mOf(host).mainAssetGfa}`);
    // A STRIP'S ROW WRITES ITS OWN OVERRIDE, NEVER THE PHASE LINE. Method,
    // rate, phasing and the on/off toggle all take the strip branch, and it is
    // seeded from the master exactly as the Override button seeds.
    check('P4k-m the strip branch is in every row writer, seeded from the master',
      costsSrc2.includes('const stripOwn = isRetailCompanion(asset);')
      && (costsSrc2.match(/\} else if \(stripOwn\) \{\s*onUpdateOverride\(\{ \.\.\.masterAsOverride\(\), (method|value|phasing|disabled) \}\);/g) ?? []).length === 4
      && costsSrc2.includes('const startOverride = (): void => { onUpdateOverride(masterAsOverride()); };'));

    // ── P4n THE REFERENCE BASES ARE APPLIED ON LOAD AND SAVE ───────────
    //
    // A phase line on a strip-only basis prices every host at 0, a strip on
    // a host basis prices the strip at 0, and Total GFA on the superstructure
    // line is not the reference basis. The pass moves exactly those, seeds a
    // strip with no override, leaves every other choice alone, and settles.
    const bases = {
      assets: [
        { id: 'h1', phaseId: 'p' }, { id: 'h2', phaseId: 'p' },
        { id: 'st', phaseId: 'p', isCompanion: true, companionType: 'retail' },
        { id: 'h3', phaseId: 'q' },
      ],
      costLines: [
        { id: 'construction-bua__p', phaseId: 'p', method: 'rate_x_retail_gfa', value: 4200, phasing: 'even' },
        { id: 'construction-parking__p', phaseId: 'p', method: 'rate_x_retail_parking_area', value: 3000, phasing: 'even' },
        { id: 'construction-bua__q', phaseId: 'q', method: 'rate_per_bua', value: 5800, phasing: 'even' },
        { id: 'construction-parking__q', phaseId: 'q', method: 'rate_per_nsa', value: 25000, phasing: 'even' },
        { id: 'custom-1__p', phaseId: 'p', method: 'rate_x_retail_gfa', value: 1, phasing: 'even' },
      ],
      costOverrides: [
        { assetId: 'st', lineId: 'construction-bua__p', method: 'rate_x_main_asset_gfa' },
        { assetId: 'h1', lineId: 'construction-parking__p', method: 'rate_x_retail_parking_area' },
        { assetId: 'h2', lineId: 'construction-bua__p', method: 'rate_per_nsa' },
      ],
    };
    const r1 = applyReferenceCostBases(bases);
    const lineM = (id: string): string => String(r1.state.costLines.find((l) => l.id === id)?.method);
    const ovM = (a: string, id: string): string | undefined => r1.state.costOverrides.find((o) => o.assetId === a && o.lineId === id)?.method;
    check('P4n a phase line on a strip basis goes back to the host basis, and Total GFA on superstructure goes to Main Asset GFA',
      lineM('construction-bua__p') === 'rate_x_main_asset_gfa' && lineM('construction-parking__p') === 'rate_x_parking_area'
      && lineM('construction-bua__q') === 'rate_x_main_asset_gfa',
      r1.moves.map((m) => `${m.kind}:${m.lineId}:${m.from ?? ''}>${m.to}`).join(' '));
    check('P4n-b a parking line on slots, NSA or a lump sum is the user\'s choice and a custom line is never touched',
      lineM('construction-parking__q') === 'rate_per_nsa' && lineM('custom-1__p') === 'rate_x_retail_gfa');
    check('P4n-c a strip override on a host basis moves to the strip basis, a host override on a strip basis moves back, any other override stays',
      ovM('st', 'construction-bua__p') === 'rate_x_retail_gfa'
      && ovM('h1', 'construction-parking__p') === 'rate_x_parking_area'
      && ovM('h2', 'construction-bua__p') === 'rate_per_nsa');
    check('P4n-d a strip with no override on a line that exists is seeded at the line\'s rate',
      ovM('st', 'construction-parking__p') === 'rate_x_retail_parking_area'
      && (r1.state.costOverrides.find((o) => o.assetId === 'st' && o.lineId === 'construction-parking__p') as { value?: number } | undefined)?.value === 3000);
    const r2 = applyReferenceCostBases(r1.state);
    check('P4n-e the pass SETTLES: a second run returns the input object with no moves',
      r2.state === r1.state && r2.changed === false && r2.moves.length === 0);
    check('P4n-f the store runs it on load AND on save, after the integrity pass and the bridge',
      (storeSrc2.match(/applyReferenceCostBases\(/g) ?? []).length === 2
      && storeSrc2.indexOf('applyReferenceCostBases(bridgedModel)') > storeSrc2.indexOf('repairProjectIntegrity(merged)')
      && storeSrc2.indexOf('applyReferenceCostBases(bridgedLiveModel)') > storeSrc2.indexOf('repairProjectIntegrity(pickModel('));
    // ONE CURVE PER PHASE: the phasing curve patch reaches every visible
    // asset of the phase; every other asset patch stays on the line's plots.
    check('P4o the phasing curve is written to every visible asset of the phase, and only that patch',
      /'capexPhasing' in patch\s*\? allVisibleAssets\.filter\(\(a\) => a\.phaseId === activeAsset\.phaseId\)\s*: lineMembers/.test(costsSrc2)
      && costsSrc2.includes('One phasing curve for every asset in this phase'));

    // ── P4p LAND CASH AND IN-KIND PER PHASE, ONE SERIES FOR TWO TABS ─────
    //
    // The financing engine carries the land split per phase now, on the
    // project axis. Results Table 5 shows it, Financing section 4 reads it,
    // and the phases must SUM to the project-wide series the year-on-year
    // financing tables already consume, or the two tabs would drift apart.
    {
      const ref = buildExcelSampleState() as unknown as Parameters<typeof computeFinancialsSnapshot>[0];
      const fin = (computeFinancialsSnapshot(ref) as unknown as { financing: { capex: { perPeriod: { landCash: number[]; landInKind: number[] }; landByPhase?: Array<{ phaseId: string; landCash: number[]; landInKind: number[]; landCashTotal: number; landInKindTotal: number }> } } }).financing.capex;
      const byPhase = fin.landByPhase ?? [];
      const sumAt = (k: 'landCash' | 'landInKind', i: number): number => byPhase.reduce((t, p) => t + (p[k][i] ?? 0), 0);
      const N = fin.perPeriod.landCash.length;
      const cashTies = Array.from({ length: N }, (_, i) => Math.abs(sumAt('landCash', i) - fin.perPeriod.landCash[i]) < 1e-6).every(Boolean);
      const inKindTies = Array.from({ length: N }, (_, i) => Math.abs(sumAt('landInKind', i) - fin.perPeriod.landInKind[i]) < 1e-6).every(Boolean);
      check('P4p the per-phase land series sum to the project-wide landCash and landInKind, period by period',
        byPhase.length >= 1 && cashTies && inKindTies, `phases ${byPhase.length}`);
      check('P4p-b each phase\'s totals are its own series summed, and the reference fixture carries land',
        byPhase.every((p) => Math.abs(p.landCashTotal - p.landCash.reduce((a, b) => a + b, 0)) < 1e-6
          && Math.abs(p.landInKindTotal - p.landInKind.reduce((a, b) => a + b, 0)) < 1e-6)
        && byPhase.reduce((t, p) => t + p.landCashTotal + p.landInKindTotal, 0) > 0);
      check('P4p-c Results Table 5 reads the two halves off the SAME series as tables 2 to 4',
        costsSrc2.includes("mode === 'landCash' ? Math.max(0, landAll - landInKind)")
        && costsSrc2.includes("mode === 'landInKind' ? landInKind")
        && costsSrc2.includes('Table 5 - Land: Cash and In-Kind')
        && costsSrc2.includes('{renderLandTable()}'));
      const finSrc = fs.readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Financing.tsx', 'utf8');
      check('P4p-d Financing section 4 reads the engine\'s per-phase land and never computes plot x rate for itself',
        finSrc.includes('4. Land Funding (per phase, from the Capex results)')
        && finSrc.includes('result.capex.landByPhase')
        && !finSrc.includes('const cashValue = p.area * p.rate')
        && !finSrc.includes('const inKindValue = p.area * p.rate'));
      check('P4p-e the debt and equity split is written to every parcel of the phase',
        /phaseParcels\.forEach\(\(p\) => setParcelFundingPatch\(p\.id, patch\)\)/.test(finSrc));
      check('P4p-f the Results picker offers merged LINES through the one planner, labelled as table 4 labels them',
        costsSrc2.includes('const resultLines = planCapexSummaryLines(')
        && costsSrc2.includes("resultLines.find((ln) => ln.assetIds.includes(stored))")
        && (() => {
          // THE RESULTS SELECT ITSELF, not the whole file: another picker on
          // this tab lists assets by name and is meant to.
          const at = costsSrc2.indexOf('data-testid="costs-results-single-asset-select"');
          const body = at >= 0 ? costsSrc2.slice(at, costsSrc2.indexOf('</select>', at)) : '';
          return body.includes('{lineOptionLabel(ln)}') && !body.includes('{a.name}');
        })());

    // ── P4r LAND VALUE IS THE TWO STANDARD LINES, NOT THE LAND STAGE ────
    //
    // RETT sits in the land stage (the user's classification, and right for
    // the stage tiles), but it is a tax on the land, not the land's value:
    // the assets tab states 240,000,000 where Table 5 showed 246,787,500.
    {
      const project = { ...makeDefaultProject(), startDate: '2026-01-01' };
      const asset = mkAsset('a1', 'phase_1', { parcelId: 'parcel_1', sqm: 10000 });
      const rett = { id: 'custom-9__phase_1', phaseId: 'phase_1', name: 'RETT', catalogId: 'rett', method: 'percent_of_cash_land', value: 5, stage: 'land', scope: 'indirect', allocationBasis: 'land_share', startPeriod: 1, endPeriod: 1, phasing: 'even' } as unknown as CostLine;
      const lines = [...makeBlankCostLines('phase_1', 4), rett];
      const bd = computeAssetCost({ asset, project, phase: PHASE1, parcels: PARCELS, assets: [asset], subUnits: [], costLines: lines, costOverrides: [], landAllocationMode: 'sqm' });
      const landValue = (bd.byLineId['land-cash__phase_1'] ?? 0) + (bd.byLineId['land-inkind__phase_1'] ?? 0);
      const rettAmt = bd.byLineId['custom-9__phase_1'] ?? 0;
      const landSeries = bd.perPeriodLandTotal.reduce((a, b) => a + b, 0);
      check('P4r the land series is the two land lines alone; RETT is in the land STAGE but not in the land VALUE',
        rettAmt > 0 && Math.abs(landSeries - landValue) < 1e-6 && Math.abs(bd.byStage.land - (landValue + rettAmt)) < 1e-6,
        `land value ${landValue} series ${landSeries} rett ${rettAmt} stage ${bd.byStage.land}`);
      check('P4r-b identity, not method or stage: the standard ids and a catalog stamp count, a RETT line does not',
        isLandValueLine({ id: 'land-cash__p' }) && isLandValueLine({ id: 'land-inkind__p' })
        && isLandValueLine({ id: 'custom-1__p', catalogId: 'land-cash' })
        && !isLandValueLine({ id: 'custom-1__p', catalogId: 'rett' }) && !isLandValueLine({ id: 'infrastructure__p' }));
    }

    // ── P4q TABLE 1 IS PER LINE, AND THE CATEGORY SUMMARY FOOTS ─────────
    //
    // The inputs are per merged line, so Table 1 is too: one block per line,
    // each cost line ONE row with its plots' schedules added, no plot
    // nesting. And a summary by Residential / Hospitality / Retail that foots
    // to the incl-land and excl-land totals. Report and screen alike.
    {
      const refState = buildExcelSampleState() as unknown as Parameters<typeof computeFinancialsSnapshot>[0];
      const refSnap = computeFinancialsSnapshot(refState);
      const rep = buildCapexReport(refSnap, refState as never);
      const t1 = rep.results.find((t) => t.title.startsWith('Capex Schedule by Period'));
      const sumRow = (vals: number[]): number => vals.reduce((a, b) => a + b, 0);
      check('P4q report Table 1 has no plot rows: sections are lines, rows are cost lines, nothing nests deeper than one',
        t1 !== undefined && t1.title.endsWith('(per cost line, by line)')
        && t1.rows.every((r) => (r.indent ?? 0) <= 1)
        && !t1.rows.some((r) => r.isSection && (r.indent ?? 0) > 0));
      check('P4q-b every line subtotal equals its cost-line rows summed',
        (() => {
          if (!t1) return false;
          let ok = true; let blockSum = 0; let seenRows = 0;
          for (const r of t1.rows) {
            if (r.isSection) { blockSum = 0; seenRows = 0; continue; }
            if (r.isSubtotal) { ok = ok && seenRows > 0 && Math.abs(blockSum - sumRow(r.values)) < 1e-6; continue; }
            if (r.isTotal) continue;
            blockSum += sumRow(r.values); seenRows += 1;
          }
          return ok;
        })());
      const cat = rep.results.find((t) => t.title === 'Capex by Category (incl. all land)');
      const catX = rep.results.find((t) => t.title === 'Capex by Category (excl. total land)');
      const incl = rep.results.find((t) => t.title === 'Total Capex (incl. all land)');
      const excl = rep.results.find((t) => t.title === 'Capex excl. Total Land (pure development cost)');
      const catSum = (t?: { rows: { values: number[]; isTotal?: boolean }[] }): number => (t?.rows ?? []).filter((r) => !r.isTotal).reduce((a, r) => a + sumRow(r.values), 0);
      const totalOf = (t?: { rows: { values: number[]; isTotal?: boolean }[] }): number => sumRow(t?.rows.find((r) => r.isTotal)?.values ?? []);
      check('P4q-c the category tables foot to the incl-land and excl-land totals',
        cat !== undefined && catX !== undefined && catSum(cat) > 0
        && Math.abs(catSum(cat) - totalOf(incl)) < 1e-6 && Math.abs(catSum(catX) - totalOf(excl)) < 1e-6,
        `incl ${catSum(cat)} vs ${totalOf(incl)}; excl ${catSum(catX)} vs ${totalOf(excl)}`);
      const proj = { assetTypes: [{ id: 'my-hotel', label: 'My Hotel', category: 'Hospitality' }, { id: 'odd', label: 'Odd Thing', category: 'Parking' }] };
      check('P4q-d a category resolves from the strip, the project type list, then the built-in lists, else Other',
        assetCapexCategory({ type: 'Branded Villas', isCompanion: true, companionType: 'retail' }, proj) === 'Retail'
        && assetCapexCategory({ type: 'My Hotel' }, proj) === 'Hospitality'
        && assetCapexCategory({ type: 'Branded Villas' }, proj) === 'Residential'
        && assetCapexCategory({ type: '4 Star Hotel' }, proj) === 'Hospitality'
        && assetCapexCategory({ type: 'Standalone Commercial' }, proj) === 'Retail'
        && assetCapexCategory({ type: 'Hotel 5-star' }, proj) === 'Hospitality'
        && assetCapexCategory({ type: 'Branded Residences' }, proj) === 'Residential'
        && assetCapexCategory({ type: 'Strip Retail' }, proj) === 'Retail'
        && assetCapexCategory({ type: 'Odd Thing' }, proj) === 'Other'
        && assetCapexCategory({}, proj) === 'Other');
      check('P4q-e the screen renders Table 1 per line and Table 6 by category, from the same series',
        !costsSrc2.includes('const renderAsset = (')
        && costsSrc2.includes('const lineSeries = (lineId: string, members: Asset[])')
        && costsSrc2.includes('data-testid={' + String.fromCharCode(96) + 'capex-period-line-' + '$' + '{ln.key}-' + '$' + '{line.id}' + String.fromCharCode(96) + '}')
        && costsSrc2.includes('Table 6 - Capex by Category')
        && costsSrc2.includes('categoryOf={(a) => assetCapexCategory(a, project)}'));
    }
    }
  }

  // P5 THE RETIRED METHOD STAYS RETIRED. Re-pointing rate_per_nda at the
  // chain's utilised land would change what every stored line means without
  // anybody editing it, which is why the new method is a NEW one.
  check('P5 rate_per_nda is still retired and still multiplies GROSS land',
    typesSrc2.includes("RETIRED_COST_METHODS: readonly CostMethod[] = ['rate_per_nda', 'rate_per_roads']")
    && !typesSrc2.includes("'rate_per_nda', 'rate_per_roads', 'rate_x_net_developable_area'")
    && engineSrc2.includes("case 'rate_per_nda':")
    && engineSrc2.includes('return safeV * m.ndaSqm;'));
  // P6 THE PLATFORM NEVER WRITES A USER FIELD. The derived figures live in
  // their own bag, so "typed wins" is a read rule and clearing is safe.
  const modelSrc = fs.readFileSync('src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel.ts', 'utf8');
  const storeSrc2 = fs.readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('P6 the derived figures go in their OWN bag, never into parkingArea or parkingBaysRequired',
    modelSrc.includes('parkingAreaSqm?: number;')
    // [sS] was a typo for the any-character class and matched nothing, so this
    // term was always true; it says what it meant now.
    && !/derivedAreas[\s\S]{0,400}parkingArea:/.test(storeSrc2)
    // The applier lives in the shared model since 2026-09-12 (load, save and
    // the tab apply one rule) and the store calls it; the bag is still its own.
    && modelSrc.includes('return { ...a, derivedAreas: areas };')
    // The SYNC ACTION itself goes through the applier: load and save also call
    // it, so a bare includes() stayed true when the sync wrote a user field.
    && /syncDerivedAreas: \(plan\) => set\(\(s\) => \{\s*const r = applyDerivedAreasPlan\(s\.assets, plan\);/.test(storeSrc2)
    // And it can be cleared, which a written-over user field could not be.
    && modelSrc.includes('const { derivedAreas: _drop, ...rest } = a;'));
  check('M5 the table rules read the CORE rule rather than a copy of it',
    fs.readFileSync('src/hubs/modeling/platforms/refm/components/modules/_shared/assetTableModel.ts', 'utf8')
      .includes('return resolveSubUnitMetric(u as unknown as SubUnitForMetric, asset);'));
}

// ════════════════════════════════════════════════════════════════════════════
section('L. Area mode has a unit size too, and its count is derived');

// The identity was only enforceable in Units mode: in Area mode the Unit Size
// and Count cells were inert dashes, so on an Area-metric asset there was no
// way to enter a size and no way to get a count at all. Three of the four
// sub-units on the live project are Area-metric.
{
  // The dash survives in exactly ONE place: the companion row, which mirrors
  // its parent and is read-only by design. Anywhere else it would mean the
  // editable row still refuses a unit size.
  check('Area mode renders a unit size INPUT, not a dash', (() => {
    const editable = SRC_ASSETS_UI.slice(SRC_ASSETS_UI.indexOf('const countIsDerived'));
    return /data-testid=\{`subunit-\$\{subUnit\.id\}-unitArea`\}/.test(editable)
      && !editable.includes('-unitArea-hidden')
      && (SRC_ASSETS_UI.match(/-unitArea-hidden/g) ?? []).length === 1;
  })());
  check('it writes unitArea and nothing else',
    /onChange=\{\(n\) => onUpdate\(\{ unitArea: Math\.max\(0, n\) \}\)\}/.test(SRC_ASSETS_UI));
  check('the Area-mode count is derived and read-only',
    /data-derived="true"[\s\S]{0,400}fmt\(Math\.round\(rawCount\)\)/.test(SRC_ASSETS_UI));
  check('with no unit size it says there is nothing to divide by',
    /Enter a unit size to derive the/.test(SRC_ASSETS_UI));

  // THE SAFETY PROOF: in Area mode the stored quantity is the area, so a unit
  // size must move NO number. Run the engine over a full model both ways.
  const areaSub = (unitArea?: number): SubUnit => ({
    id: 'su_area', assetId: 'a1', name: 'Retail', category: 'Sellable', metric: 'area',
    metricValue: 4000, unitPrice: 12000, ...(unitArea === undefined ? {} : { unitArea }),
  } as unknown as SubUnit);
  check('the sub-unit area ignores a unit size in Area mode',
    computeSubUnitArea(areaSub(200), undefined) === computeSubUnitArea(areaSub(undefined), undefined)
    && computeSubUnitArea(areaSub(200), undefined) === 4000);

  const areaAsset = mkAsset('a1', 'phase_1', { parcelId: 'parcel_1', sqm: 4000 });
  const runWith = (u: SubUnit): string => JSON.stringify(computeAssetCost({
    asset: areaAsset, project: { ...makeDefaultProject(), startDate: '2026-01-01' }, phase: PHASE1, parcels: PARCELS,
    assets: [areaAsset], subUnits: [u], costLines: makeBlankCostLines('phase_1', 4).map((l) => (
      l.id.startsWith('construction-bua') ? { ...l, value: 4500 } : l
    )),
    costOverrides: [], landAllocationMode: 'autoByBua',
  }));
  check('and the whole cost breakdown is byte-identical with a unit size set',
    runWith(areaSub(200)) === runWith(areaSub(undefined)));
  check('the fixture is non-vacuous (the model is not empty)',
    JSON.parse(runWith(areaSub(200))).total > 0);
}

// ════════════════════════════════════════════════════════════════════════════
section('J. Tab order: the help icon is not a tab stop');

{
  check('the help trigger is removed from the tab order', /tabIndex=\{-1\}/.test(SRC_LABEL_UI));
  check('and keeps its text reachable as a title', /title=\{help\}/.test(SRC_LABEL_UI));
  check('it is still a real button', /<button\s/.test(SRC_LABEL_UI) && SRC_LABEL_UI.includes('aria-label={`Help:'));
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log(`verify-capex-structure: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
