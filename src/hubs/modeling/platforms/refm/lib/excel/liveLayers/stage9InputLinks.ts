/**
 * stage9InputLinks.ts (2026-09-28)
 *
 * INPUTS IS THE ONE PLACE A USER TYPES (founder, 2026-09-28). The hardcoded
 * export repeats most inputs: once on the Inputs sheet and once on the module
 * sheet the platform screen mirrors, and the live layers were built reading the
 * module copy. So typing into the obvious-looking Inputs cell moved nothing.
 * This layer, which runs LAST, keeps the promise a shaded cell makes:
 *
 *   1. LINK. An Inputs cell registered `inp=<module key>@<col>[#<conv>]` becomes
 *      the input and the module cell an unshaded echo of it, so every live
 *      formula that reads the module cell now follows Inputs. A pair links only
 *      when both cells hold the same platform value (after the conversion):
 *      a mapping mistake is reported, never wired.
 *   2. ECHO. An Inputs cell registered `echo=<key>@<col>` shows a figure the
 *      model derives or holds elsewhere: it becomes an unshaded formula.
 *   3. A SHADED FORMULA IS UNSHADED. Typing into it would cut the link it is.
 *   4. FIXED AT EXPORT. What is shaded and read by no formula is unshaded with
 *      the note, but only where that is explained: a TEXT choice (structure the
 *      live model never re-parses), a number declared `fixed:<why>`, or either
 *      cell of a linked pair whose module side the live model does not read.
 *      Any other shaded number no formula reads is left SHADED, and the
 *      verifier fails on it (inputAudit.ts), so a broken link cannot hide.
 *
 * No em dashes in this file.
 */
import type ExcelJS from 'exceljs';
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { ARGB } from '../styles';
import { readCells, shadedCells, fixAtExport, isShaded, isLegendSwatch, cellId } from './inputAudit';

const INPUTS = 'Inputs';

/** How an Inputs value becomes the module's: identity, or a named conversion. */
const CONVERSIONS: Record<string, { formula: (inp: string, mod: number | string | undefined) => string; value: (v: unknown, mod: number | string | undefined) => unknown }> = {
  // "0 = auto" on Inputs; the module shows the year auto resolved to at export.
  auto: { formula: (inp, mod) => `IF(N(${inp})=0,${Number(mod)},N(${inp}))`, value: (v, mod) => (Number(v) === 0 ? mod : v) },
  // Days payable: the Opex sheet prints a zero as the words "0 (cash basis)".
  dpo: { formula: (inp) => `IF(N(${inp})=0,"0 (cash basis)",N(${inp}))`, value: (v) => (Number(v) === 0 ? '0 (cash basis)' : v) },
  // 1 / 0 on Inputs; On / Off on the module.
  onoff: { formula: (inp) => `IF(N(${inp})=1,"On","Off")`, value: (v) => (Number(v) === 1 ? 'On' : 'Off') },
};

