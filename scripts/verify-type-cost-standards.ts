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
import { settleStandardCostOverrides, standardCostColumns } from '../src/hubs/modeling/platforms/refm/lib/state/costStandards';
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

// ── G. gating and screens ───────────────────────────────────────────────────
section('G. the columns, the scenario gate and the screens');
{
  const cols = standardCostColumns(makeBlankCostLines(P));
  const ids = cols.map((c) => c.catalogId);
  check('G1 construction, parking, landscaping and contingency are columns',
    ['construction-bua', 'construction-parking', 'landscaping', 'contingency'].every((i) => ids.includes(i)), ids.join(','));
  check('G2 land, marketing and commission are not', !ids.some((i) => /land|marketing|commission/.test(i) && i !== 'landscaping'), ids.join(','));
  const firstSoft = cols.findIndex((c) => c.stage === 'soft');
  check('G3 hard columns come first', firstSoft > 0 && cols.slice(firstSoft).every((c) => c.stage === 'soft'));
  check('G4 a contingency column is stated in percent', cols.find((c) => c.catalogId === 'contingency')?.unit === 'percent');

  const model = createModule1Store().getState().extractPersistSnapshot() as unknown as HydrateSnapshot;
  const why = inactiveLeverReason('project.assetTypeValues.villa.costRates.construction-bua', model);
  check('G5 a type cost rate is shown inactive in Module 6, with a reason that names the override', !!why && /override/.test(why), String(why));
  check('G6 the override origin flag is not a scenario lever', nonEconomicLeverReason('costOverrides[a::l].origin', 'origin') !== null);

  const capex = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Costs.tsx', 'utf8');
  check('G7 Capex marks a standard override and offers no revert for it',
    capex.includes("override.origin === 'standard'") && capex.includes('-from-standard'));
  const tab = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1AssetStandards.tsx', 'utf8');
  check('G8 the Standards tab has the cost standards table and a utilisation column',
    tab.includes('asset-cost-standards-table') && tab.includes('-utilisation') && tab.includes('standardCostColumns('));
  check('G9 the callout paragraph is 11px, as the other tabs', /data-testid="asset-standards-callout"/.test(tab) && tab.includes('fontSize: 11, lineHeight: 1.45'));
  const store = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-store.ts', 'utf8');
  check('G10 load and save both run the write-back and the settle',
    (store.match(/planTypeMassingWriteBack\(/g) ?? []).length >= 3 && (store.match(/settleStandardCostOverrides\(/g) ?? []).length >= 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
