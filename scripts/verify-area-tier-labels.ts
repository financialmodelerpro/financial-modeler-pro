/**
 * verify-area-tier-labels: EVERY SURFACE THAT PRINTS GFA OR BUA PRINTS THE SUM THE WORD MEANS.
 *
 * The platform's area fields swap the two outer tiers against the industry words
 * (platform `bua` = Total GFA, parking excluded; platform `gfa` = Total BUA, parking
 * included). Twice a surface printed a field under its NAME rather than its MEANING:
 * the cost method labels (fixed 2026-09-11, `verify-capex-structure` P4h) and then the
 * Summary, the Project Overview, the PDF, the IC deck, Table 7 and the IDC basis
 * (2026-09-29: Total GFA 105,940 and BUA 89,380 on the Summary while Land & Area said
 * the reverse, and a plot ratio of BUA over land, 2.86 where GFA over land is 2.42).
 *
 * So nothing here asks what a figure is CALLED in code. Each check takes the WORD a
 * surface prints and asserts the figure beside it equals the sum that word means,
 * measured from the area rule on the live model: GFA = NSA + support, BUA = GFA +
 * parking. A1 proves the live model can tell the two apart (were they equal, every
 * check below would pass inverted). Surfaces: the one rule (areaTiers), the Overview
 * builder (the screen, the PDF and the workbook Summary print it), the workbook's
 * Summary and Land & Area sheets by the words in their cells, the PDF by its text,
 * every IC deck metric whose label names a tier, Table 7's columns, the IDC basis
 * and the activity log's words.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-area-tier-labels.ts
 */
