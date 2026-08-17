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
  computeAssetCost, computeAssetLandBreakdown, computeSubUnitArea, deriveCostStage, landRateIssueText,
} from '../src/core/calculations';
import { eligibleBaseLines, assetVisibleLines } from '../src/core/calculations/selectedBase';
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
  const asset = mkAsset('a1', 'phase_1', { parcelId: 'parcel_1', sqm: 10000 });
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
  const asset = mkAsset('a1', 'phase_1', { parcelId: 'parcel_1', sqm: 10000 });
  const subs: SubUnit[] = [{
    id: 's1', assetId: 'a1', name: 'Apts', category: 'Sellable', metric: 'units',
    metricValue: 10, unitArea: 100, unitPrice: 1_000_000,
  } as unknown as SubUnit];
  const lines = makeBlankCostLines('phase_1', 4).map((l) => {
    if (base(l.id) === 'construction-bua') return { ...l, value: 1000 }; // 1000 x 1000 sqm BUA
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
  check('area = count x unit size', computeSubUnitArea(mk(160, 83)) === 13280);
  const typedArea = 13300;
  const size = 83;
  const derivedCount = Math.round(typedArea / size);
  check('a typed area derives the count', derivedCount === 160, String(derivedCount));
  check('and the area it resolves to is the snapped one, which the row states',
    computeSubUnitArea(mk(derivedCount, size)) === 13280);
  check('a whole-number division does not snap at all',
    computeSubUnitArea(mk(Math.round(13280 / 83), 83)) === 13280);
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
    computeSubUnitArea(areaSub(200)) === computeSubUnitArea(areaSub(undefined))
    && computeSubUnitArea(areaSub(200)) === 4000);

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
