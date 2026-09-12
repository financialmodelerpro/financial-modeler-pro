/**
 * verify-asset-label.ts (2026-09-08 as verify-asset-display-name, rewritten 2026-09-10)
 *
 * AN ASSET IS CALLED BY WHERE IT IS AND WHAT IT IS, everywhere, and the manual
 * name it used to carry reaches nothing.
 *
 * WHY THIS TESTS OUTPUT RATHER THAN GREPPING FOR CALL SITES. An asset name is
 * read in more than thirty files: the resolvers, eight report builders, the
 * Excel workbook (26 reads, several of them MAP KEYS rather than labels), the
 * PDF, the deck and the AI grounding. A grep proving I edited them all proves
 * only that I edited the ones I found. So the fixture below MUTATES a stored
 * name and asserts that nothing in the output moves, and asserts that the two
 * halves of the capex tab call one asset one thing.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-asset-label.ts
 *
 * No em dashes in this file.
 */

import { readFileSync } from 'node:fs';
import {
  assetLabel,
  withResolvedAssetNames,
  UNNAMED_ASSET,
  type AssetLabelContext,
} from '../src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCapexReport, planCapexSummaryLines } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { groupAssetsForConsolidation, consolidationKey } from '../src/core/calculations/consolidation';
import { retailCompanionId } from '../src/core/calculations/retailCompanion';
import { normaliseAssetTypeId } from '../src/hubs/modeling/platforms/refm/lib/state/assetTypeStandards';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

const CTX = (
  parcels: { id: string; name?: string }[],
  phases: { id: string; name?: string }[],
): AssetLabelContext => ({ parcels, phases });
const ONE = CTX([{ id: 'l1', name: 'Land 1' }], [{ id: 'ph1', name: 'Phase 1' }]);
const TWO = CTX([{ id: 'l1', name: 'Land 1' }], [{ id: 'ph1', name: 'Phase 1' }, { id: 'ph2', name: 'Phase 2' }]);

function ruleChecks(): void {
  section('A. The label');
  check('A1 the plot leads, then the type',
    assetLabel({ type: 'Branded Villas', phaseId: 'ph1', landAllocation: { parcelId: 'l1' } }, ONE)
      === 'Land 1, Branded Villas');
  check('A2 no plot, so the PHASE takes its place',
    assetLabel({ type: 'Branded Villas', phaseId: 'ph1' }, ONE) === 'Phase 1, Branded Villas');
  check('A3 a multi-phase project appends the phase behind a plot, because a plot can be reused',
    assetLabel({ type: 'Branded Villas', phaseId: 'ph2', landAllocation: { parcelId: 'l1' } }, TWO)
      === 'Land 1, Branded Villas, Phase 2');
  check('A4 a single-phase project does NOT, because repeating it on every row says nothing',
    assetLabel({ type: 'Branded Villas', phaseId: 'ph1', landAllocation: { parcelId: 'l1' } }, ONE)
      === 'Land 1, Branded Villas');
  check('A5 an asset already led by its phase never says it twice',
    assetLabel({ type: 'Branded Villas', phaseId: 'ph2' }, TWO) === 'Phase 2, Branded Villas');
  check('A6 a SENTINEL parcel id is not a plot: it means weighted average, which is the absence of one',
    assetLabel({ type: 'Branded Villas', phaseId: 'ph1', landAllocation: { parcelId: '__weighted__' } }, ONE)
      === 'Phase 1, Branded Villas');
  check('A7 a parcel id that no longer resolves falls back rather than printing the id',
    assetLabel({ type: 'Branded Villas', phaseId: 'ph1', landAllocation: { parcelId: 'gone' } }, ONE)
      === 'Phase 1, Branded Villas');
  check('A8 the companion marker separates a companion from the asset it accompanies',
    assetLabel({ type: 'High-end Apartments', phaseId: 'ph1', isCompanion: true }, ONE)
      === 'Phase 1, High-end Apartments (Operate)'
    && assetLabel({ type: 'Retail combined', phaseId: 'ph1', isCompanion: true, companionType: 'retail' }, ONE)
      === 'Phase 1, Retail combined (Retail)');
  check('A9 whitespace is not a type and not a plot',
    assetLabel({ type: '  ', phaseId: 'ph1' }, ONE) === 'Phase 1'
    && assetLabel({ type: 'T', phaseId: 'ph1' }, CTX([], [{ id: 'ph1', name: '   ' }])) === 'T');
  check('A10 with nothing to say it still never returns an empty string',
    assetLabel({}, CTX([], [])) === UNNAMED_ASSET
    && assetLabel({ name: 'Marina Residences' }, CTX([], [])) === UNNAMED_ASSET);
}