import { readFileSync } from 'node:fs';
import { loadLiveExportInputs } from './fixtures/liveExportInputs';
import { pdfText } from './pdfTextExtract';
import { resolveAssetAreaMetrics, computeAssetLandBreakdown } from '../src/core/calculations';
import { areaTiers } from '../src/core/calculations/areaTiers';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildOverviewReport } from '../src/hubs/modeling/platforms/refm/lib/reports/overviewReport';
import { buildCostPerSqmReport, AREA_BASES } from '../src/hubs/modeling/platforms/refm/lib/reports/costPerSqmReport';
import { buildICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { METRIC_KEYS, resolveMetric, type DeckFmt } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { buildModelWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { buildFormulaWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook';
import { generateProjectPdf, generateSummaryPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { buildIdcAllocationTables } from '../src/hubs/modeling/platforms/refm/lib/reports/financingReports';
import { SUB_UNIT_CATEGORIES } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const quiet = <T,>(f: () => T): T => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };
const near = (a: number, b: number, tol = 0.5): boolean => Math.abs(a - b) <= tol;
const int = (v: number): string => Math.round(v).toLocaleString('en-US');
/** The tier a printed WORD means. "BUA" is checked first: "Total BUA" never names GFA. */
const tierOfWord = (label: string): 'bua' | 'gfa' | null => (/\bBUA\b/.test(label) ? 'bua' : /\bGFA\b/.test(label) && !/Main Asset GFA|Retail GFA|Lobby/i.test(label) ? 'gfa' : null);

(async () => {
  console.log('=== verify-area-tier-labels ===');
  const input = await loadLiveExportInputs();
  const st: any = input.state;
  const vis = st.assets.filter((a: any) => a.visible !== false);
  const metricsOf = (a: any) => resolveAssetAreaMetrics(a, st.project, st.parcels, vis.filter((x: any) => x.phaseId === a.phaseId), st.subUnits, st.landAllocationMode);
  const byId = new Map<string, ReturnType<typeof areaTiers>>(vis.map((a: any) => [a.id, areaTiers(metricsOf(a))]));
  const sumOf = (ids: string[], k: 'nsaSqm' | 'totalGfaSqm' | 'totalBuaSqm'): number => ids.reduce((s, id) => s + (byId.get(id)?.[k] ?? 0), 0);
  const ids = vis.map((a: any) => a.id);
  const NSA = sumOf(ids, 'nsaSqm'), GFA = sumOf(ids, 'totalGfaSqm'), BUA = sumOf(ids, 'totalBuaSqm');
  const LAND = vis.reduce((s: number, a: any) => s + computeAssetLandBreakdown(a, st.parcels, vis, st.subUnits, st.landAllocationMode).landSqm, 0);
  const want = (t: 'bua' | 'gfa'): number => (t === 'gfa' ? GFA : BUA);
  console.log(`  ${input.projectName}: land ${int(LAND)}, NSA ${int(NSA)}, GFA ${int(GFA)}, BUA ${int(BUA)}`);

  // ── A. The rule, and that the live model can tell the tiers apart ─────────────
  check('A1 the live model has parking, so GFA and BUA differ and an inversion is visible', BUA - GFA > 1, `GFA ${int(GFA)} BUA ${int(BUA)}`);
  const arith = vis.filter((a: any) => { const m = metricsOf(a), t = areaTiers(m); return !(t.nsaSqm <= t.totalGfaSqm + 0.5 && near(t.totalBuaSqm - t.totalGfaSqm, m.parkingArea + m.retailParkingArea)); });
  check('A2 the rule is arithmetic on every asset: NSA within GFA, and BUA is GFA plus its parking', arith.length === 0, arith.map((a: any) => a.id).join(', '));

  // ── B. The Overview builder (the Overview screen, the PDF and the Summary print it) ─
  const snap: any = quiet(() => computeFinancialsSnapshot(st));
  const rs: any = quiet(() => computeReturnsSnapshot(snap, st.project));
  const ov = quiet(() => buildOverviewReport(snap, rs, st));
  check('B1 the figure the Overview prints as Total GFA is GFA', near(ov.scheme.gfaSqm, GFA), `${int(ov.scheme.gfaSqm)} vs ${int(GFA)}`);
  check('B2 the figure it prints as BUA is BUA', near(ov.scheme.buaSqm, BUA), `${int(ov.scheme.buaSqm)} vs ${int(BUA)}`);
  check('B3 the plot ratio is GFA over land', ov.scheme.plotRatio !== null && Math.abs(ov.scheme.plotRatio - GFA / LAND) < 1e-9, `${ov.scheme.plotRatio} vs ${GFA / LAND}`);
  check('B4 the type table\'s GFA column sums to GFA', near(ov.byType.reduce((s: number, t: any) => s + t.gfaSqm, 0), GFA));
  check('B5 the phase table\'s GFA column sums to GFA', near(ov.phases.reduce((s: number, p: any) => s + p.gfaSqm, 0), GFA));
  check('B6 cost per sqm of GFA divides by GFA', near(ov.costPerSqm.gfaSqm, GFA));
  // The two screens print the builder's fields under these words (the numbers are B1 to B3).
  const screen = readFileSync('src/hubs/modeling/platforms/refm/components/Overview.tsx', 'utf8');
  check('B7 the Overview screen prints ov.scheme.gfaSqm as Total GFA and buaSqm as BUA',
    /label="Total GFA" value=\{`\$\{area\(ov\.scheme\.gfaSqm\)\} sqm`\} sub=\{`BUA \$\{area\(ov\.scheme\.buaSqm\)\}`\}/.test(screen));

  // ── C. The workbook, by the words in its cells ────────────────────────────────
  const opts = { state: input.state, projectName: input.projectName, dateLabel: 'verify', caseComparison: input.caseComparison, parties: input.parties, includeSensitivity: true } as any;
  const plain = quiet(() => buildModelWorkbook(opts));
  const { registry } = quiet(() => buildFormulaWorkbook(opts));
  const cellAt = (key: string): unknown => { const a = registry.need(key); return plain.getWorksheet(a.sheet)!.getCell(a.row, a.col).value; };
  check('C1 the Summary prints GFA beside the words Total GFA', String(cellAt('sum|tile|Total GFA')) === `${int(GFA)} sqm`, String(cellAt('sum|tile|Total GFA')));
  check('C2 and BUA beside the word BUA', String(cellAt('sum|tilesub|Total GFA')) === `BUA ${int(BUA)}`, String(cellAt('sum|tilesub|Total GFA')));
  check('C3 its plot ratio is GFA over land', String(cellAt('sum|tile|Plot ratio')) === `${(GFA / LAND).toFixed(2)}x`, String(cellAt('sum|tile|Plot ratio')));
  // Land & Area: every column headed Total GFA or Total BUA, on the plots' total row.
  const la = plain.getWorksheet('Land & Area')!;
  const totRow = registry.need('chaintot:plots:bua').row;
  const heads: Array<{ col: number; word: string }> = [];
  la.eachRow((row, r) => { if (r >= totRow) return; row.eachCell((c, col) => { const v = String(c.value ?? ''); if (/^Total (GFA|BUA) \(sqm\)$/.test(v)) heads.push({ col, word: v }); }); });
  const laBad = heads.filter((h) => !near(Number(la.getCell(totRow, h.col).value), want(tierOfWord(h.word)!)));
  check('C4 Land & Area: each column headed Total GFA or Total BUA totals to that tier', heads.length >= 2 && laBad.length === 0,
    `${heads.length} headed; ${laBad.map((h) => `${h.word} = ${la.getCell(totRow, h.col).value}`).join('; ')}`);

  // ── D. The PDF, by its text ───────────────────────────────────────────────────
  const PUA: Record<string, string> = { '': '(', '': ')', '': '-', '': ':' };
  const decode = (b: Uint8Array): string => pdfText(b).replace(/[-]/g, (c) => PUA[c] ?? '?').replace(/\s+/g, ' ');
  const common = { ...opts, displayScale: 'millions' };
  const pdf = decode(await quiet(() => generateProjectPdf({ ...common, selectedModuleKeys: ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'] })))
    + ' ' + decode(await quiet(() => generateSummaryPdf({ ...common, selectedModuleKeys: [] })));
  check('D1 the PDF prints BUA beside the word BUA, never GFA there', pdf.includes(`BUA ${int(BUA)}`) && !pdf.includes(`BUA ${int(GFA)}`));
  check('D2 the PDF prints GFA as the Total GFA figure', pdf.includes(`${int(GFA)} sqm`));
  check('D3 the PDF plot ratio is GFA over land', pdf.includes(`${(GFA / LAND).toFixed(2)}x`) && !pdf.includes(`${(BUA / LAND).toFixed(2)}x`));

  // ── E. The IC deck: every metric whose label names a tier ─────────────────────
  const ic: any = quiet(() => buildICReportModel({ project: st.project, phases: st.phases, parcels: st.parcels, assets: st.assets, subUnits: st.subUnits, landAllocationMode: st.landAllocationMode, rs, snap, parties: input.parties ?? [], asOf: '2026-09-29', cases: st.cases ?? [{ id: 'base' }] }));
  const f = (v: number | null | undefined): string => String(v ?? '');
  const fmt: DeckFmt = { money: f, moneyUnit: 'SAR', pct: f, mult: f, int: f, scaleValue: (v) => v };
  const tiered = METRIC_KEYS.map((k) => ({ k, r: resolveMetric(k, ic, fmt) })).filter((x) => x.r.available && tierOfWord((x.r as any).value.label));
  const deckBad = tiered.filter((x) => { const v = (x.r as any).value; return !near(v.raw ?? 0, want(tierOfWord(v.label)!)); });
  check('E1 every deck metric labelled with a tier resolves to that tier', tiered.length > 0 && deckBad.length === 0,
    `${tiered.length} tiered; ${deckBad.map((x) => `${x.k} "${(x.r as any).value.label}" = ${(x.r as any).value.raw}`).join('; ')}`);
  check('E2 the deck\'s BUA-by-strategy chart sums to BUA', near(ic.assetMix.byStrategy.reduce((s: number, x: any) => s + x.bua, 0), BUA));

  // ── F. Table 7: each column's word against the line's own members ─────────────
  const cps = quiet(() => buildCostPerSqmReport(snap, st));
  const t7Bad: string[] = [];
  for (const base of AREA_BASES) {
    const tier = base.label === 'NSA' ? 'nsaSqm' : tierOfWord(base.label) === 'gfa' ? 'totalGfaSqm' : tierOfWord(base.label) === 'bua' ? 'totalBuaSqm' : null;
    if (!tier) { t7Bad.push(`no tier for "${base.label}"`); continue; }
    for (const l of cps.lines) if (!near(l.area[base.key], sumOf(l.memberIds, tier))) t7Bad.push(`${l.label} "${base.label}" ${int(l.area[base.key])} vs ${int(sumOf(l.memberIds, tier))}`);
  }
  check('F1 Table 7: the column headed GFA divides by GFA and the one headed BUA by BUA, on every line', cps.lines.length > 0 && t7Bad.length === 0, t7Bad.slice(0, 4).join('; '));

  // ── G. The IDC basis: its area is the sub-units, which hold no parking ────────
  check('G1 no sub-unit category is parking, so a sub-unit sum is at most GFA', !SUB_UNIT_CATEGORIES.some((c) => /park/i.test(c)));
  const buaCase = { ...st, project: { ...st.project, idcConfig: { ...(st.project.idcConfig ?? {}), allocationBasis: 'bua' } } };
  const idcTables = quiet(() => buildIdcAllocationTables(computeFinancialsSnapshot(buaCase), buaCase, (v) => String(v)));
  const idcText = JSON.stringify(idcTables.filter((t: any) => /IDC Allocation/.test(t.title)));
  check('G2 so the IDC area basis is named GFA wherever it prints, never BUA', idcText.includes('GFA Area') && !/BUA (Area|share|\d)/.test(idcText));

  // ── H. The activity log: a typed override names the tier it overrides ─────────
  const probe = { ...vis[0], derivedAreas: undefined, gfaSqm: 9_999_999 };
  const over = areaTiers(resolveAssetAreaMetrics(probe, st.project, st.parcels, vis.map((a: any) => (a.id === probe.id ? probe : a)).filter((x: any) => x.phaseId === probe.phaseId), st.subUnits, st.landAllocationMode));
  const words = readFileSync('src/hubs/modeling/platforms/refm/lib/persistence/changeLabel.ts', 'utf8');
  const overrideWord = /    gfaSqm: '([^']+)'/.exec(words)?.[1] ?? '';
  check('H1 Asset.gfaSqm overrides the outer tier, and the log calls it BUA', near(over.totalBuaSqm, 9_999_999) && tierOfWord(overrideWord) === 'bua', `${overrideWord}: BUA ${int(over.totalBuaSqm)}`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  for (const x of failures) console.log(`  - ${x}`);
  process.exit(fail === 0 ? 0 : 1);
})();
