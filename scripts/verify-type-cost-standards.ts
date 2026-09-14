/**
 * verify-type-cost-standards.ts (2026-09-14)
 *
 * The asset type as the default for cost rates and massing:
 *   W  the massing write-back: a plot edit reaches its type when every plot of
 *      the type states the same figure, and never otherwise
 *   S  the cost standards settle: a type's rate becomes a standard-sourced
 *      override on each of its assets, the user's own override is never
 *      touched, and the settle returns its input when nothing moves
 *   T  the strip keeps its retail basis and gets its seed back
 *   G  Module 6 gating and the screens say what is true
 *
 * Offline: the store and the pure functions, no database.
 */
import { readFileSync } from 'node:fs';
import { createModule1Store } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';
import {
  makeBlankCostLines, DEFAULT_PHASE_ID, type Asset, type CostOverride,
} from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { planTypeMassingWriteBack, resolveChainDefaults } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { settleStandardCostOverrides, standardCostRows } from '../src/hubs/modeling/platforms/refm/lib/state/costStandards';
import { inactiveLeverReason, nonEconomicLeverReason } from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';
import type { HydrateSnapshot } from '../src/hubs/modeling/platforms/refm/lib/state/module1-store';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

const P = DEFAULT_PHASE_ID;
const asset = (id: string, typeId: string, extra: Partial<Asset> = {}): Asset => ({
  id, phaseId: P, name: id, type: typeId, strategy: 'Sell', visible: true, assetTypeId: typeId, ...extra,
} as unknown as Asset);
const BUA = `construction-bua__${P}`;
const LANDSCAPE = `landscaping__${P}`;
const CONT = `contingency__${P}`;

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
  check('W3 coverage differs (50 vs 45): the type is not written', tv?.coveragePct === undefined, JSON.stringify(tv));
  s.updateAsset('a2', { landChain: { utilisationPct: 70, coveragePct: 50 } });
  const tv2 = store.getState().project.assetTypeValues?.apt;
  check('W4 plots now disagree on utilisation: the type keeps its last agreed figure', tv2?.utilisationPct === 80, JSON.stringify(tv2));
  check('W5 coverage now agrees at 50: the type reads 50', tv2?.coveragePct === 50, JSON.stringify(tv2));
  s.updateAsset('a2', { landChain: { utilisationPct: 80, coveragePct: 40 } });
  s.updateAsset('a1', { landChain: { utilisationPct: 80, coveragePct: 40 } });
  check('W6 the edit path OVERWRITES a type figure when the plots agree again', store.getState().project.assetTypeValues?.apt?.coveragePct === 40);
  // Load and save fill only an ABSENT type figure.
  const pure = planTypeMassingWriteBack(
    [asset('b1', 't', { landChain: { farRatio: 2 } }), asset('b2', 't', { landChain: { farRatio: 2 } })],
    { t: { farRatio: 3 } },
    { overwrite: false },
  );
  check('W7 load and save never overwrite a figure typed on the type', !pure.changed && pure.values.t.farRatio === 3);
  const input = { t: {} };
  const filled = planTypeMassingWriteBack(
    [asset('b1', 't', { landChain: { farRatio: 2 } }), asset('b2', 't', { landChain: { farRatio: 2 } })],
    input, { overwrite: false },
  );
  check('W8 load and save fill an absent figure', filled.changed && filled.values.t.farRatio === 2 && input.t !== filled.values.t);
  const companion = planTypeMassingWriteBack(
    [asset('c1', 'u', { landChain: { servicePct: 10 } }), asset('c2', 'u', { isCompanion: true, landChain: { servicePct: 99 } } as Partial<Asset>)],
    {}, { overwrite: true },
  );
  check('W9 a companion does not break unanimity', companion.values.u?.servicePct === 10);
  const same = { v: { coveragePct: 5 } };
  const settled = planTypeMassingWriteBack([asset('d1', 'v', { landChain: { coveragePct: 5 } })], same, { overwrite: true });
  check('W10 settles: nothing to move returns the input object', !settled.changed && settled.values === same);
  const inherits = resolveChainDefaults({}, { utilisationPct: 85 });
  check('W11 a blank plot inherits the type utilisation, and says so', inherits.utilisationPct === 85 && inherits.sources.utilisationPct === 'asset_type');
  const own = resolveChainDefaults({ utilisationPct: 0 }, { utilisationPct: 85 });
  check('W12 a typed 0 on the plot is an override', own.utilisationPct === 0 && own.sources.utilisationPct === 'sub_unit');
}