export const stage9InputLinks: LiveLayer = {
  name: 'stage 9: inputs is the one place a user types',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const parse = (spec: string): { key: string; col?: number; conv?: string } => {
      const [head, conv] = spec.split('#');
      const at = head.lastIndexOf('@');
      return at > 0 ? { key: head.slice(0, at), col: Number(head.slice(at + 1)), conv } : { key: head, conv };
    };
    const unshadeAsEcho = (cell: ExcelJS.Cell): void => {
      cell.fill = { type: 'pattern', pattern: 'none' } as ExcelJS.Fill;
      cell.border = {};
      cell.font = { ...(cell.font ?? {}), color: { argb: ARGB.formula } };
    };
    const same = (a: unknown, b: unknown): boolean => (typeof a === 'number' && typeof b === 'number')
      ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
      : String(a ?? '') === String(b ?? '');

    const linked: Array<{ inputs: string; module: string }> = [];
    const mismatched: string[] = [];
    // WHAT THE LIVE MODEL READS, BEFORE ANY LINK: a module copy no formula reads is not
    // wired (an echo frozen at an export-time "auto" would then be compared as if live);
    // the pair is fixed at export on both sides instead.
    const readBefore = readCells(wb);
    const unreadPairs = new Map<string, string>();
    const WHY_PAIR = 'Neither this cell nor its copy on the module sheet is read by the live workbook.';
    let echoes = 0;
    // A `*` stands for one key segment the Inputs builder cannot know (which subtitle a
    // Revenue card row happened to sit under); it must match exactly one registered key.
    const allKeys = reg.keys();
    const resolve = (key: string): string | null => {
      if (!key.includes('*')) return w.has(key) ? key : null;
      const re = new RegExp(`^${key.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^|]*')}$`);
      const hits = allKeys.filter((x) => re.test(x));
      return hits.length === 1 ? hits[0] : null;
    };
    for (const k of reg.keys()) {
      if (!k.startsWith('inp=') && !k.startsWith('echo=')) continue;
      const src = reg.get(k)!;
      if (src.sheet !== INPUTS) continue;
      const spec = parse(k.slice(k.indexOf('=') + 1));
      const found = resolve(spec.key);
      if (!found) { mismatched.push(`${spec.key} (no single such cell)`); continue; }
      spec.key = found;
      const target = w.addr(spec.key, spec.col);
      const inRef = w.refA(src);
      const inVal = w.platformValue(src);
      if (k.startsWith('echo=')) {
        w.reset();
        const tRef = w.refA(target);
        w.fA(src, typeof w.platformValue(target) === 'string' ? tRef : `N(${tRef})`, { cached: w.platformValue(target) ?? inVal });
        unshadeAsEcho(w.cellA(src));
        echoes++;
        continue;
      }
      const modVal = w.platformValue(target);
      if (!readBefore.has(cellId(target.sheet, target.row, target.col))) {
        unreadPairs.set(cellId(src.sheet, src.row, src.col), WHY_PAIR);
        unreadPairs.set(cellId(target.sheet, target.row, target.col), WHY_PAIR);
        w.reset();
        continue;
      }
      // A calendar year on Inputs, a model-year index on the module: less the live axis start year.
      if (spec.conv === 'yearidx') {
        if (!w.has('project:axisYear')) { mismatched.push(`${spec.key} (no axis year cell)`); w.reset(); continue; }
        const ax = w.addr('project:axisYear');
        if (!same(Number(inVal) - Number(w.platformValue(ax)), modVal)) { mismatched.push(`${spec.key}: Inputs ${inVal} less the axis year vs module ${modVal}`); w.reset(); continue; }
        w.fA(target, `N(${inRef})-N(${w.refA(ax)})`, { cached: modVal });
        unshadeAsEcho(w.cellA(target));
        linked.push({ inputs: cellId(src.sheet, src.row, src.col), module: cellId(target.sheet, target.row, target.col) });
        continue;
      }
      const conv = spec.conv ? CONVERSIONS[spec.conv] : undefined;
      if (spec.conv && !conv) { mismatched.push(`${k} (no conversion "${spec.conv}")`); continue; }
      if (!same(conv ? conv.value(inVal, modVal) : inVal, modVal)) { mismatched.push(`${spec.key}: Inputs ${JSON.stringify(inVal)} vs module ${JSON.stringify(modVal)}`); w.reset(); continue; }
      w.fA(target, conv ? conv.formula(inRef, modVal) : typeof inVal === 'string' ? inRef : `N(${inRef})`, { cached: modVal });
      unshadeAsEcho(w.cellA(target));
      linked.push({ inputs: cellId(src.sheet, src.row, src.col), module: cellId(target.sheet, target.row, target.col) });
    }

    // ── CAPEX COST LINES: one Inputs row per plot and cost line (inpcx:<plot>:<line>),
    //    the working-sheet row the model prices it on (cxc:<plot>:<line>).
    //    Rate (Inputs C / Calc D): the working sheet reads the cost standard, so the
    //    Inputs figure is an ECHO; a rate the line states itself is the INPUT.
    //    Window (Inputs F, G / Calc G, H): a line that follows construction derives it,
    //    so ECHO; a fixed window is one per cost line (cxwin), typed on the FIRST
    //    plot's row, which the Capex foot and every other plot's row echo.
    const declaredCapex = new Map<string, string>();
    {
      const CALC = 'Capex Calc';
      const firstWin = new Map<string, { F: string; G: string }>();
      for (const k of reg.keys()) {
        if (!k.startsWith('inpcx:')) continue;
        const [, plot, line] = k.split(':');
        const calcKey = `cxc:${plot}:${line}`;
        const row = reg.get(k)!.row;
        const I = (col: number) => ({ sheet: INPUTS, row, col });
        if (!w.has(calcKey)) { for (const col of [3, 6, 7]) declaredCapex.set(cellId(INPUTS, row, col), 'This plot does not price the line in the live workbook.'); continue; }
        const cr = w.addr(calcKey).row;
        const C = (col: number) => ({ sheet: CALC, row: cr, col });
        const isF = (a: { sheet: string; row: number; col: number }): boolean => { const v = w.cellA(a).value as unknown; return !!v && typeof v === 'object' && 'formula' in (v as object); };
        // Rate.
        if (isF(C(4))) { w.reset(); w.fA(I(3), `N(${w.refA(C(4))})`, { cached: w.platformValue(I(3)) }); unshadeAsEcho(w.cellA(I(3))); echoes++; }
        else if (typeof w.platformValue(C(4)) === 'number') {
          if (same(w.platformValue(I(3)), w.platformValue(C(4)))) { w.fA(C(4), `N(${w.refA(I(3))})`, { cached: w.platformValue(C(4)) }); linked.push({ inputs: cellId(INPUTS, row, 3), module: cellId(CALC, cr, 4) }); }
          else { mismatched.push(`${calcKey} rate: Inputs ${w.platformValue(I(3))} vs working sheet ${w.platformValue(C(4))}`); w.reset(); }
        } else declaredCapex.set(cellId(INPUTS, row, 3), 'The line carries no rate in the live workbook.');
        // Window.
        if (w.has(`cxwin:${line}`)) {
          const first = firstWin.get(line);
          if (!first) {
            const win = w.addr(`cxwin:${line}`);
            const ok = same(w.platformValue(I(6)), w.platformValue({ sheet: win.sheet, row: win.row, col: 3 })) && same(w.platformValue(I(7)), w.platformValue({ sheet: win.sheet, row: win.row, col: 4 }));
            if (!ok) { mismatched.push(`${line} window: Inputs vs the Capex foot`); continue; }
            for (const [ic, wc] of [[6, 3], [7, 4]] as const) {
              w.fA({ sheet: win.sheet, row: win.row, col: wc }, `N(${w.refA(I(ic))})`, { cached: w.platformValue({ sheet: win.sheet, row: win.row, col: wc }) });
              unshadeAsEcho(w.cellA({ sheet: win.sheet, row: win.row, col: wc }));
              linked.push({ inputs: cellId(INPUTS, row, ic), module: cellId(win.sheet, win.row, wc) });
            }
            firstWin.set(line, { F: w.refA(I(6)), G: w.refA(I(7)) });
            w.reset();
          } else {
            for (const [ic, ref] of [[6, first.F], [7, first.G]] as const) { w.fA(I(ic), `N(${ref})`, { cached: w.platformValue(I(ic)) }); unshadeAsEcho(w.cellA(I(ic))); echoes++; }
          }
        } else {
          for (const [ic, cc] of [[6, 7], [7, 8]] as const) { w.reset(); w.fA(I(ic), `N(${w.refA(C(cc))})`, { cached: w.platformValue(I(ic)) }); unshadeAsEcho(w.cellA(I(ic))); echoes++; }
        }
      }
    }

    // Declared fixed cells: `fixed:<why>` at the cell (a suffix keeps keys unique).
    const declared = new Map<string, string>([...declaredCapex, ...unreadPairs]);
    for (const k of reg.keys()) if (k.startsWith('fixed:')) { const a = reg.get(k)!; declared.set(cellId(a.sheet, a.row, a.col), k.slice(6).split('|')[0]); }
    // MODULE CELLS WITH NO COPY ON INPUTS that the live solve is built around at export,
    // named by rule here, one place. Each applies only if no formula reads the cell.
    const MODULE_FIXED: Array<{ re: RegExp; col?: number; why: string }> = [
      { re: /^cx:esc$/, col: 3, why: 'The live Capex is built without cost escalation, as exported.' },
      { re: /^revin\|.+\|\|.+$/, col: 5, why: 'The row sells on the other basis; this price is kept for a switch, not used.' },
      { re: /^fin\|.+ facility\)\|(Upfront Fee %|Commitment Fee %)$/, col: 4, why: 'The live financing charges no upfront or commitment fee, as exported.' },
      { re: /^fin\|4\. Land Funding .*\|.+, (Debt|Equity) %$/, col: 4, why: 'Land is funded at the split stated at export.' },
      { re: /^fin\|.+ \(existing facility\)\|Origination Year$/, col: 4, why: 'The existing loan is drawn in the year it was raised, as exported: a year before the model starts is existing operations, which the live workbook is not built for.' },
      { re: /^retg\|Equity Partners\|(Existing Equity|% share~2)\|\d+$/, why: 'Existing equity belongs to existing operations, which the live workbook is not built for.' },
    ];
    for (const k of allKeys) for (const m of MODULE_FIXED) {
      if (!m.re.test(k)) continue;
      const a = w.addr(k, m.col);
      declared.set(cellId(a.sheet, a.row, a.col), m.why);
    }

    // The audit, over the workbook as every layer left it.
    const read = readCells(wb);
    const pairOf = new Map<string, string>();
    for (const p of linked) { pairOf.set(p.inputs, p.module); pairOf.set(p.module, p.inputs); }
    let fixed = 0, unshadedFormulas = 0;
    for (const s of shadedCells(wb)) {
      const id = cellId(s.sheet, s.row, s.col);
      const ws = wb.getWorksheet(s.sheet)!;
      if (s.isFormula) { unshadeAsEcho(ws.getCell(s.row, s.col)); unshadedFormulas++; continue; }
      if (read.has(id)) continue;
      // The colour legend (Cover, Guide, Checks) shows what the shading means; its swatch is a label, not an input.
      if (s.isText && isLegendSwatch(String(s.value))) continue;
      const partner = pairOf.get(id);
      const pairUnread = !!partner && !read.has(partner);
      if (s.isText || declared.has(id) || pairUnread) {
        fixAtExport(ws, s.row, s.col, declared.get(id));
        fixed++;
      }
    }
    // A pair whose module side nothing reads: its module cell, now an echo, is unread too.
    for (const p of linked) if (!read.has(p.module) && !read.has(p.inputs)) {
      const [sh, rc] = p.inputs.split('!'); const [r, c] = rc.split(':').map(Number);
      const cell = wb.getWorksheet(sh)!.getCell(r, c);
      if (isShaded(cell)) { fixAtExport(wb.getWorksheet(sh)!, r, c); fixed++; }
    }

    return [{
      sheet: INPUTS, status: 'partial' as const, formulas: w.formulas.get(INPUTS) ?? 0,
      note: `Every input is typed here: the module sheets echo these cells (${linked.length} linked), figures the model derives are shown as unshaded echoes (${echoes}), and a cell the live workbook is built for at export is unshaded with a note saying so (${fixed}).${mismatched.length ? ` Not linked, the two copies disagree: ${mismatched.slice(0, 4).join('; ')}${mismatched.length > 4 ? ` and ${mismatched.length - 4} more` : ''}.` : ''}`,
    }];
    void unshadedFormulas;
  },
};
