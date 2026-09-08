/**
 * verify-asset-display-name.ts (2026-09-08)
 *
 * AN ASSET WITH NO NAME IS CALLED BY ITS TYPE, everywhere, and NOTHING a user
 * typed is lost.
 *
 * WHY THIS TESTS OUTPUT RATHER THAN GREPPING FOR CALL SITES. An asset name is
 * read in more than thirty files: the resolvers, eight report builders, the
 * Excel workbook (26 reads, several of them MAP KEYS rather than labels), the
 * PDF, the deck and the AI grounding. A grep proving I edited them all proves
 * only that I edited the ones I found. So the fixture below gives one asset a
 * BLANK name and then asserts on what actually comes out: no empty label
 * anywhere, and the type appearing in its place.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-asset-display-name.ts
 *
 * No em dashes in this file.
 */

import { readFileSync } from 'node:fs';
import {
  assetDisplayName,
  assetNameIsDerived,
  withResolvedAssetNames,
  UNNAMED_ASSET,
} from '../src/core/calculations/assetName';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCapexReport } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const section = (t: string): void => { console.log(`\n== ${t} ==`); };

function offlineChecks(): void {
  section('A. The rule');
  check('A1 a typed name WINS and is returned verbatim',
    assetDisplayName({ name: 'Marina Residences', type: 'Branded Villas' }) === 'Marina Residences');
  check('A2 a blank name falls back to the type',
    assetDisplayName({ name: '', type: 'Branded Villas' }) === 'Branded Villas'
    && assetDisplayName({ type: 'Branded Villas' }) === 'Branded Villas');
  check('A3 a WHITESPACE-ONLY name is blank, not a name made of spaces',
    assetDisplayName({ name: '   ', type: 'Branded Villas' }) === 'Branded Villas');
  check('A4 no name and no type still never returns an empty string',
    assetDisplayName({}) === UNNAMED_ASSET && assetDisplayName({ name: ' ', type: ' ' }) === UNNAMED_ASSET);
  check('A5 the surface can tell a derived name from a typed one',
    assetNameIsDerived({ type: 'X' }) && !assetNameIsDerived({ name: 'A', type: 'X' }));
  check('A6 resolving a LIST leaves a named asset untouched by identity, not just by value',
    (() => {
      const named = { id: '1', name: 'Keep me', type: 'T' };
      const blank = { id: '2', name: '', type: 'Branded Villas' };
      const out = withResolvedAssetNames([named, blank]);
      return out[0] === named && out[1] !== blank && out[1].name === 'Branded Villas' && blank.name === '';
    })());

  section('B. Nothing typed is lost');
  check('B1 the resolver NEVER writes: the input object keeps its blank name',
    (() => {
      const a = { id: '1', name: '', type: 'Branded Villas' };
      assetDisplayName(a);
      withResolvedAssetNames([a]);
      return a.name === '';
    })());
  const tabSrc = readFileSync('src/hubs/modeling/platforms/refm/components/modules/Module1Assets.tsx', 'utf8');
  check('B2 the name INPUT binds the raw value, with the derived name only as a placeholder',
    /value=\{asset\.name\}/.test(tabSrc)
    && /placeholder=\{assetDisplayName\(asset\)\}/.test(tabSrc));
  check('B3 the factory seeds a BLANK name, not an invented one',
    /name: '',/.test(tabSrc) && !/name: `Asset \$\{phaseAssetCount/.test(tabSrc));
  check('B4 the tab says what the name is for',
    tabSrc.includes('data-testid="assets-name-note"')
    && /Schedules group by type, so the name is a label for entry only/.test(tabSrc));
  check('B5 no migration rewrites a stored name',
    !/name:\s*assetDisplayName/.test(readFileSync('src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts', 'utf8')));
}

function outputChecks(): void {
  section('C. THE OUTPUT: a blank-named asset through the engine, the builders and the workbook');
  // THE FIXTURE CARRIES NO TYPE, so the test gives the target one. That is the
  // point of the test, not a shortcut: the fallback needs something to fall
  // back TO, and asserting on an asset with neither name nor type would only
  // exercise the last-resort label.
  const TYPE = 'Branded Villas';
  const base0 = buildExcelSampleState();
  const base = { ...base0, assets: base0.assets.map((x: { name: string; type?: string }, i: number) => (i === 0 ? { ...x, type: TYPE } : x)) };
  const target = base.assets[0];
  const originalName = target.name;
  check('C0 the fixture asset has both a name and a type to distinguish',
    originalName.trim() !== '' && TYPE !== originalName);

  // THE SAME STATE, with ONE asset's name blanked. Everything else identical.
  const blanked = { ...base, assets: base.assets.map((x: { name: string; type?: string }, i: number) => (i === 0 ? { ...x, name: '' } : x)) };

  const snapNamed = computeFinancialsSnapshot(base);
  const snapBlank = computeFinancialsSnapshot(blanked);

  const capexNamed = buildCapexReport(snapNamed, base);
  const capexBlank = buildCapexReport(snapBlank, blanked);
  const blankRow = capexBlank.inputAssets.find((r) => r.assetId === target.id);
  check('C1 the capex report calls the unnamed asset by its TYPE, not by an empty string',
    blankRow !== undefined && blankRow.assetName === TYPE, `assetName="${blankRow?.assetName}"`);
  check('C2 the NAMED run is unchanged, so resolving costs a named asset nothing',
    capexNamed.inputAssets.find((r) => r.assetId === target.id)?.assetName === originalName);

  // A NAME IS A LABEL: the numbers must not move. Both runs are serialised with
  // the two labels masked, so only a NUMERIC difference can fail this.
  const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const masked = (snap: unknown): string =>
    JSON.stringify(snap, (_k, v) => (v instanceof Map ? [...v.entries()] : v))
      .replace(new RegExp(esc(originalName), 'g'), 'LABEL')
      .replace(new RegExp(esc(TYPE), 'g'), 'LABEL');
  check('C3 the engine output is identical apart from the label itself',
    masked(snapNamed) === masked(snapBlank));

  // THE WORKBOOK, BUILT TWICE, and compared. A single-run assertion was not
  // enough: the capex report inside the workbook already resolves names
  // through its builder, so "the type appears somewhere" passed even with the
  // workbook's own front-door resolution deleted. The 26 places this file reads
  // an asset name DIRECTLY were still writing an empty string, and an empty
  // cell is exactly what a single-run scan cannot see.
  //
  // Comparing the two runs needs no magic number: blanking one asset's name
  // must create NO new empty cell, and must make the type appear MORE often.
  const scan = (state: unknown): { empties: number; typeHits: number; cells: number } => {
    const wb = buildModelWorkbook({ state, displayScale: 'full', displayDecimals: 0 } as never);
    let empties = 0, typeHits = 0, cells = 0;
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => row.eachCell({ includeEmpty: true }, (cell) => {
        cells += 1;
        const v = cell.value;
        if (typeof v !== 'string') return;
        if (v === '') empties += 1;
        if (v.includes(TYPE)) typeHits += 1;
      }));
    }
    return { empties, typeHits, cells };
  };
  const wbNamed = scan(base);
  const wbBlank = scan(blanked);
  check('C4 the workbook scan reached the whole book', wbNamed.cells > 5000, `${wbNamed.cells} cells`);
  check('C5 blanking a name creates NO new empty cell in the workbook',
    wbBlank.empties <= wbNamed.empties,
    `named ${wbNamed.empties} empty, blanked ${wbBlank.empties}`);
  check('C6 and the TYPE appears MORE often, in the places the name used to',
    wbBlank.typeHits > wbNamed.typeHits,
    `named ${wbNamed.typeHits}, blanked ${wbBlank.typeHits}`);
  const labels: string[] = [];
  for (const ws of buildModelWorkbook({ state: blanked, displayScale: 'full', displayDecimals: 0 } as never).worksheets) {
    ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === 'string') labels.push(cell.value); }));
  }
  check('C7 no label is only whitespace', !labels.some((l) => l.length > 0 && l.trim() === ''));
  check('C8 the old invented name shape is nowhere in the output',
    !labels.some((l) => /^Asset \d+$/.test(l.trim())));
}

/**
 * EVERY TAB THAT LISTS ASSETS RESOLVES THE NAMES, and the one tab that must not
 * is named explicitly.
 *
 * The builders and the two exports were done first, which covered the printed
 * output; the on-screen dropdowns and row labels were not, so a newly created
 * asset would have appeared as a blank option in Costs, Revenue, Opex and Fixed
 * Assets. This is structural rather than behavioural because a tab is a React
 * component: rendering one in a verifier would cost a DOM and a store, and the
 * property that matters is simply which array the file reads.
 */
function tabChecks(): void {
  section('E. Every tab that lists assets resolves the names');
  const DIR = 'src/hubs/modeling/platforms/refm/components/modules/';
  const TABS = [
    'Module1Costs.tsx', 'Module1Financing.tsx', 'Module2Revenue.tsx', 'Module2RevenueOutput.tsx',
    'Module2Schedules.tsx', 'Module3Opex.tsx', 'Module3OpexOutput.tsx', 'Module4FixedAssets.tsx',
  ];
  const unresolved: string[] = [];
  for (const t of TABS) {
    const src = readFileSync(DIR + t, 'utf8');
    // PLAIN STRING MATCHING, not a regex. The first cut built this pattern
    // inside a template literal, which ate every backslash, so `\(` became `(`
    // and the whole thing matched a group instead of a call. It failed all
    // eight tabs on correct code. A literal needs no escaping.
    const ok = src.includes('assets: rawAssets')
      && src.includes('const assets = useMemo(() => withResolvedAssetNames(rawAssets), [rawAssets]);');
    if (!ok) unresolved.push(t);
  }
  check('E1 every tab that lists assets binds the RAW list and resolves it',
    unresolved.length === 0, unresolved.join(', '));
  check('E2 the resolution is MEMOISED, not done inside the zustand selector',
    TABS.every((t) => {
      const src = readFileSync(DIR + t, 'utf8');
      // Resolving inside the selector hands useShallow a new array every
      // render, which is a re-render loop rather than a display fix.
      return !src.includes('assets: withResolvedAssetNames(s.assets)');
    }));
  // THE NEGATIVE CONTROL, and it is the important one. The Assets tab owns the
  // name INPUT, so it must keep reading the raw list: resolving there would
  // make a blank name look filled in and leave no way to clear it.
  const assetsTab = readFileSync(DIR + 'Module1Assets.tsx', 'utf8');
  check('E3 the Assets tab does NOT resolve its own list, because it owns the raw input',
    !/withResolvedAssetNames/.test(assetsTab)
    && /value=\{asset\.name\}/.test(assetsTab));
}

async function liveChecks(): Promise<void> {
  section('D. Live: every existing name is untouched');
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) { check('D0 credentials present', false, 'missing'); return; }
  const q = async (p: string): Promise<unknown[]> => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return await r.json() as unknown[];
  };
  const ps = await q('refm_projects?select=id,name&deleted_at=is.null&order=created_at') as { id: string; name: string }[];
  let assets = 0, changed = 0, blank = 0, placeholder = 0;
  for (const p of ps) {
    const vs = await q(`refm_project_versions?project_id=eq.${p.id}&select=snapshot&order=created_at.desc&limit=1`) as
      { snapshot: { assets?: { name?: string; type?: string }[] } }[];
    for (const a of vs[0]?.snapshot?.assets ?? []) {
      assets += 1;
      if ((a.name ?? '').trim() === '') blank += 1;
      if (/^Asset \d+$/.test((a.name ?? '').trim())) placeholder += 1;
      // The resolver must return exactly what is stored, for every one of them.
      if (assetDisplayName(a) !== (a.name ?? '').trim()) changed += 1;
    }
  }
  check('D1 the census reached the live assets', assets >= 13, `${assets} assets`);
  check('D2 EVERY existing asset resolves to the name it already had',
    changed === 0, `${changed} would render differently`);
  check('D3 no live asset is blank-named today, so nothing gains a derived name',
    blank === 0, `${blank} blank`);
  check('D4 no auto-generated "Asset N" placeholder is stored, so none is left behind',
    placeholder === 0, `${placeholder} placeholders`);
}

async function main(): Promise<void> {
  console.log('=== verify-asset-display-name ===');
  offlineChecks();
  outputChecks();
  tabChecks();
  await liveChecks();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