// ── S. cost standards ───────────────────────────────────────────────────────
section('S. a type cost rate becomes a standard override on each of its assets');
{
  const store = createModule1Store();
  const s = store.getState();
  s.addAsset(asset('v1', 'villa'));
  s.addAsset(asset('v2', 'villa'));
  s.addAsset(asset('h1', 'hotel', { strategy: 'Operate' } as Partial<Asset>));
  const lines = store.getState().costLines;
  check('S0 the phase has the seeded catalog lines', lines.some((l) => l.id === BUA) && lines.some((l) => l.id === CONT));

  s.setAssetTypeValue('villa', { costRates: { 'construction-bua': 11000, contingency: 5 } });
  const ov = (): CostOverride[] => store.getState().costOverrides;
  const find = (a: string, l: string): CostOverride | undefined => ov().find((o) => o.assetId === a && o.lineId === l);
  const buaLine = store.getState().costLines.find((l) => l.id === BUA)!;
  check('S1 each villa carries a standard override at 11,000 on the superstructure line',
    ['v1', 'v2'].every((a) => find(a, BUA)?.value === 11000 && find(a, BUA)?.origin === 'standard'));
  check('S2 the override is on the line basis', find('v1', BUA)?.method === buaLine.method);
  check('S3 the soft percentage reaches the contingency line too', find('v2', CONT)?.value === 5);
  check('S4 the hotel type has no rate, so the hotel has no override', find('h1', BUA) === undefined);
  check('S5 a line with no rate on the type gets no override', find('v1', LANDSCAPE) === undefined);

  // The user's own override is never touched.
  s.setCostOverride({ assetId: 'v2', lineId: BUA, method: buaLine.method, value: 9000, phasing: buaLine.phasing, overridden: true });
  s.setAssetTypeValue('villa', { costRates: { 'construction-bua': 12000, contingency: 5 } });
  check('S6 a rate change moves the standard override', find('v1', BUA)?.value === 12000);
  check('S7 the user override stays at 9,000 with no flag', find('v2', BUA)?.value === 9000 && find('v2', BUA)?.origin === undefined);
  s.removeCostOverride('v2', BUA);
  check('S8 removing the user override brings the standard back', find('v2', BUA)?.value === 12000 && find('v2', BUA)?.origin === 'standard');

  // The override follows the line in everything but the value.
  s.updateCostLine(BUA, { phasing: 'manual' });
  check('S9 a phasing edit on the line reaches the standard override', find('v1', BUA)?.phasing === 'manual');

  s.setAssetTypeValue('villa', { costRates: { contingency: 5 } });
  check('S10 removing the rate removes the standard override', find('v1', BUA) === undefined && find('v2', BUA) === undefined);
  s.setAssetTypeValue('villa', { costRates: undefined });
  check('S11 clearing every rate removes every standard override', !ov().some((o) => o.origin === 'standard'));

  const st = store.getState();
  const r = settleStandardCostOverrides(st);
  check('S12 settles: nothing to move returns the input object', !r.changed && r.state === st);

  s.setAssetTypeValue('villa', { costRates: { 'construction-bua': 11000 } });
  s.addAsset(asset('v3', 'villa'));
  check('S13 an asset added to the type picks the standard up', find('v3', BUA)?.value === 11000);
}

// ── T. the retail strip ─────────────────────────────────────────────────────
section('T. a retail strip keeps its basis and gets its seed back');
{
  const lines = makeBlankCostLines(P).map((l) => (l.id === BUA ? { ...l, value: 4000 } : l));
  const bua = lines.find((l) => l.id === BUA)!;
  const strip = asset('s1', 'retail', { isCompanion: true, companionType: 'retail', strategy: 'Lease' } as Partial<Asset>);
  const seed: CostOverride = { assetId: 's1', lineId: BUA, method: 'rate_x_retail_gfa' as CostOverride['method'], value: 4000, phasing: bua.phasing, overridden: true };
  const base = { assets: [strip], costLines: lines, costOverrides: [seed], project: { assetTypeValues: { retail: { costRates: { 'construction-bua': 2200 } } } } };
  const on = settleStandardCostOverrides(base);
  const o1 = on.state.costOverrides.find((o) => o.lineId === BUA);
  check('T1 the seed takes the type rate', o1?.value === 2200 && o1?.origin === 'standard');
  check('T2 and keeps the retail GFA basis', o1?.method === 'rate_x_retail_gfa');
  const off = settleStandardCostOverrides({ ...on.state, project: { assetTypeValues: {} } });
  const o2 = off.state.costOverrides.find((o) => o.lineId === BUA);
  check('T3 when the rate goes the seed comes back at the line rate on its own basis',
    o2?.value === 4000 && o2?.origin === undefined && o2?.method === 'rate_x_retail_gfa');
  const typed: CostOverride = { ...seed, value: 1800 };
  const kept = settleStandardCostOverrides({ ...base, costOverrides: [typed] });
  check('T4 a strip override the user typed is left alone', !kept.changed);
}

