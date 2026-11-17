/**
 * verify-export-house-style.ts (2026-11-12, export simplification step 1)
 *
 * Pins the house style BOTH workbooks wear (lib/excel/houseStyle.ts) and the builder rules
 * (lib/excel/exportScope.ts), as RULES, on the live project and on unit cases:
 *   A. exportScope: each feature switch detected both ways; the Inputs line names exactly the
 *      unused features; a one-line group earns no total.
 *   B. Each workbook, each tab: the title block (13pt navy title, Back to Cover to the Cover),
 *      the period band (#153D64) with a phase row over it, numbered section bars (#1B4F8A),
 *      key totals in CAPS on #DDE7F3 with a border above and below, subtotals #D9D9D9, inputs
 *      blue on #FFF2CC, landscape fit to width with no gridlines, every fill in ALLOWED_FILLS.
 *   C. Units: every money cell carries the chosen units' format (no stray millions format
 *      left at full or thousands), counts and per-unit rates never scale, computed
 *      percentages one decimal.
 *   D. The live workbook: a cell that only links another tab is green; the phase row reads
 *      Timeline; the Cover links every tab. Revenue's column C fits what it holds.
 *   E. No stored number differs between the scales (formatting only).
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-export-house-style.ts
 * No em dashes in this file.
 */