function retirementChecks(): void {
  section('B. The manual name is RETIRED, and reaches nothing');
  check('B1 a stored name is IGNORED, even when it is the only thing set',
    assetLabel({ name: 'Marina Residences', type: 'Branded Villas', phaseId: 'ph1' }, ONE)
      === 'Phase 1, Branded Villas');
  check('B2 resolving a list overwrites the name on the COPY and leaves the original alone',
    (() => {
      const a = { id: '1', name: 'Marina Residences', type: 'Branded Villas', phaseId: 'ph1' };
      const out = withResolvedAssetNames([a], ONE);
      return out[0] !== a && out[0].name === 'Phase 1, Branded Villas' && a.name === 'Marina Residences';
    })());
  const types = readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-types.ts', 'utf8');
  check('B3 the FIELD is still declared, so nothing a user typed is destroyed',
    types.includes('name: string;'));
  const tabSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  // THE ASSET ROW ONLY. A parcel and a sub-unit still carry names of their own,
  // and always will: those identify a thing the user really did name.
  check('B4 the assets table no longer offers an asset name to type',
    !tabSrc.includes('onUpdateAsset(asset.id, { name:')
    && !tabSrc.includes('asset-row-${asset.id}-name')
    && !tabSrc.includes('value={asset.name}'));
  check('B5 the assets table resolves its own list now that it owns no raw input',
    tabSrc.includes('assets: rawAssets')
    && tabSrc.includes('withResolvedAssetNames(rawAssets, { parcels, phases })'));
  check('B6 no migration rewrites or strips a stored name',
    !readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts', 'utf8').includes('name: assetLabel'));
  const label = readFileSync('src/core/calculations/assetName.ts', 'utf8');
  check('B7 the retired helpers are GONE, not left beside the new one',
    !label.includes('export function assetDisplayName')
    && !label.includes('export function assetNameIsDerived')
    && !label.includes('export function assetTypeSuffix'));
  check('B8 the context is REQUIRED, so no caller can silently produce a shorter label',
    label.includes('ctx: AssetLabelContext,') && !label.includes('ctx?: AssetLabelContext'));
}

/**
 * THE OUTPUT. A stored name is mutated and the whole model is rebuilt; nothing
 * may move. This is the check that would have caught the old defect from the
 * other side: under the previous rule a typed name WON, so this fixture would
 * have differed in dozens of cells.
 */
function outputChecks(): void {
  section('C. The output does not depend on the stored name');
  const base = buildExcelSampleState();
  const renamed = {
    ...base,
    assets: base.assets.map((a: { name?: string }) => ({ ...a, name: `ZZ ${a.name ?? ''} ZZ` })),
  };

  const snapBase = computeFinancialsSnapshot(base);
  const snapRenamed = computeFinancialsSnapshot(renamed);
  const ser = (x: unknown): string =>
    JSON.stringify(x, (_k, v) => (v instanceof Map ? [...v.entries()] : v));
  // THE SNAPSHOT CARRIES THE RAW ASSET ROW BY DESIGN (`byAsset[].asset` is the
  // stored object, marker and all), so a byte comparison would fail on data
  // rather than on a label. What must not move is anything BUILT from the name:
  // every other occurrence of the marker is a label that read the retired field.
  const strip = (x: unknown): string =>
    ser(x).split('"asset":{').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('}') + 1))).join('');
  check('C1 no LABEL in the engine snapshot moves when every asset is renamed',
    strip(snapBase) === strip(snapRenamed));
  check('C1b and the marker survives the strip where it is genuinely data, so C1 is not vacuous',
    ser(snapRenamed).includes('ZZ '));

  const capexBase = buildCapexReport(snapBase, base);
  const capexRenamed = buildCapexReport(snapRenamed, renamed);
  check('C2 the capex report is byte-identical too, labels included',
    ser(capexBase) === ser(capexRenamed));
  check('C3 no label anywhere in it is empty or whitespace',
    capexBase.inputAssets.every((r) => r.assetName.trim() !== '')
    && capexBase.assetSeries.every((r) => r.name.trim() !== ''));

  // THE TWO HALVES OF ONE TAB. The input table read `assetLabel(a, state)` and
  // the output rows read `a.name`, the raw stored field, so the same asset
  // could be called two things on one screen.
  const byId = new Map(capexBase.assetSeries.map((s) => [s.assetId, s.name] as const));
  const disagree = capexBase.inputAssets.filter((r) => byId.get(r.assetId) !== r.assetName);
  check('C4 Capex OUTPUT calls each asset exactly what Capex INPUT calls it',
    disagree.length === 0, disagree.map((r) => `${r.assetName} vs ${byId.get(r.assetId)}`).join('; '));

  const ctx: AssetLabelContext = { parcels: base.parcels, phases: base.phases };
  const wrong = capexBase.inputAssets.filter((r) => {
    const a = base.assets.find((x: { id: string }) => x.id === r.assetId);
    return a !== undefined && r.assetName !== assetLabel(a, ctx);
  });
  check('C5 and both call it what the ONE label function says',
    wrong.length === 0, wrong.map((r) => r.assetName).join('; '));

  section('D. The workbook');
  const scan = (state: unknown): { empties: number; cells: number; labels: string[] } => {
    const wb = buildModelWorkbook({ state, displayScale: 'full', displayDecimals: 0 } as never);
    let empties = 0, cells = 0;
    const labels: string[] = [];
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => row.eachCell({ includeEmpty: true }, (cell) => {
        cells += 1;
        const v = cell.value;
        if (typeof v !== 'string') return;
        if (v === '') empties += 1;
        labels.push(v);
      }));
    }
    return { empties, cells, labels };
  };
  const wbBase = scan(base);
  const wbRenamed = scan(renamed);
  check('D1 the workbook scan reached the whole book', wbBase.cells > 5000, `${wbBase.cells} cells`);
  check('D2 renaming every asset changes no cell in the workbook',
    wbBase.labels.join('|') === wbRenamed.labels.join('|'));
  check('D3 the invented marker never appears, so no read fell through to the stored field',
    !wbBase.labels.some((l) => l.includes('ZZ')) && !wbRenamed.labels.some((l) => l.includes('ZZ')));
  check('D4 no label is only whitespace',
    !wbBase.labels.some((l) => l.length > 0 && l.trim() === ''));
  check('D5 the old invented "Asset N" shape is nowhere in the output',
    !wbBase.labels.some((l) => /^Asset \d+$/.test(l.trim())));

  const wbSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts', 'utf8');
  check('D6 the workbook looks an asset up by ID, never by matching a display label',
    !wbSrc.includes('a.name === m.name') && wbSrc.includes('capex.assetSeries.map((x) => [x.assetId'));
}

