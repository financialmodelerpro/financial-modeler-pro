/**
 * verify-type-cost-standards.ts (2026-09-14)
 *
 * The asset type and the cost standards as defaults:
 *   W  the massing write-back: a plot edit reaches its type when every plot of
 *      the type states the same figure, and never otherwise
 *   L  the lists: the shipped rows follow the reference model's two lists, and
 *      a project that carried per-type rates keeps them
 *   P  precedence: the user's override, then a rate stated on the phase line,
 *      then the row's phase rate, then the most specific row
 *   M  lines: an unpriced phase takes the whole list, a priced phase only rows
 *      a user added or edited, and an added row creates its line
 *   G  the store, Module 6 and the screens
 *
 * Offline: the store and the pure functions, no database.
 */
import { readFileSync } from 'node:fs';
import { createModule1Store, type HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import {
  makeBlankCostLines, DEFAULT_PHASE_ID, type Asset, type CostLine, type CostOverride,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { planTypeMassingWriteBack, resolveChainDefaults } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import {
  seedCostStandardRows, settleStandardCostOverrides, settleLineRateStated, newCustomRow,
  constructionRowsForView, pickStandardRate, costStandardBasisLabel, derivedSelection, settleLineSelectionStated, standardTypeIdFor, type CostStandardRow,
} from '../src/hubs/modeling/platforms/refm/lib/state/costStandards';
import { inactiveLeverReason, nonEconomicLeverReason } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

const P = DEFAULT_PHASE_ID;
const asset = (id: string, typeId: string | undefined, extra: Partial<Asset> = {}): Asset => ({
  id, phaseId: P, name: id, type: typeId ?? '', strategy: 'Sell', visible: true, assetTypeId: typeId, ...extra,
} as unknown as Asset);
const BUA = `construction-bua__${P}`;
const PARK = `construction-parking__${P}`;
const LAND = `landscaping__${P}`;

// ── W. massing write-back ───────────────────────────────────────────────────
section('W. massing fills back to the type when every plot agrees');
{
  const store = createModule1Store();
  const s = store.getState();
  s.addAsset(asset('a1', 'apt'));
  s.addAsset(asset('a2', 'apt'));
  s.updateAsset('a1', { landChain: { utilisationPct: 80, coveragePct: 50 } });
  check('W1 one plot stated, the other blank: the type is not written',
    store.getState().project.assetTypeValues?.apt?.utilisationPct === undefined);
  s.updateAsset('a2', { landChain: { utilisationPct: 80, coveragePct: 45 } });
  const tv = store.getState().project.assetTypeValues?.apt;
  check('W2 both plots state 80% utilisation: the type reads 80', tv?.utilisationPct === 80, JSON.stringify(tv));
  check('W3 coverage differs: the type is not written', tv?.coveragePct === undefined, JSON.stringify(tv));
  s.updateAsset('a2', { landChain: { utilisationPct: 70, coveragePct: 50 } });
  const tv2 = store.getState().project.assetTypeValues?.apt;
  check('W4 plots now disagree on utilisation: the type keeps its last agreed figure', tv2?.utilisationPct === 80, JSON.stringify(tv2));
  check('W5 coverage now agrees at 50: the type reads 50', tv2?.coveragePct === 50, JSON.stringify(tv2));
  const pure = planTypeMassingWriteBack(
    [asset('b1', 't', { landChain: { farRatio: 2 } }), asset('b2', 't', { landChain: { farRatio: 2 } })],
    { t: { farRatio: 3 } }, { overwrite: false },
  );
  check('W6 load and save never overwrite a figure typed on the type', !pure.changed && pure.values.t.farRatio === 3);
  const inherits = resolveChainDefaults({}, { utilisationPct: 85 });
  check('W7 a blank plot inherits the type utilisation, and says so', inherits.utilisationPct === 85 && inherits.sources.utilisationPct === 'asset_type');
}

// ── fixture ─────────────────────────────────────────────────────────────────
const TYPES = [
  { id: 'branded-villas', label: 'Branded Villas' },
  { id: 'high-end-apartments', label: 'High End Apartments' },
  { id: '4-star-hotel', label: '4 Star Hotel' },
  { id: 'retail-ground-floor', label: 'Retail Ground Floor' },
] as unknown as Parameters<typeof seedCostStandardRows>[0];
const villa = asset('v1', 'branded-villas');
const apt = asset('ap1', 'high-end-apartments');
const hotel = asset('h1', '4-star-hotel', { strategy: 'Operate' } as Partial<Asset>);
const strip = asset('s1', undefined, { isCompanion: true, companionType: 'retail', strategy: 'Lease' } as Partial<Asset>);
const ASSETS = [villa, apt, hotel, strip];
const unpriced = (): CostLine[] => settleLineRateStated(makeBlankCostLines(P)).costLines;
const stripSeed = (lines: CostLine[]): CostOverride[] => {
  const bua = lines.find((l) => l.id === BUA)!;
  return [{ assetId: 's1', lineId: BUA, method: 'rate_x_retail_gfa' as CostOverride['method'], value: bua.value, phasing: bua.phasing, overridden: true }];
};
const run = (rows: CostStandardRow[], lines: CostLine[], overrides?: CostOverride[]) => settleStandardCostOverrides({
  assets: ASSETS, costLines: lines, costOverrides: overrides ?? stripSeed(lines),
  project: { costStandardRows: rows, assetTypes: TYPES }, phases: [{ id: P, constructionPeriods: 3 }],
});
const ov = (r: ReturnType<typeof run>, a: string, l: string): CostOverride | undefined =>
  r.state.costOverrides.find((o) => o.assetId === a && o.lineId === l);

// ── L. the lists ────────────────────────────────────────────────────────────
section('L. the shipped lists follow the reference model');
const ROWS = seedCostStandardRows(TYPES, undefined);
{
  const construction = ROWS.filter((r) => r.list === 'construction').map((r) => `${r.label}=${r.rate ?? ''}`);
  check('L1 construction list: ten types, then parking, landscape and villas landscape, with the reference figures',
    construction.join('|') === 'Branded Villas=11000|High End Apartments=4500|Branded Apartments High=9000|Branded Apartments Mid=|Apartments=3000|Residential=|Resort 5 Star=14000|4 Star Hotel=|Standalone Commercial=3000|Retail (Ground Floor)=2200|Parking=2800|Landscape=800|Villas Landscape=1200',
    construction.join('|'));
  const soft = ROWS.filter((r) => r.list === 'soft').map((r) => `${r.label}=${r.rate}`);
  check('L2 soft list: seven percentages with the reference figures',
    soft.join('|') === 'Engineering Supervision=3.5|Design Consultancy=3|Permits and Approvals=0.05|Developer Fee=10|Contingency=5|RETT=5|Marketing=3.5', soft.join('|'));
  check('L3 the ground-floor retail type row keys to the project type id', ROWS.some((r) => r.assetTypeId === 'retail-ground-floor' && r.rate === 2200),
    ROWS.filter((r) => r.assetTypeId).map((r) => r.assetTypeId).join(','));
  check('L4 villas landscape applies to the villa types only', JSON.stringify(ROWS.find((r) => r.id === 'cat:landscaping:villas')?.appliesToTypeIds) === JSON.stringify(['branded-villas']));
  check('L5 no seeded row is linked, so seeding never adds a line to a priced phase', ROWS.every((r) => r.linked !== true));
  const migrated = seedCostStandardRows(TYPES, { 'branded-villas': { costRates: { 'construction-bua': 9999, landscaping: 50 } } });
  check('L6 a project that carried per-type rates keeps them: the type row and a row scoped to that type',
    migrated.find((r) => r.assetTypeId === 'branded-villas')?.rate === 9999
    && migrated.some((r) => r.catalogId === 'landscaping' && r.rate === 50 && JSON.stringify(r.appliesToTypeIds) === '["branded-villas"]'));
  const view = constructionRowsForView(ROWS, [...TYPES, { id: 'townhouses', label: 'Townhouses' }] as typeof TYPES);
  check('L7 a project type the list does not hold shows as a blank type row before the other rows',
    view.findIndex((r) => r.assetTypeId === 'townhouses') < view.findIndex((r) => r.id === 'cat:construction-parking')
    && view.find((r) => r.assetTypeId === 'townhouses')?.stored === false);
}

// ── P. precedence ───────────────────────────────────────────────────────────
section('P. precedence: override, phase line, phase rate, most specific row');
{
  const r = run(ROWS, unpriced());
  check('P1 each type takes its own superstructure default', ov(r, 'v1', BUA)?.value === 11000 && ov(r, 'ap1', BUA)?.value === 4500);
  check('P2 a blank type row applies nothing', ov(r, 'h1', BUA) === undefined);
  check('P3 the retail strip prices as the ground-floor retail type, on its own basis',
    ov(r, 's1', BUA)?.value === 2200 && ov(r, 's1', BUA)?.method === 'rate_x_retail_gfa', JSON.stringify(ov(r, 's1', BUA)));
  check('P4 villas landscape beats landscape for villas; everyone else takes landscape',
    ov(r, 'v1', LAND)?.value === 1200 && ov(r, 'ap1', LAND)?.value === 800 && ov(r, 'h1', LAND)?.value === 800);
  check('P5 parking is one project figure', [villa, apt, hotel].every((a) => ov(r, a.id, PARK)?.value === 2800));
  check('P6 marketing reaches the assets that sell and not the hotel',
    ov(r, 'v1', `marketing__${P}`)?.value === 3.5 && ov(r, 'h1', `marketing__${P}`) === undefined);
  check('P7 the pick order is type row, then scoped, then all',
    pickStandardRate(ROWS, 'branded-villas', 'landscaping', P)?.rate === 1200 && pickStandardRate(ROWS, 'apartments-x', 'landscaping', P)?.rate === 800);

  const withPhase = ROWS.map((row) => (row.assetTypeId === 'branded-villas' ? { ...row, byPhase: { [P]: 12500 } } : row));
  check('P8 a phase rate on a row wins over its own rate in that phase', ov(run(withPhase, unpriced()), 'v1', BUA)?.value === 12500);

  const stated = unpriced().map((l) => (l.id === BUA ? { ...l, value: 4200, rateStated: true } : l));
  const rs = run(withPhase, stated);
  check('P9 a rate stated on the phase line wins: no default reaches that line', ov(rs, 'v1', BUA) === undefined && ov(rs, 'ap1', BUA) === undefined);
  check('P10 the strip keeps its seed at the stated line rate', ov(rs, 's1', BUA)?.value === 4200 && ov(rs, 's1', BUA)?.origin === undefined);
  check('P11 the other blank lines of that phase still take their defaults', ov(rs, 'v1', LAND)?.value === 1200);

  const own: CostOverride = { assetId: 'ap1', lineId: BUA, method: 'rate_x_main_asset_gfa' as CostOverride['method'], value: 7777, phasing: 'even', overridden: true };
  const ro = run(ROWS, unpriced(), [...stripSeed(unpriced()), own]);
  check('P12 a user override is left exactly as typed', ov(ro, 'ap1', BUA)?.value === 7777 && ov(ro, 'ap1', BUA)?.origin === undefined);
  const again = settleStandardCostOverrides(r.state);
  check('P13 settles: running again on its own output moves nothing', !again.changed && again.state === r.state);
}

// ── M. lines ────────────────────────────────────────────────────────────────
section('M. which rows create Capex lines');
{
  const r = run(ROWS, unpriced());
  const ids = r.state.costLines.map((l) => l.id);
  check('M1 an unpriced phase takes the whole list: engineering, design, permits and the transfer tax get lines',
    ['engineering-supervision', 'design-consultancy', 'permits-approvals', 'rett'].every((c) => ids.includes(`${c}__${P}`)), ids.join(','));
  const permits = r.state.costLines.find((l) => l.id === `permits-approvals__${P}`);
  check('M2 a created line takes the row basis (permits as a percentage) and states no rate of its own',
    permits?.method === 'percent_of_selected' && permits?.value === 0 && permits?.rateStated === false, JSON.stringify(permits));
  check('M3 the created engineering line carries the list default on each asset', ov(r, 'v1', `engineering-supervision__${P}`)?.value === 3.5);

  const created = ['engineering-supervision', 'design-consultancy', 'permits-approvals'].map((c) => `${c}__${P}`);
  const devFee = r.state.costLines.find((l) => l.id === `developer-fee__${P}`);
  const contingency = r.state.costLines.find((l) => l.id === `contingency__${P}`);
  check('M3b developer fee and contingency charge the soft lines the list created',
    created.every((id) => devFee?.selectedLineIds?.includes(id) && contingency?.selectedLineIds?.includes(id)),
    JSON.stringify({ dev: devFee?.selectedLineIds, cont: contingency?.selectedLineIds }));
  const engineering = r.state.costLines.find((l) => l.id === `engineering-supervision__${P}`);
  check('M3c a created soft line charges the construction lines above it, landscape included',
    ['construction-bua', 'construction-parking', 'landscaping'].every((b) => engineering?.selectedLineIds?.includes(`${b}__${P}`)));
  const priced = unpriced().map((l) => (l.id === BUA ? { ...l, value: 4200, rateStated: true } : l));
  const rp = run(ROWS, priced);
  check('M4 a priced phase gets no line from a row nobody touched', !rp.state.costLines.some((l) => l.id.startsWith('engineering-supervision')));
  const edited = ROWS.map((row) => (row.id === 'cat:engineering-supervision' ? { ...row, linked: true } : row));
  check('M5 a row a user edited creates its line in a priced phase too', run(edited, priced).state.costLines.some((l) => l.id === `engineering-supervision__${P}`));
  const facade = newCustomRow('construction', 'Facade', 'rate_x_main_asset_gfa');
  const rc = run([...ROWS, facade], priced);
  check('M6 a row a user adds creates its Capex line at once, even before a rate', rc.state.costLines.some((l) => l.id === `facade__${P}` && l.stage === 'hard'));
  const rc2 = run([...ROWS, { ...facade, rate: 500 }], priced);
  check('M7 and with a rate every asset takes it', [villa, apt, hotel].every((a) => ov(rc2, a.id, `facade__${P}`)?.value === 500));
  const legal = newCustomRow('soft', 'Legal fees', 'percent_of_selected');
  const rl = run([...ROWS, { ...legal, rate: 1 }], priced);
  const legalLine = rl.state.costLines.find((l) => l.id === `legal-fees__${P}`);
  check('M8 an added soft row creates a soft line that charges the construction lines above it',
    legalLine?.stage === 'soft' && (legalLine?.selectedLineIds ?? []).includes(BUA), JSON.stringify(legalLine));
  const marker = settleLineRateStated([{ ...makeBlankCostLines(P)[2], value: 0 }, { ...makeBlankCostLines(P)[3], value: 250 }]);
  check('M9 on load a zero line states no rate and a non-zero line does', marker.costLines[0].rateStated === false && marker.costLines[1].rateStated === true);
  check('M10 the marker settles', !settleLineRateStated(marker.costLines).changed);
}

// ── G. store, Module 6, screens ─────────────────────────────────────────────
section('G. the store, Module 6 and the screens');
{
  const store = createModule1Store();
  const s = store.getState();
  s.addAsset(asset('e1', 'villa'));
  s.updateCostLine(BUA, { value: 0 });
  check('G1 typing a rate on the line states it, a typed 0 included', store.getState().costLines.find((l) => l.id === BUA)?.rateStated === true);
  s.updateCostLine(BUA, { value: 0, rateStated: false });
  check('G2 "use the default" clears it', store.getState().costLines.find((l) => l.id === BUA)?.rateStated === false);
  {
    // A strip's seed follows its line, so clearing the line hands the strip its default.
    const st = createModule1Store();
    st.getState().addAsset(asset('h2', 'villa'));
    st.getState().addAsset(asset('st2', undefined, { isCompanion: true, companionType: 'retail', strategy: 'Lease' } as Partial<Asset>));
    st.getState().setProject({ assetTypes: [{ id: 'villa', label: 'Villa' }, { id: 'retail-ground-floor', label: 'Retail Ground Floor' }] } as never);
    st.getState().updateCostLine(BUA, { value: 5800 });
    st.getState().setCostOverride({ assetId: 'st2', lineId: BUA, method: 'rate_x_retail_gfa' as CostOverride['method'], value: 5800, phasing: 'even', overridden: true });
    st.getState().setCostStandardRows([{ id: 'type:retail-ground-floor', list: 'construction', label: 'Retail (Ground Floor)', catalogId: 'construction-bua', method: 'rate_x_main_asset_gfa', assetTypeId: 'retail-ground-floor', rate: 2200 }]);
    const stripOv = (): CostOverride | undefined => st.getState().costOverrides.find((o) => o.assetId === 'st2' && o.lineId === BUA);
    check('G2b while the line states 5,800 the strip keeps its seed at 5,800', stripOv()?.value === 5800 && stripOv()?.origin === undefined);
    st.getState().updateCostLine(BUA, { value: 0, rateStated: false });
    check('G2c clearing the line hands the strip the ground-floor default on its own basis',
      stripOv()?.value === 2200 && stripOv()?.origin === 'standard' && stripOv()?.method === 'rate_x_retail_gfa', JSON.stringify(stripOv()));
  }
  s.setCostStandardRows([{ id: 'type:villa', list: 'construction', label: 'Villa', catalogId: 'construction-bua', method: 'rate_x_main_asset_gfa', assetTypeId: 'villa', rate: 6000, linked: true }]);
  check('G3 editing the lists settles the Capex defaults at once',
    store.getState().costOverrides.some((o) => o.assetId === 'e1' && o.lineId === BUA && o.value === 6000 && o.origin === 'standard'));
  const saved = store.getState().extractPersistSnapshot() as unknown as HydrateSnapshot & { project: { costStandardRows?: unknown[] } };
  check('G4 a saved snapshot carries the lists', Array.isArray(saved.project.costStandardRows));
  const fresh = createModule1Store();
  fresh.getState().hydrate({ ...saved, project: { ...saved.project, costStandardRows: undefined } } as unknown as HydrateSnapshot);
  check('G5 a project with no lists is seeded on load', (fresh.getState().project.costStandardRows ?? []).length === 20, String((fresh.getState().project.costStandardRows ?? []).length));
  const emptied = createModule1Store();
  emptied.getState().hydrate({ ...saved, project: { ...saved.project, costStandardRows: [] } } as unknown as HydrateSnapshot);
  check('G6 an emptied list is a decision and is never reseeded', (emptied.getState().project.costStandardRows ?? []).length === 0);

  const model = createModule1Store().getState().extractPersistSnapshot() as unknown as HydrateSnapshot;
  const why = inactiveLeverReason('project.costStandardRows[id=type:branded-villas].rate', model);
  check('G7 a cost standard is shown inactive in Module 6, naming the Capex line as the dial', !!why && /capex line/.test(why), String(why));
  check('G8 the line marker and the row structure are not scenario levers',
    nonEconomicLeverReason('costLines[id=x].rateStated', 'rateStated') !== null
    && nonEconomicLeverReason('project.costStandardRows[id=x].label', 'label') !== null);

  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('G9 the tab shows two lists, no per-type columns', tab.includes('std-construction-table') && tab.includes('std-soft-table') && !tab.includes('std-cost-col-'));
  check('G10 both lists take added rows and phase rates', tab.includes('std-cost-add-${list}') && tab.includes('-phase-${ph.id}-rate'));
  const capex = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  check('G11 Capex names the default and offers the way back to it',
    capex.includes('From Types and Standards') && capex.includes('-use-standard') && capex.includes('rateStated: false'));
  const storeSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('G12 load and save both seed the lists, mark the lines and settle',
    (storeSrc.match(/seedCostStandardRows\(/g) ?? []).length >= 2 && (storeSrc.match(/settleLineRateStated\(/g) ?? []).length >= 2
    && (storeSrc.match(/settleStandardCostOverrides\(/g) ?? []).length >= 3);
}

// ── R. reset to standards, the basis label, the headers ─────────────────────
section('R. reset to Types and Standards, the basis label and the headers');
{
  const st = createModule1Store();
  const g = st.getState;
  g().setProject({ assetTypes: [{ id: 'branded-villas', label: 'Branded Villas' }] } as never);
  g().addAsset(asset('r1', 'branded-villas'));
  g().setCostStandardRows(seedCostStandardRows([{ id: 'branded-villas', label: 'Branded Villas' }] as never, undefined));
  g().updateCostLine(BUA, { value: 4200 });
  g().setCostOverride({ assetId: 'r1', lineId: PARK, method: 'rate_x_parking_area' as CostOverride['method'], value: 999, phasing: 'even', overridden: true });
  g().addCostLine({ ...makeBlankCostLines(P)[3], id: `custom-x__${P}`, name: 'Custom', value: 50, rateStated: true });
  const beforeLines = g().costLines;
  const beforeOverrides = g().costOverrides;
  g().resetCapexToStandards([P]);
  const lines = g().costLines;
  const find = (a: string, l: string): CostOverride | undefined => g().costOverrides.find((o) => o.assetId === a && o.lineId === l);
  check('R1 the phase is rebuilt: the added line is gone and the superstructure line states no rate',
    !lines.some((l) => l.id === `custom-x__${P}`) && lines.find((l) => l.id === BUA)?.rateStated === false && lines.find((l) => l.id === BUA)?.value === 0);
  check('R2 the land lines stay', lines.filter((l) => l.phaseId === P && l.isLocked).length === beforeLines.filter((l) => l.phaseId === P && l.isLocked).length);
  check('R3 the per-asset override is gone and the default takes its place', find('r1', PARK)?.value === 2800 && find('r1', PARK)?.origin === 'standard');
  check('R4 the type default reaches the superstructure line', find('r1', BUA)?.value === 11000);
  check('R5 the whole standard list is in Capex, as a new project gets it',
    ['engineering-supervision', 'design-consultancy', 'permits-approvals', 'rett'].every((c) => lines.some((l) => l.id === `${c}__${P}`)));
  g().setCapexState(beforeLines, beforeOverrides);
  check('R6 undo puts the lines and overrides back exactly',
    JSON.stringify(g().costLines) === JSON.stringify(beforeLines) && JSON.stringify(g().costOverrides) === JSON.stringify(beforeOverrides));
  check('R7 developer fee and contingency read as a percentage of hard and soft costs; the other soft items of hard cost',
    costStandardBasisLabel('percent_of_selected', '', 'developer-fee') === '% of hard and soft costs'
    && costStandardBasisLabel('percent_of_selected', '', 'contingency') === '% of hard and soft costs'
    && costStandardBasisLabel('percent_of_selected', '', 'engineering-supervision') === '% of hard cost');
  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('R8 the Standards headers are centred both ways, with no header overriding it',
    tab.includes("textAlign: 'center', verticalAlign: 'middle'") && !tab.split('\n').some((l) => l.includes('<th style={{ ...TH') && /textAlign: /.test(l)));
  const order = g().costLines.filter((l) => l.phaseId === P).map((l) => l.id.replace(`__${P}`, ''));
  // Captured before the undo below: re-run a reset for the order check.
  void order;
  const shown = constructionRowsForView(seedCostStandardRows([] as never, undefined), [
    { id: 'standalone-commercial', label: 'Standalone Commercial' }, { id: 'branded-villas', label: 'Branded Villas' },
  ] as never);
  const shownTypes = shown.filter((r) => r.assetTypeId !== undefined).map((r) => `${r.label}=${r.rate ?? ''}`);
  check('R10 the construction list shows only the types this project lists, in its order, with their stored defaults',
    shownTypes.join('|') === 'Standalone Commercial=3000|Branded Villas=11000', shownTypes.join('|'));
  check('R11 the other construction rows follow the types', shown.slice(2).map((r) => r.label).join('|') === 'Parking|Landscape|Villas Landscape');
  const capex = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  check('R9 the Capex inputs carry the reset, behind a confirm and with an undo',
    capex.includes('<CapexResetCard />') && capex.includes('costs-reset-standards-run') && capex.includes('costs-reset-standards-undo'));
}

// ── B. the soft cost basis is stated once ───────────────────────────────────
section('B. a soft percentage charges on what its Types and Standards row states');
{
  const at = (r: ReturnType<typeof run>, id: string): CostLine | undefined => r.state.costLines.find((l) => l.id === `${id}__${P}`);
  const r = run(ROWS, unpriced());
  const ids = (l: CostLine | undefined): string[] => (l?.selectedLineIds ?? []).map((x) => x.replace(`__${P}`, ''));
  check('B1 engineering supervision charges the hard lines above it and nothing soft',
    ['construction-bua', 'construction-parking', 'infrastructure', 'landscaping'].every((b) => ids(at(r, 'engineering-supervision')).includes(b))
    && !ids(at(r, 'engineering-supervision')).includes('design-consultancy'), ids(at(r, 'engineering-supervision')).join(','));
  check('B2 developer fee charges hard and soft above it, the created soft lines included',
    ['construction-bua', 'engineering-supervision', 'design-consultancy', 'permits-approvals', 'pre-operating'].every((b) => ids(at(r, 'developer-fee')).includes(b))
    && !ids(at(r, 'developer-fee')).includes('marketing') && !ids(at(r, 'developer-fee')).includes('rett'), ids(at(r, 'developer-fee')).join(','));
  check('B3 contingency charges the developer fee too', ids(at(r, 'contingency')).includes('developer-fee'));

  const soft = ROWS.map((row) => (row.id === 'cat:engineering-supervision' ? { ...row, chargesOn: 'hard_and_soft' as const } : row));
  check('B4 changing the basis on the tab changes the selection in every phase',
    ids(at(run(soft, unpriced()), 'engineering-supervision')).includes('design-consultancy'));

  const own = r.state.costLines.map((l) => (l.id === `developer-fee__${P}` ? { ...l, selectedLineIds: [BUA], selectionStated: true } : l));
  const keep = settleStandardCostOverrides({ ...r.state, costLines: own });
  check('B5 a phase that picked its own lines keeps them', JSON.stringify(keep.state.costLines.find((l) => l.id === `developer-fee__${P}`)?.selectedLineIds) === JSON.stringify([BUA]));

  const lines = r.state.costLines;
  const dev = lines.find((l) => l.id === `developer-fee__${P}`)!;
  const same = settleLineSelectionStated(lines.map((l) => (l.id === dev.id ? { ...l, selectionStated: undefined } : l)), ROWS);
  const differs = settleLineSelectionStated(lines.map((l) => (l.id === dev.id ? { ...l, selectionStated: undefined, selectedLineIds: [BUA] } : l)), ROWS);
  check('B6 on load a selection matching the basis takes the basis; a different one stays the line\'s own',
    same.costLines.find((l) => l.id === dev.id)?.selectionStated === false && differs.costLines.find((l) => l.id === dev.id)?.selectionStated === true);
  const dangling = settleLineSelectionStated(lines.map((l) => (l.id === dev.id
    ? { ...l, selectionStated: undefined, selectedLineIds: [...(l.selectedLineIds ?? []), 'deleted-line__x'] }
    : l)), ROWS);
  check('B6b a reference to a line that no longer exists is not a difference', dangling.costLines.find((l) => l.id === dev.id)?.selectionStated === false);
  check('B7 the derivation is positional: nothing below the line is charged', !derivedSelection(dev, lines, 'hard_and_soft').includes(`contingency__${P}`));
  check('B8 the tab states the basis with the percentage',
    costStandardBasisLabel('percent_of_selected', '', 'engineering-supervision', 'hard_and_soft') === '% of hard and soft costs'
    && ROWS.find((row) => row.id === 'cat:developer-fee')?.chargesOn === 'hard_and_soft'
    && ROWS.find((row) => row.id === 'cat:engineering-supervision')?.chargesOn === 'hard');

  const st = createModule1Store();
  st.getState().addAsset(asset('b1', 'villa'));
  st.getState().setCostStandardRows(seedCostStandardRows([] as never, undefined));
  const devId = `developer-fee__${P}`;
  st.getState().updateCostLine(devId, { selectedLineIds: [BUA] });
  check('B9 picking lines in Capex makes the selection the phase\'s own',
    st.getState().costLines.find((l) => l.id === devId)?.selectionStated === true
    && JSON.stringify(st.getState().costLines.find((l) => l.id === devId)?.selectedLineIds) === JSON.stringify([BUA]));
  st.getState().updateCostLine(devId, { selectionStated: false });
  check('B10 "Use Types and Standards" hands the line back to the stated basis',
    (st.getState().costLines.find((l) => l.id === devId)?.selectedLineIds ?? []).length > 1);

  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  const capex = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  check('B11 the tab states the basis per row; Capex shows where it comes from and the way back',
    tab.includes('-charges-on') && capex.includes('-pct-basis') && capex.includes('-pct-use-standard') && capex.includes('selectionStated: true'));
}

// ── Z. the four fixes of 2026-09-15 ─────────────────────────────────────────
section('Z. one type lookup, the reset in list order, no pointers to nothing, the tab text');
{
  const labelOnly = asset('lab1', undefined, { type: 'Branded Villas' } as Partial<Asset>);
  const labelStrip = asset('ls1', undefined, { type: 'Branded Villas', isCompanion: true, companionType: 'retail', strategy: 'Lease' } as Partial<Asset>);
  check('Z1 a plot typed by label prices as its type, as table 4 merges it', standardTypeIdFor(labelOnly, TYPES) === 'branded-villas');
  check('Z2 a retail strip carrying its hosts\' label still prices as ground-floor retail', standardTypeIdFor(labelStrip, TYPES) === 'retail-ground-floor');
  const rz = settleStandardCostOverrides({
    assets: [labelOnly], costLines: unpriced(), costOverrides: [] as CostOverride[], phases: [{ id: P, constructionPeriods: 3 }],
    project: { costStandardRows: ROWS, assetTypes: TYPES },
  });
  check('Z3 so it takes the villas superstructure default', rz.state.costOverrides.some((o) => o.assetId === 'lab1' && o.lineId === BUA && o.value === 11000));
  const wb = planTypeMassingWriteBack(
    [asset('w1', 'branded-villas', { landChain: { coveragePct: 60 } }), asset('w2', undefined, { type: 'Branded Villas', landChain: { coveragePct: 55 } } as Partial<Asset>)],
    {}, { overwrite: true },
  );
  check('Z4 the fill-back counts a label-typed plot towards its type (so a disagreement blocks it)', wb.values['branded-villas']?.coveragePct === undefined);

  const st = createModule1Store();
  const gz = st.getState;
  gz().setProject({ assetTypes: [{ id: 'branded-villas', label: 'Branded Villas' }] } as never);
  gz().addAsset(asset('z1', 'branded-villas'));
  gz().setCostStandardRows(seedCostStandardRows([{ id: 'branded-villas', label: 'Branded Villas' }] as never, undefined));
  gz().resetCapexToStandards([P]);
  const ids = gz().costLines.filter((l) => l.phaseId === P).map((l) => l.id.replace(`__${P}`, ''));
  check('Z5 the reset produces exactly the list, in the list order, the transfer tax after land',
    ids.join(',') === 'land-cash,land-inkind,rett,construction-bua,construction-parking,landscaping,engineering-supervision,design-consultancy,permits-approvals,developer-fee,contingency,marketing',
    ids.join(','));
  const devz = gz().costLines.find((l) => l.id === `developer-fee__${P}`);
  check('Z6 after the reset the developer fee charges the soft lines above it',
    ['engineering-supervision', 'design-consultancy', 'permits-approvals', 'construction-bua'].every((b) => (devz?.selectedLineIds ?? []).includes(`${b}__${P}`)),
    JSON.stringify(devz?.selectedLineIds));

  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('Z7 the tab no longer says type names wait for Save', !tab.includes('waits for') && tab.includes('Both halves save as you type'));
}

// ── O. one way to build a phase ─────────────────────────────────────────────
section('O. every path builds a phase the same way: the standards list, in order');
{
  const LIST = 'land-cash,land-inkind,rett,construction-bua,construction-parking,landscaping,engineering-supervision,design-consultancy,permits-approvals,developer-fee,contingency,marketing';
  const idsOf = (lines: CostLine[], phaseId: string): string => lines.filter((l) => l.phaseId === phaseId).map((l) => l.id.replace(`__${phaseId}`, '')).join(',');
  const def = createModule1Store();
  check('O1 the store\'s empty default is the list', idsOf(def.getState().costLines, P) === LIST, idsOf(def.getState().costLines, P));
  def.getState().addPhase({ ...def.getState().phases[0], id: 'phase_9', name: 'Phase 9', constructionPeriods: 3 });
  def.getState().addAsset(asset('n9', 'villa', { phaseId: 'phase_9' } as Partial<Asset>));
  check('O2 the first asset of a new phase gets the list', idsOf(def.getState().costLines, 'phase_9') === LIST, idsOf(def.getState().costLines, 'phase_9'));
  def.getState().resetCapexToStandards(['phase_9']);
  check('O3 and a reset of that phase produces the same lines', idsOf(def.getState().costLines, 'phase_9') === LIST);
  const wizard = readFileSync('src/hubs/modeling/platforms/refm/lib/wizard/buildWizardSnapshot.ts', 'utf8');
  const migrate = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts', 'utf8');
  const storeSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('O4 the wizard, the load seeds and the store all call the one builder, and none seeds the old catalog',
    wizard.includes('buildPhaseCostLines(') && (migrate.match(/buildPhaseCostLines\(/g) ?? []).length >= 2
    && (storeSrc.match(/buildPhaseCostLines\(/g) ?? []).length >= 2
    && !/makeBlankCostLines\(/.test(wizard) && !/makeBlankCostLines\(/.test(migrate) && !/makeBlankCostLines\(/.test(storeSrc));
  const capexSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  const tabSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('O5 every percentage input shows two decimals, in Capex and on Types and Standards',
    capexSrc.includes("decimals={effMethod.startsWith('percent') ? (2 as DisplayDecimals) : decimals}")
    && tabSrc.includes('value.toFixed(decimals)')
    && ['utilisationPct', 'coveragePct', 'servicePct'].every((k) => tabSrc.includes(`value={v?.${k}} disabled={noProject} decimals={2}`))
    && tabSrc.includes("value={row.rate} disabled={noProject} decimals={list === 'soft' ? 2 : undefined}"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