import ExcelJS from 'exceljs';
import { buildValuesWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/valuesWorkbook';
import { buildFormulaWorkbook } from '../src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook';
import { ALLOWED_FILLS, type DisplayScale } from '../src/hubs/modeling/platforms/refm/lib/excel/styles';
import { HOUSE, phaseLabelsFor, timelinePhaseFormula, titleCellOf } from '../src/hubs/modeling/platforms/refm/lib/excel/houseStyle';
import { featureUsed, notUsedFeatures, notUsedLine, notUsedItems, groupNeedsTotal, isZeroLine, type ScopeState } from '../src/hubs/modeling/platforms/refm/lib/excel/exportScope';
import { loadLiveExportInputs } from './fixtures/liveExportInputs';

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
type Cell = ExcelJS.Cell;
const fillOf = (c: Cell): string | undefined => (c.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
const isFormula = (v: unknown): v is { formula: string; result?: unknown } => !!v && typeof v === 'object' && typeof (v as { formula?: unknown }).formula === 'string';
const MONEY = { full: '#,##0_);(#,##0);"-"_)', thousands: '#,##0,_);(#,##0,);"-"_)', millions: '#,##0.0,,_);(#,##0.0,,);"-"_)' } as const;

function scopeCases(): void {
  console.log('A. The builder rules');
  const base: ScopeState = { project: {}, phases: [{ status: 'construction' }], assets: [{ opex: { lines: [{ value: 5 }] } }], financingTranches: [] };
  const on = (patch: Partial<ScopeState['project']>): ScopeState => ({ ...base, project: { ...base.project, ...patch } });
  check('A1 escrow at 0% is not used; a held % or a line override is', !featureUsed(base, 'escrow') && featureUsed(on({ escrow: { heldPct: 0.04 } }), 'escrow')
    && featureUsed({ ...base, assets: [{ revenue: { sell: { escrow: { heldPctOverride: 0.1 } } } }] }, 'escrow'));
  check('A2 payables at 0 days are not used; a project or line DPO is', !featureUsed(base, 'payables') && featureUsed(on({ opexAp: { defaultApDays: 30 } }), 'payables')
    && featureUsed({ ...base, assets: [{ opex: { apDaysOverride: 45 } }] }, 'payables'));
  check('A3 a zero statutory reserve is not used', !featureUsed(base, 'statutoryReserve') && featureUsed(on({ statutoryReserve: { transferRate: 0.1 } }), 'statutoryReserve'));
  check('A4 HQ with every line zero (the default seed) is not used; a typed HQ line is', !featureUsed(base, 'hq') && featureUsed(on({ hqOpex: { lines: [{ id: 'x', value: 100 }] } }), 'hq'));
  check('A5 an existing position: an operational phase, an existing loan or opening cash', !featureUsed(base, 'existing')
    && featureUsed({ ...base, phases: [{ status: 'operational' }] }, 'existing')
    && featureUsed({ ...base, financingTranches: [{ origin: 'existing' }] }, 'existing') && featureUsed(on({ historicalOpeningCash: 1 }), 'existing'));
  // Every feature the builder knows (receivables and the tax payable joined the list after step 1, 2026-11-17).
  const used: ScopeState = { project: { escrow: { heldPct: 0.05 }, opexAp: { defaultApDays: 30 }, statutoryReserve: { transferRate: 0.1 }, hqOpex: { lines: [{ value: 1 }] }, operatingAr: { dsoDays: 30 }, tax: { paymentDays: 90 } } as ScopeState['project'], phases: [{ status: 'operational' }], assets: [{ opex: { lines: [{ value: 3 }] } }] };
  check('A6 a model using everything carries no Inputs line', notUsedLine(used) === '' && notUsedFeatures(used).length === 0);
  const line = notUsedLine(base);
  check('A7 the Inputs line names what is off and says how to turn it on', line.startsWith('Not used in this project: ') && line.includes('escrow') && line.includes('HQ') && line.endsWith('Turn on in the platform and re-export.'), line);
  check('A8 a one-line group shows once; a zero line is all zeros', !groupNeedsTotal(1) && groupNeedsTotal(2) && isZeroLine([0, 0, null]) && !isZeroLine([0, 1]));
  const labels = phaseLabelsFor([{ start: 2027, cp: 3, op: 5 }, { start: 2029, cp: 2, op: 4 }], 2027, 9, 8);
  check('A9 the phase of each year follows the Timeline flags (construction, both, operations, exit)',
    JSON.stringify(labels) === JSON.stringify(['Construction', 'Construction', 'Construction', 'Build + Ops', 'Operations', 'Operations', 'Operations', 'Operations', 'Exit year']), labels.join(','));
  check('A10 the Timeline phase formula reads the flag rows and names the exit year', timelinePhaseFormula('F', { con: [20, 25], ops: [22, 27], exit: 30 }) === 'IF(F$30=1,"Exit year",IF(F$20+F$25>0,IF(F$22+F$27>0,"Build + Ops","Construction"),IF(F$22+F$27>0,"Operations","")))');
}

function workbookRules(label: string, wb: ExcelJS.Workbook, scale: DisplayScale, live: boolean): void {
  console.log(`B-D. ${label}`);
  let periodTabs = 0;
  const badFill: string[] = [], noTitle: string[] = [], noBack: string[] = [], badBand: string[] = [], noPhase: string[] = [], badBar: string[] = [], badTotal: string[] = [], badInput: string[] = [], badPage: string[] = [], badMoney: string[] = [], badPct: string[] = [], scaledCount: string[] = [], blackLinks: string[] = [];
  for (const ws of wb.worksheets) {
    if (ws.pageSetup.orientation !== 'landscape' || ws.pageSetup.fitToWidth !== 1 || ws.views?.some((v) => v.showGridLines !== false)) badPage.push(ws.name);
    if (ws.name !== 'Cover') {
      const t = titleCellOf(ws);
      // THE TITLE BLOCK (2026-11-17, founder; re-aimed from "a 13pt navy title"): row 1 the model line, bold navy
      // 14pt and not a link; row 2 the tab's name.
      const tc = typeof ws.getCell(1, 1).value === 'string' ? 1 : 2; // the Guide is framed in column B
      const t1 = ws.getCell(1, tc), t2 = ws.getCell(2, tc);
      if (typeof t1.value !== 'string' || (t1.font?.size ?? 0) !== 14 || !t1.font?.bold || t1.font?.color?.argb !== HOUSE.band || t2.value !== ws.name || !t) noTitle.push(ws.name);
      let back = false;
      // The tab frame (step 2) puts the link beside the tab's name in row 2, as "<- Back to Cover".
      for (const rr of [1, 2]) ws.getRow(rr).eachCell((c) => { const v = c.value as { hyperlink?: string; text?: string } | null; if (v && typeof v === 'object' && v.hyperlink === "#'Cover'!A1" && /Back to Cover$/.test(v.text ?? '')) back = true; });
      if (!back) noBack.push(ws.name);
    }
    // THE FRAME (step 2; re-aimed 2026-11-17: this read row 3, where no year has been since, so B4/B5 checked no tab
    // and passed): the years are in row 4 under the navy band, each year's phase in row 5 under it.
    let yc = 0; ws.getRow(4).eachCell((c, col) => { if (!yc && c.numFmt === '"Dec "0') yc = col; });
    const timed = yc > 0;
    if (timed) {
      periodTabs++;
      if (fillOf(ws.getCell(4, yc)) !== HOUSE.band || fillOf(ws.getCell(4, 1)) !== HOUSE.band) badBand.push(ws.name);
      const p = ws.getCell(5, yc).value as unknown;
      const txt = isFormula(p) ? p.result : p;
      let anyFormula = false;
      ws.eachRow((row, r) => { if (r > 5) row.eachCell((c, col) => { if (col >= yc && isFormula(c.value)) anyFormula = true; }); });
      // A live tab with formulas links Timeline's phase row; a tab that is values by design keeps the label as a value.
      const linked = isFormula(p) && /^Timeline![A-Z]{1,3}\$5$/.test(p.formula);
      if (typeof txt !== 'string' || !txt || (live && ws.name !== 'Timeline' && anyFormula !== linked)) noPhase.push(`${ws.name} (${JSON.stringify(p)?.slice(0, 40)})`);
    }
    ws.eachRow((row, r) => {
      const a = row.getCell(1);
      row.eachCell({ includeEmpty: true }, (c) => { const f = fillOf(c); if (f && !ALLOWED_FILLS.has(f) && f !== 'FFF1F3F7') badFill.push(`${ws.name}!${c.address} ${f}`); });
      if (r >= 3 && fillOf(a) === HOUSE.bar && typeof a.value === 'string' && ws.name !== 'Cover') {
        let figures = 0, texts = 0; row.eachCell((c, col) => { if (col >= 2 && (typeof c.value === 'number' || isFormula(c.value))) figures++; if (typeof c.value === 'string' && c.value) texts++; });
        // A row with several headings is a table's column head, not a section bar.
        if (!figures && texts === 1 && !/^\d+(\.\d+)?\.? /.test(a.value) && !(timed && r <= 4) && a.font?.color?.argb === HOUSE.white && a.font?.bold && !(row.getCell(2).fill && fillOf(row.getCell(2)) === HOUSE.bar && row.getCell(2).value)) badBar.push(`${ws.name}!A${r} ${a.value.slice(0, 30)}`);
      }
      if (fillOf(a) === HOUSE.total && typeof a.value === 'string' && a.font?.bold) {
        let figures = 0; row.eachCell((c, col) => { if (col >= 2 && (typeof c.value === 'number' || isFormula(c.value))) figures++; });
        if (figures && (a.value !== a.value.toUpperCase() || a.border?.top?.style !== 'thin' || a.border?.bottom?.style !== 'thin' || a.font?.color?.argb !== HOUSE.band)) badTotal.push(`${ws.name}!A${r} ${a.value.slice(0, 30)}`);
      }
      row.eachCell({ includeEmpty: false }, (c) => {
        const f = fillOf(c);
        if (f === HOUSE.input && (c.font?.color?.argb !== HOUSE.inputText || c.border?.top?.style !== 'dotted')) badInput.push(`${ws.name}!${c.address}`);
        const nf = c.numFmt ?? '';
        if (/_\(\*/.test(nf)) badMoney.push(`${ws.name}!${c.address} ${nf}`);
        // A scaled format (trailing commas) is money, and money is in the chosen units only.
        if (/0,+_\)/.test(nf) && nf !== MONEY[scale]) badMoney.push(`${ws.name}!${c.address} ${nf}`);
        if (/%|"x"|^0\.0/.test(nf) && /0,/.test(nf)) scaledCount.push(`${ws.name}!${c.address} ${nf}`);
        // A Capex curve's window total is its typed shares added (100), shown with a % sign (2026-11-17, founder).
        const windowTotal = ws.name === 'Capex' && nf === '0.0"%";-0.0"%";"-"';
        if (/%/.test(nf) && f !== HOUSE.input && nf !== '0.0%;(0.0%);"-"' && nf !== '@' && !windowTotal) badPct.push(`${ws.name}!${c.address} ${nf}`);
        if (live && isFormula(c.value) && /^-?(?:'(?:[^']|'')+'|[A-Za-z0-9_&.]+)!\$?[A-Z]{1,3}\$?\d+$/.test(c.value.formula) && !f && c.font?.color?.argb === HOUSE.calc) blackLinks.push(`${ws.name}!${c.address}`);
      });
    });
  }
  const s = (l: string[]): string => `${l.length}: ${l.slice(0, 5).join('; ')}`;
  check(`B1 ${label}: every fill is in the house palette`, !badFill.length, s(badFill));
  check(`B2 ${label}: every tab opens with the model line (14pt bold navy, not a link) and its own name under it`, !noTitle.length, s(noTitle));
  check(`B3 ${label}: every tab links Back to Cover`, !noBack.length, s(noBack));
  check(`B4 ${label}: every period tab's band is #153D64 (${periodTabs} period tabs)`, !badBand.length && periodTabs >= 8, s(badBand));
  check(`B5 ${label}: every period tab names each year's phase above the band${live ? ', linked to Timeline' : ''}`, !noPhase.length, s(noPhase));
  check(`B6 ${label}: every section bar is numbered`, !badBar.length, s(badBar));
  check(`B7 ${label}: every key total is CAPS, navy on light blue, bordered above and below`, !badTotal.length, s(badTotal));
  check(`B8 ${label}: every input is blue on yellow with dotted borders`, !badInput.length, s(badInput));
  check(`B9 ${label}: every tab prints landscape, fit to width, without gridlines`, !badPage.length, s(badPage));
  check(`C1 ${label}: no accounting format is left; money carries the ${scale} format`, !badMoney.length, s(badMoney));
  check(`C2 ${label}: no count, factor, multiple or percentage is scaled`, !scaledCount.length, s(scaledCount));
  check(`C3 ${label}: computed percentages show one decimal`, !badPct.length, s(badPct));
  if (live) check(`D1 ${label}: a cell that only links another tab is green`, !blackLinks.length, s(blackLinks));
}

function numbers(wb: ExcelJS.Workbook): Map<string, number> {
  const out = new Map<string, number>();
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
    const v = c.value as unknown; const n = isFormula(v) ? v.result : v;
    if (typeof n === 'number') out.set(`${ws.name}!${c.address}`, n);
  }));
  return out;
}