/**
 * THE CAPEX SUMMARY AND THE ASSETS TAB'S TABLE 4 ARE THE SAME LINES.
 *
 * Not "the same rule restated": the summary calls the consolidation's own
 * grouping function, so a change to what a line is moves both. What this pins
 * is that it does, that every asset lands in exactly one row, and that the rows
 * still foot to the project total the snapshot carries.
 */
function summaryChecks(): void {
  section('E. The capex summary consolidates by the same key as table 4');
  const state = buildExcelSampleState();
  const snap = computeFinancialsSnapshot(state);
  const capex = buildCapexReport(snap, state);

  const lines = groupAssetsForConsolidation(state.assets, state.phases.map((p: { id: string }) => p.id), normaliseAssetTypeId);
  const summaries = capex.results.filter((t) => t.title.startsWith('Total Capex') || t.title.startsWith('Capex excl.'));
  check('E1 the three summary tables are present', summaries.length === 3, `${summaries.length}`);

  // A BODY ROW IS NOT A SUBTOTAL (2026-09-12). These tables gained a per-phase
  // subtotal on 2026-09-11 and every check below summed and inspected them as
  // if they were rows, so E2 read a subtotal's label and E4 counted every
  // phase twice. The same defect was found and fixed in verify-capex-report on
  // the day the subtotals landed; this file was not re-aimed with it.
  const rowsOf = (t: { rows: { label: string; isTotal?: boolean; isSubtotal?: boolean; values: number[] }[] }) =>
    t.rows.filter((r) => !r.isTotal && !r.isSubtotal);
  const lineLabels = new Set(lines.map((g) => g.typeLabel));
  // THE PHASE RIDES IN FRONT OF THE LABEL on a multi-phase project, because an
  // M4Row has one label column and no room for a phase column.
  const withoutPhase = (label: string): string => {
    const i = label.indexOf(': ');
    return i < 0 ? label : label.slice(i + 2);
  };
  const first = summaries[0];
  check('E2 every summary row is a LINE label, not an asset label',
    rowsOf(first).every((r) => lineLabels.has(withoutPhase(r.label)) || withoutPhase(r.label).endsWith('(Retail)')),
    rowsOf(first).map((r) => r.label).join(' | '));
  check('E3 no summary row repeats, so two lines cannot print as one',
    new Set(rowsOf(first).map((r) => r.label)).size === rowsOf(first).length);

  for (const t of summaries) {
    const total = t.rows.find((r) => r.isTotal);
    if (!total) { check(`E4 ${t.title} has a total row`, false); continue; }
    const N = total.values.length;
    const summed = new Array<number>(N).fill(0);
    for (const r of rowsOf(t)) for (let i = 0; i < N; i++) summed[i] += r.values[i] ?? 0;
    const worst = Math.max(...summed.map((v, i) => Math.abs(v - (total.values[i] ?? 0))), 0);
    check(`E4 ${t.title}: the consolidated rows still foot to the project total`,
      worst < 0.01, `max residue ${worst.toFixed(4)}`);
  }

  // THE ONE THING GROUPING COULD LOSE. `groupAssetsForConsolidation` excludes
  // companions by design, and the retail companion has carried its own cost
  // lines since consolidation step 6. If it were dropped it would still be in
  // the total, so E4 above is what catches the money; this pins that every
  // asset the report costed has somewhere to be.
  //
  // RE-AIMED 2026-09-12: it read the BUILDER'S SOURCE for one exact line,
  // `if (grouped.has(ac.assetId)) continue;`, which stopped existing when the
  // row planner was extracted, so it failed on a refactor that lost nothing.
  {
    // Nothing the report costed may be left out of the rows.
    const costed = new Set(capex.inputAssets.map((a) => a.assetId));
    const placed = new Set(
      planCapexSummaryLines(state.assets as never, state.phases, (id) => id).flatMap((l) => l.assetIds),
    );
    const missing = [...costed].filter((id) => !placed.has(id));
    check('E5 an asset in no consolidation group keeps its own row rather than vanishing',
      missing.length === 0, missing.join(', '));
    // AND THE COMPANION SPECIFICALLY, because the fixture has none and a check
    // that cannot see the case it is about is not a check: removing the
    // companion branch outright left this green until the case was built.
    const host = state.assets[0] as { id: string; phaseId: string; type?: string };
    const cid = retailCompanionId(consolidationKey(host as never, normaliseAssetTypeId));
    const withCompanion = [
      ...(state.assets as unknown as Record<string, unknown>[]),
      { id: cid, phaseId: host.phaseId, type: host.type, strategy: 'Lease', visible: true, isCompanion: true, companionType: 'retail' },
    ];
    const plan = planCapexSummaryLines(withCompanion as never, state.phases, (id) => id);
    const row = plan.find((l) => l.assetIds.includes(cid));
    check('E5b the retail companion gets its own row, beside the line it carves from',
      row !== undefined && row.isCompanion === true && row.assetIds.length === 1
      && plan.findIndex((l) => l.key === cid) === plan.findIndex((l) => l.assetIds.includes(host.id)) + 1,
      plan.map((l) => `${l.phaseName}:${l.label}`).join(' | '));
  }

  // TABLE 1 IS THE LINE'S SCHEDULE, WITH ITS PLOTS INSIDE IT (2026-09-12).
  //
  // RE-AIMED, and this one is today's: E6 asserted the TABLE'S TITLE STRING,
  // "per cost line, per asset". Table 1 was grouped by line on 2026-09-11 and
  // the title changed with it, so the check failed on a shape it was never
  // asked about. It now reads the rows.
  {
    const t1 = capex.results[0];
    const lineHeads = t1.rows.filter((r) => r.isSection && (r.indent ?? 0) === 0);
    const lineSubs = t1.rows.filter((r) => r.isSubtotal && (r.indent ?? 0) === 0);
    check('E6 table 1 is grouped by LINE, and every line heads and closes its own block',
      lineHeads.length > 0 && lineHeads.length === lineSubs.length,
      `${lineHeads.length} headings, ${lineSubs.length} line subtotals`);
    // A PLOT NESTS UNDER ITS LINE, never beside it: nothing at indent 1 may
    // appear before a line has opened.
    let opened = false;
    let orphan = false;
    for (const r of t1.rows) {
      if (r.isSection && (r.indent ?? 0) === 0) { opened = true; continue; }
      if ((r.indent ?? 0) >= 1 && !opened) orphan = true;
    }
    check('E6b nothing is printed outside a line', !orphan);
  }
}