// ── G. the table, minting lines, gating and screens ─────────────────────────
section('G. one cost table, lines minted where a standard needs one, the gate and the screens');
{
  const rows = standardCostRows(makeBlankCostLines(P));
  const ids = rows.map((r) => r.catalogId);
  check('G1 construction, parking, landscape, contingency, transfer tax and marketing are rows',
    ['construction-bua', 'construction-parking', 'landscaping', 'contingency', 'rett', 'marketing'].every((i) => ids.includes(i)), ids.join(','));
  check('G2 the two land value rows are not offered', !ids.includes('land-cash') && !ids.includes('land-inkind'));
  const groups = rows.map((r) => r.group);
  const order = ['hard', 'soft', 'land', 'selling'];
  check('G3 rows run hard, soft, land charges, selling', groups.every((x, i) => i === 0 || order.indexOf(x) >= order.indexOf(groups[i - 1])));
  check('G4 marketing and commission are selling only; contingency is a percent',
    rows.find((r) => r.catalogId === 'marketing')?.sellingOnly === true
    && rows.find((r) => r.catalogId === 'commission')?.sellingOnly === true
    && rows.find((r) => r.catalogId === 'contingency')?.unit === 'percent');

  // A standard for an item the phase has no line for MINTS the line.
  const seed = makeBlankCostLines(P).filter((l) => !l.id.startsWith('landscaping'));
  const villa = asset('m1', 'villa');
  const hotel = asset('m2', 'hotel', { strategy: 'Operate' } as Partial<Asset>);
  const res = settleStandardCostOverrides({
    assets: [villa, hotel], costLines: seed, costOverrides: [] as CostOverride[],
    phases: [{ id: P, constructionPeriods: 3 }],
    project: { assetTypeValues: {
      villa: { costRates: { landscaping: 1200, 'design-consultancy': 3, marketing: 3.5 } },
      hotel: { costRates: { marketing: 2, landscaping: 800 } },
    } },
  });
  const lines = res.state.costLines;
  const at = (id: string): number => lines.findIndex((l) => l.id === id);
  const land = lines.find((l) => l.id === `landscaping__${P}`);
  check('G5 a landscape standard mints the landscape line, once, at a zero master rate',
    !!land && land.value === 0 && lines.filter((l) => l.id.startsWith('landscaping')).length === 1, JSON.stringify(land));
  check('G6 the minted line sits at its catalog position, after infrastructure',
    at(`landscaping__${P}`) === at(`infrastructure__${P}`) + 1);
  const design = lines.find((l) => l.id === `design-consultancy__${P}`);
  check('G7 a minted percentage charges the construction lines above it',
    !!design && ['construction-bua', 'construction-parking', 'infrastructure', 'landscaping'].every((b) => design.selectedLineIds?.includes(`${b}__${P}`)),
    JSON.stringify(design?.selectedLineIds));
  const ovs = res.state.costOverrides;
  const ov = (a: string, l: string): CostOverride | undefined => ovs.find((o) => o.assetId === a && o.lineId === l);
  check('G8 each type carries its own landscape rate on the one line',
    ov('m1', `landscaping__${P}`)?.value === 1200 && ov('m2', `landscaping__${P}`)?.value === 800);
  check('G9 marketing reaches the selling villa and never the operated hotel',
    ov('m1', `marketing__${P}`)?.value === 3.5 && ov('m2', `marketing__${P}`) === undefined);
  // A line on the marketing stage under the commission id IS marketing.
  const renamed = makeBlankCostLines(P).map((l) => (l.id === `marketing__${P}`
    ? { ...l, id: `commission-x__${P}` }
    : l)).filter((l) => l.id !== `commission__${P}`).map((l) => (l.id === `commission-x__${P}` ? { ...l, id: `commission__${P}`, name: 'Marketing' } : l));
  const mk = settleStandardCostOverrides({
    assets: [villa], costLines: renamed, costOverrides: [] as CostOverride[], phases: [{ id: P, constructionPeriods: 3 }],
    project: { assetTypeValues: { villa: { costRates: { marketing: 3.5 } } } },
  });
  check('G9b a marketing standard reaches a marketing-stage line under the commission id, and mints no second marketing line',
    mk.linesAdded === 0 && mk.state.costOverrides.some((o) => o.lineId === `commission__${P}` && o.value === 3.5));
  const again = settleStandardCostOverrides(res.state);
  check('G10 the minted state settles', !again.changed && again.state === res.state);

  const model = createModule1Store().getState().extractPersistSnapshot() as unknown as HydrateSnapshot;
  const why = inactiveLeverReason('project.assetTypeValues.villa.costRates.construction-bua', model);
  check('G11 a type cost rate is shown inactive in Module 6, with a reason that names the override', !!why && /override/.test(why), String(why));
  check('G12 the override origin flag is not a scenario lever', nonEconomicLeverReason('costOverrides[a::l].origin', 'origin') !== null);

  const capex = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  check('G13 Capex marks a standard override and offers no revert for it',
    capex.includes("override.origin === 'standard'") && capex.includes('-from-standard'));
  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('G14 the Standards tab has one cost table (rows are items, columns are types) and a utilisation column',
    tab.includes('asset-cost-standards-table') && tab.includes('std-cost-row-') && tab.includes('standardCostRows(') && tab.includes('-utilisation'));
  check('G15 the Standards tab sets one phasing curve per phase through the Capex control',
    tab.includes('asset-phase-phasing') && tab.includes('<AssetPhasingControl') && tab.includes('updateAsset(x.id, { capexPhasing })'));
  check('G16 the callout paragraph is 11px, as the other tabs', tab.includes('fontSize: 11, lineHeight: 1.45'));
  {
    const st = createModule1Store();
    st.getState().addAsset(asset('e1', 'villa'));
    const before = st.getState().costLines.filter((l) => l.id.startsWith('design-consultancy')).length;
    st.getState().setAssetTypeValue('villa', { costRates: { 'design-consultancy': 3 } });
    const after = st.getState().costLines.filter((l) => l.id.startsWith('design-consultancy')).length;
    check('G9c on the EDIT path the minted line is stored with its override',
      before === 0 && after === 1 && st.getState().costOverrides.some((o) => o.lineId.startsWith('design-consultancy') && o.value === 3));
  }
  const store = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('G17 load and save both run the write-back and the settle',
    (store.match(/planTypeMassingWriteBack\(/g) ?? []).length >= 3 && (store.match(/settleStandardCostOverrides\(/g) ?? []).length >= 3);
}

// ── R. the other founder items of the same round ────────────────────────────
section('R. revenue order, selling cost wording, lease statement, scroll memory');
{
  const rev = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module2RevenueOutput.tsx', 'utf8');
  const iPrice = rev.indexOf('2a. Sale price per year, after indexation');
  const iRevenue = rev.indexOf('2b. Revenue (per sub-unit');
  check('R1 the indexed price table comes before the revenue table', iPrice > 0 && iRevenue > iPrice);
  check('R2 a selling cost is named by what it is, so every phase reads the same',
    rev.includes('name: sellingCostName(l)') && rev.includes("return 'Marketing'"));
  const opex = readFileSync('src/hubs/modeling/platforms/refm/lib/reports/opexReports.ts', 'utf8');
  check('R3 a lease line is ONE operating statement down to EBITDA, with a leasing summary',
    opex.includes(': Operating statement`, rows });') && opex.includes("'Leasing operating summary'")
    && !opex.includes('Revenue breakdown') && opex.includes("'EBITDA, net operating income'"));
  const shell = readFileSync('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx', 'utf8');
  check('R4 the workspace remembers its scroll position per project, module and tab',
    shell.includes('ref={mainScrollRef}') && shell.includes('scrollMemoRef.current.set(scrollKey') && shell.includes('[scrollKey]'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