async function main(): Promise<void> {
  scopeCases();
  const live = await loadLiveExportInputs();
  const common = { state: live.state, projectName: live.projectName, dateLabel: '12 November 2026', caseComparison: live.caseComparison ?? undefined, parties: live.parties as never, includeSensitivity: true };
  const byScale = new Map<DisplayScale, { values: Map<string, number>; live: Map<string, number> }>();
  for (const scale of ['full', 'thousands', 'millions'] as const) {
    // THE VALUES FILE AS SHIPPED (re-aimed 2026-11-17): the values workbook the platform exports, framed like the
    // live one, not the classic layout no route ships any more.
    const v = buildValuesWorkbook({ ...common, displayScale: scale }).wb;
    const l = buildFormulaWorkbook({ ...common, displayScale: scale }).wb;
    workbookRules(`values, ${scale}`, v, scale, false);
    workbookRules(`live, ${scale}`, l, scale, true);
    byScale.set(scale, { values: numbers(v), live: numbers(l) });
    if (scale === 'full') {
      console.log('D. Live structure');
      const cover = l.getWorksheet('Cover')!;
      const links = new Set<string>();
      cover.eachRow((row) => row.eachCell((c) => { const v2 = c.value as { hyperlink?: string } | null; const m = v2 && typeof v2 === 'object' && v2.hyperlink ? /^#'?(.+?)'?!/.exec(v2.hyperlink) : null; if (m) links.add(m[1]); }));
      const missing = l.worksheets.filter((w) => w.name !== 'Cover' && !links.has(w.name)).map((w) => w.name);
      check('D2 the live Cover links every tab', !missing.length, missing.join(', '));
      const rev = l.getWorksheet('Revenue')!;
      let widest = 0;
      // A number is as wide as it SHOWS (2026-11-17): a full-unit sale value is 13 characters, not 9.
      const shown = (c: Cell): number => { const v2 = c.value as unknown; const n = isFormula(v2) ? v2.result : v2; if (typeof n !== 'number') return 9; const nf = String(c.numFmt ?? ''); if (/%/.test(nf)) return 6; const m = /0(?:.(0+))?(,*)(?:_|;|$)/.exec(nf.split(';')[0] ?? ''); return (Math.abs(n) / 1000 ** (m?.[2]?.length ?? 0)).toLocaleString('en-US', { minimumFractionDigits: m?.[1]?.length ?? 0, maximumFractionDigits: m?.[1]?.length ?? 0 }).length; };
      rev.eachRow((row) => { const c = row.getCell(3); if (typeof c.value === 'number' || isFormula(c.value)) widest = Math.max(widest, shown(c)); else if (typeof c.value === 'string' && row.getCell(4).value != null) widest = Math.max(widest, c.value.length); });
      check('D3 Revenue column C is wide enough for what it holds (was 2 wide, cutting "10.00% 3")', !widest || (rev.getColumn(3).width ?? 0) >= widest + 2, `width ${rev.getColumn(3).width}, content ${widest}`);
      const inputs = l.getWorksheet('Inputs')!;
      // ONE ITEM PER ROW (2026-11-17, founder; re-aimed from "the one line"): the heading, each item, then how to turn one on.
      let head = 0, col = 0;
      inputs.eachRow((row, r) => row.eachCell((c, cc) => { if (!head && c.value === 'Not used in this project') { head = r; col = cc; } }));
      const items = head ? Array.from({ length: notUsedItems(live.state as never).length }, (_, i) => String(inputs.getCell(head + 1 + i, col).value ?? '')) : [];
      const want = notUsedItems(live.state as never).map((t) => `- ${t}`);
      check('D4 Inputs lists what is not used, one item per row, then how to turn it on', head > 0 && items.join('|') === want.join('|') && /Turn on in the platform/.test(String(inputs.getCell(head + 1 + want.length, col).value ?? '')) && !!notUsedLine(live.state as never), items.join('; ') || '(none)');
    }
  }
  console.log('E. Formatting only');
  const f = byScale.get('full')!;
  for (const scale of ['thousands', 'millions'] as const) {
    const o = byScale.get(scale)!;
    for (const k of ['values', 'live'] as const) {
      const diffs = [...f[k]].filter(([addr, n]) => o[k].get(addr) !== n);
      check(`E1 ${k}: every stored number at ${scale} equals the full-units export`, !diffs.length && f[k].size === o[k].size, `${diffs.length} differ; ${diffs.slice(0, 3).map(([a]) => a).join(', ')}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