/**
 * LIVE. What every asset on every real project is called, and whether any two
 * of them are called the same thing.
 */
async function liveChecks(): Promise<void> {
  section('F. Live: the label on every asset of every project');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('F0 credentials present', false, 'missing'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let assets = 0, empty = 0, collisions = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as
      { snapshot: { assets?: Parameters<typeof assetLabel>[0][]; parcels?: { id: string; name?: string }[]; phases?: { id: string; name?: string }[] } }[];
    const snap = vs[0]?.snapshot;
    if (!snap?.assets?.length) continue;
    const ctx: AssetLabelContext = { parcels: snap.parcels ?? [], phases: snap.phases ?? [] };
    const seen = new Map<string, number>();
    for (const a of snap.assets) {
      assets += 1;
      const l = assetLabel(a, ctx);
      if (l.trim() === '' || l === UNNAMED_ASSET) empty += 1;
      seen.set(l, (seen.get(l) ?? 0) + 1);
    }
    for (const [l, n] of seen) if (n > 1) { collisions += 1; console.log(`     collision on ${p.name}: ${n} x "${l}"`); }
  }
  // RE-AIMED 2026-09-12: the founder deleted FMP RE HUB, so one live project carries assets; the census asks for at least one.
  check('F1 the census reached the live assets', assets >= 6, `${assets} assets`);
  check('F2 no live asset resolves to nothing', empty === 0, `${empty} unnamed`);
  check('F3 no two assets on one project are called the same thing', collisions === 0, `${collisions} collisions`);
}

async function main(): Promise<void> {
  console.log('=== verify-asset-label ===');
  ruleChecks();
  retirementChecks();
  outputChecks();
  summaryChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
