/**
 * stage3Revenue.ts (2026-09-27), FORMULA-LINKED EXPORT, STAGE 3: REVENUE.
 *
 * The engine prices each ASSET (`computeSellAsset`, `computeHospitalityAsset`,
 * `computeLeaseAsset`, fed by revenue-resolvers); the Revenue sheet presents by
 * LINE. So the arithmetic lives on a hidden working sheet, "Revenue Calc", as
 * the engine's own steps, and the visible rows sum a line's plots:
 *
 *   SELL, per sub-unit: the pre-sales pass over every year, then the sales
 *     during operation pass, each step capped at what is still unsold, rounded
 *     to whole units (or whole sqm), and the step that reaches the typed 100%
 *     taking the exact remainder; revenue = area sold x base price x the
 *     indexation factor. Collections: one cohort per sale year, a downpayment
 *     in the year it sells and the balance in equal instalments cut off at
 *     handover (`buildSaleCohortProfile`); a cohort at or after handover pays
 *     in full. Recognition at handover. Receivable and unearned roll-forwards.
 *   HOTEL: keys from Table 5 (area over the unit size, the one keys rule),
 *     available and occupied room nights over the operations window, ADR x
 *     the indexation factor, F&B and other as a share of rooms revenue.
 *   LEASE: gross lease area x occupancy x the base rent x the indexation factor.
 *
 * Inputs stay where the sheet shows them (velocities, downpayments, instalment
 * years, occupancy, shares, operations start); a phase-local input is read at
 * its SHIFTED position when a phase's start moves, so a phase date stays live.
 * The indexation rates and start years and the days per year, which the sheet
 * printed only as a sentence, are listed as inputs at its foot. Prices are the
 * Inputs sheet's Table 5 rates.
 *
 * REFUSES by name (Revenue stays values) what it does not yet express: another
 * indexation method, recognition other than at handover, a handover override,
 * instalments running past handover, a sales pace lever, a lockstep velocity
 * row, a sub-unit sold by units, a downpayment carried or defaulted, an input
 * stored where the sheet does not show it, F&B or other revenue not a share of
 * rooms, a rental pool, an occupancy lever, a stored ADR, a line whose revenue
 * sits on more than one plot.
 *
 * Cost of Sales, Schedules and Escrow read capitalised interest and stay the
 * platform's values until the financing stages.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import { LiveWriter } from './writer';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { ARGB, NUMFMT, setInput, setLabel, fillRange } from '../styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { resolveSubUnitMetric, isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, groupRevenueLines, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { resolveRowVelocity } from '../../revenue-resolvers';
import { hasAnyDownpayment } from '@/src/core/calculations/revenue/cohortTerms';
import type { Asset, Phase, SubUnit } from '../../state/module1-types';

const CALC = 'Revenue Calc';
const REV = 'Revenue';
const IDX_METHODS = new Set(['none', 'yoy_compound', 'single_rate']);

type Idx = { method?: string; rate?: number; startYear?: number } | undefined;

export const stage3Revenue: LiveLayer = {
  name: 'stage 3: revenue',
  apply(ctx: LayerContext) {
    const { wb, reg } = ctx;
    const raw = ctx.opts.state;
    const state = { ...raw, assets: withResolvedAssetNames(raw.assets, { parcels: raw.parcels, phases: raw.phases }) };
    const snap = computeFinancialsSnapshot(state);
    const N = snap.axisLength;
    const { TOTAL_COL, OPEN_COL } = PERIOD_COLS;
    const pc = (t: number): number => OPEN_COL + 1 + t;
    const w = new LiveWriter(wb, reg, ctx.pending);
    const phases = state.phases as Phase[];
    const subUnits = state.subUnits as SubUnit[];
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const revRows = (a: Asset): SubUnit[] => subUnits.filter((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const K = (line: RevenueLine, table: string, label: string): string => `revin|${line.key}|${table}|${label}`;
    const O = (line: RevenueLine, table: string, label: string): string => `rev|${line.key}|${table}|${label}`;

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    const phaseOf = (l: RevenueLine): Phase | undefined => phases.find((p) => p.id === l.phaseId);
    const earning = (l: RevenueLine): Asset[] => l.members.filter((m) => revRows(m).length > 0);
    const offsetAt = (p: Phase): number => new Date(p.startDate as string).getUTCFullYear() - snap.revenue.projectStartYear;
    // A phase-local input must be shown on the sheet wherever it is non-zero.
    const shownOrZero = (name: string, byPhase: readonly (number | null | undefined)[] | undefined, off: number, rowKey: string | undefined): void => {
      if (!byPhase) return;
      const row = rowKey && w.has(rowKey) ? w.addr(rowKey).row : undefined;
      byPhase.forEach((v, i) => {
        if (!(typeof v === 'number' && v !== 0)) return;
        const t = off + i;
        const shown = row !== undefined && t >= 0 && t < N && w.platformValue({ sheet: REV, row, col: pc(t) }) !== undefined;
        if (!shown) refuse.push(`${name}: a value is stored for a year the sheet does not show`);
      });
    };
    for (const l of lines) {
      const p = phaseOf(l);
      if (!p) continue;
      const name = revenueLineName(l);
      const earners = earning(l);
      if (earners.length > 1) refuse.push(`${name}: revenue sits on more than one plot`);
      const a = earners[0] ?? l.host;
      const off = offsetAt(p);
      if (l.form === 'sell') {
        const sell = a.revenue?.sell;
        if (!sell) continue;
        const ix = sell.indexation as Idx;
        if (!IDX_METHODS.has(ix?.method ?? 'none')) refuse.push(`${name}: price indexation ${ix?.method}`);
        const rec = sell.recognitionProfile;
        if (rec && !(rec.method === 'point_in_time' && (rec.pointInTimeYear ?? 'handover') === 'handover')) refuse.push(`${name}: recognition is not at handover`);
        if (sell.handoverYearOverride != null) refuse.push(`${name}: a handover year override`);
        if (sell.instalmentsStopAtHandover === false) refuse.push(`${name}: instalments run past handover`);
        if (sell.paceFactor != null && sell.paceFactor !== 1) refuse.push(`${name}: a sales pace lever`);
        if (sell.velocityDefault && l.subUnits.length > 1) refuse.push(`${name}: a lockstep velocity row`);
        if (!hasAnyDownpayment(sell.downpaymentByPhase)) refuse.push(`${name}: no downpayment of its own`);
        for (let k = 0; k < Math.max(0, p.constructionPeriods ?? 0); k++) {
          const v = sell.downpaymentByPhase?.[k];
          if (!(typeof v === 'number' && Number.isFinite(v))) refuse.push(`${name}: a sale year's downpayment is carried, not typed`);
        }
        for (const u of revRows(a)) {
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} is sold by units`);
          const v = resolveRowVelocity(sell, u.id);
          if (v.pre === undefined && (v.preLegacy ?? []).some((x) => x)) refuse.push(`${name}: velocity held on the legacy axis`);
          if (v.post === undefined && (v.postLegacy ?? []).some((x) => x)) refuse.push(`${name}: velocity held on the legacy axis`);
          shownOrZero(`${name} pre-sales velocity`, v.pre, off, K(l, 'Pre-Sales velocity', u.name || 'sub-unit'));
          shownOrZero(`${name} sales during operation`, v.post, off, K(l, 'Sales During Operation', u.name || 'sub-unit'));
        }
        shownOrZero(`${name} downpayment`, sell.downpaymentByPhase as number[] | undefined, off, K(l, 'Sale cohort terms', 'Downpayment %'));
      } else if (l.form === 'operate') {
        const op = a.revenue?.operate;
        if (!op) continue;
        if ((op.fb?.mode ?? 'percent_of_rooms') !== 'percent_of_rooms' || Array.isArray(op.fb?.percentOfRooms) || op.fb?.percentOfRoomsByPhase !== undefined) refuse.push(`${name}: F&B is not a flat share of rooms`);
        if ((op.otherRevenue?.mode ?? 'percent_of_rooms') !== 'percent_of_rooms' || Array.isArray(op.otherRevenue?.percentOfRooms) || op.otherRevenue?.percentOfRoomsByPhase !== undefined) refuse.push(`${name}: other revenue is not a flat share of rooms`);
        if (op.keysParticipationProfile !== undefined || op.keysParticipationProfileByPhase !== undefined) refuse.push(`${name}: a rental pool`);
        if (!IDX_METHODS.has(op.adrIndexation?.method ?? 'none')) refuse.push(`${name}: ADR indexation ${op.adrIndexation?.method}`);
        if (op.occupancyShiftPts) refuse.push(`${name}: an occupancy lever`);
        for (const u of revRows(a)) {
          if ((u.startingAdr ?? 0) > 0) refuse.push(`${name}: ${u.name} stores an ADR of its own`);
          if (u.hospitalityIndexation) refuse.push(`${name}: ${u.name} has its own ADR indexation`);
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} counts keys`);
        }
        shownOrZero(`${name} occupancy`, op.occupancyPerPeriodByPhase, off, K(l, 'ADR Indexation', 'Occupancy ramp'));
        if (op.occupancyPerPeriodByPhase === undefined) refuse.push(`${name}: occupancy held on the legacy axis`);
      } else {
        const le = a.revenue?.lease;
        if (!le) continue;
        if (!IDX_METHODS.has(le.rentIndexation?.method ?? 'none')) refuse.push(`${name}: rent indexation ${le.rentIndexation?.method}`);
        if (le.occupancyShiftPts) refuse.push(`${name}: an occupancy lever`);
        for (const u of revRows(a)) {
          if (!((u.unitPrice ?? 0) > 0) && (le.baseRate ?? 0) > 0) refuse.push(`${name}: ${u.name} takes the line's base rent`);
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} is let by units`);
        }
        shownOrZero(`${name} occupancy`, le.occupancyPerPeriodByPhase, off, K(l, 'Rent Indexation', 'Occupancy ramp'));
        if (le.occupancyPerPeriodByPhase === undefined) refuse.push(`${name}: occupancy held on the legacy axis`);
      }
    }
    if (refuse.length) {
      return [{ sheet: REV, status: 'values' as const, formulas: 0, note: `Revenue could not be made live for this model: ${[...new Set(refuse)].join('; ')}.` }];
    }

    // ── Inputs the sheet printed only as a sentence, listed at its foot ─────
    const rv = wb.getWorksheet(REV)!;
    let fr = rv.rowCount + 3;
    setLabel(rv.getCell(fr, 1), 'Live model inputs: indexation and days per year, which the cards above state in words (the formulas above read them)', { bold: true });
    fillRange(rv, fr, 1, fr, OPEN_COL + N, ARGB.subtotal);
    fr += 1;
    setLabel(rv.getCell(fr, 1), 'An indexation starts in a model year counted from 0 (the first year of the model); the year it is shown beside is that year on the calendar.');
    rv.getCell(fr, 1).font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: ARGB.navyDark } };
    fr += 2;
    setLabel(rv.getCell(fr, 1), 'Line', { bold: true }); setLabel(rv.getCell(fr, 2), 'Setting', { bold: true });
    setLabel(rv.getCell(fr, TOTAL_COL), 'Rate', { bold: true }); setLabel(rv.getCell(fr, OPEN_COL), 'From model year', { bold: true }); setLabel(rv.getCell(fr, OPEN_COL + 1), 'Which is', { bold: true });
    fr += 1;
    const idxOf = (l: RevenueLine, a: Asset): Idx => (l.form === 'sell' ? a.revenue?.sell?.indexation : l.form === 'operate' ? a.revenue?.operate?.adrIndexation : a.revenue?.lease?.rentIndexation) as Idx;
    for (const l of lines) {
      const a = earning(l)[0];
      if (!a) continue;
      const ix = idxOf(l, a);
      const method = ix?.method ?? 'none';
      setLabel(rv.getCell(fr, 1), revenueLineName(l), { indent: 1 });
      setLabel(rv.getCell(fr, 2), `${l.form === 'sell' ? 'Price' : l.form === 'operate' ? 'ADR' : 'Rent'} indexation, ${method === 'none' ? 'none' : method === 'yoy_compound' ? 'compounding each year' : 'one step'}`);
      if (method !== 'none') {
        setInput(rv.getCell(fr, TOTAL_COL), ix?.rate ?? 0, NUMFMT.pct2);
        setInput(rv.getCell(fr, OPEN_COL), ix?.startYear ?? 0, NUMFMT.int);
        w.claim(`revfoot|${l.key}|idx`, REV, fr, 1);
        w.fA({ sheet: REV, row: fr, col: OPEN_COL + 1 }, `${w.ref('project:axisYear')}+${w.refA({ sheet: REV, row: fr, col: OPEN_COL })}`, { cached: snap.revenue.projectStartYear + (ix?.startYear ?? 0) });
      }
      fr += 1;
      if (l.form === 'operate') {
        setLabel(rv.getCell(fr, 1), revenueLineName(l), { indent: 1 });
        setLabel(rv.getCell(fr, 2), 'Days per year');
        setInput(rv.getCell(fr, TOTAL_COL), a.revenue?.operate?.daysPerYear ?? 365, NUMFMT.int);
        w.claim(`revfoot|${l.key}|days`, REV, fr, 1);
        fr += 1;
      }
    }

    // ── The working sheet ────────────────────────────────────────────────────
    const cs = wb.addWorksheet(CALC, { state: 'hidden' });
    cs.getCell(1, 1).value = 'Revenue working sheet: the engine\'s own steps per plot and sub-unit. Hidden; the Revenue sheet sums a line\'s plots from here.';
    const cT = (t: number): number => 4 + t;
    let cr = 3;
    for (let t = 0; t < N; t++) cs.getCell(cr, cT(t)).value = `Year ${t + 1}`;
    cr += 1;
    const C = (row: number, col: number) => ({ sheet: CALC, row, col });
    const newRow = (key: string, label: string): number => { const r = cr; cs.getCell(r, 1).value = label; w.claim(key, CALC, r, 1); cr += 1; return r; };
    const perT = (row: number, f: (t: number) => string): void => { for (let t = 0; t < N; t++) w.fA(C(row, cT(t)), f(t)); };
    const at = (row: number, t: number): string => w.refA(C(row, cT(t)));
    const rowRange = (sheet: string, row: number, c0: number, c1: number): string => w.rangeA(sheet, row, c0, c1);
    const AXIS = (): string => w.ref('project:axisYear');

    // Phase figures: offset (unclamped), construction start, sell handover, the
    // resolvers' handover and default operations start.
    const ph = new Map<string, number>();
    for (const p of phases) {
      const r = newRow(`rvc:ph:${p.id}`, `Phase ${p.name}: offset, construction start, handover (sell), handover (ops), default ops start`);
      ph.set(p.id, r);
      const cp = (): string => w.ref(`phase:${p.id}:cp`);
      w.fA(C(r, 3), `YEAR(${w.ref(`phase:${p.id}:start`)})-${AXIS()}`);
      w.fA(C(r, 4), `MAX(0,MIN(${N - 1},${w.refA(C(r, 3))}))`);
      w.fA(C(r, 5), `MAX(0,MIN(${N - 1},YEAR(${w.ref(`phase:${p.id}:start`)})+MAX(0,${cp()}-1)-${AXIS()}))`);
      w.fA(C(r, 6), `MAX(${w.refA(C(r, 4))},MIN(${N - 1},${w.refA(C(r, 4))}+MAX(0,${cp()})-1))`);
      w.fA(C(r, 7), `MAX(${w.refA(C(r, 4))},MIN(${N - 1},${w.refA(C(r, 6))}+1))`);
    }
    const OFF = (p: Phase): string => w.refA(C(ph.get(p.id)!, 3));
    const CSI = (p: Phase): string => w.refA(C(ph.get(p.id)!, 4));
    const HS = (p: Phase): string => w.refA(C(ph.get(p.id)!, 5));
    const DEFOPS = (p: Phase): string => w.refA(C(ph.get(p.id)!, 7));
    /** A phase-local input shown on the Revenue sheet, read for axis year t at its
     *  position shifted by the live phase offset (off0 is the offset at export). */
    const shifted = (row: number, off0: number, p: Phase, t: number): string => {
      const k = `(${t}-${OFF(p)}+${off0})`;
      return `IF(AND(${k}>=0,${k}<=${N - 1}),N(INDEX(${rowRange(REV, row, pc(0), pc(N - 1))},1,${k}+1)),0)`;
    };
    /** The indexation factor for axis year t, from the foot inputs. */
    const factorF = (l: RevenueLine, ix: Idx, t: number): string => {
      const m = ix?.method ?? 'none';
      if (m === 'none') return '1';
      const rate = w.ref(`revfoot|${l.key}|idx`, TOTAL_COL), start = w.ref(`revfoot|${l.key}|idx`, OPEN_COL);
      return m === 'yoy_compound' ? `(1+${rate})^MAX(0,${t}-MAX(0,${start}))` : `IF(${t}>=MAX(0,${start}),1+${rate},1)`;
    };
    const opsWindow = (l: RevenueLine, p: Phase, startKey: string): { s: () => string; e: () => string } => {
      // The start year shown is the default until someone changes it (then it is an override).
      const r = newRow(`rvc:ops:${l.key}`, `${revenueLineName(l)}: operations start, end`);
      const cell = w.addr(startKey, TOTAL_COL);
      const shown = w.platformValue(cell) as number;
      const hasOverride = (l.form === 'operate' ? l.host.revenue?.operate?.operationsStartYearOverride : l.host.revenue?.lease?.operationsStartYearOverride) != null;
      const clamp = `MAX(${CSI(p)},MIN(${N - 1},${w.refA(cell)}-${AXIS()}))`;
      w.fA(C(r, 3), hasOverride ? clamp : `IF(${w.refA(cell)}=${shown},${DEFOPS(p)},${clamp})`);
      w.fA(C(r, 4), `MAX(${w.refA(C(r, 3))},MIN(${N - 1},${DEFOPS(p)}+MAX(0,${w.ref(`phase:${p.id}:op`)})-1))`);
      return { s: () => w.refA(C(r, 3)), e: () => w.refA(C(r, 4)) };
    };

    // Per-line results the visible rows read (keys of calc rows, by series).
    interface SellRes { preRev: number; postRev: number; preArea: number; postArea: number; cashPre: number; recPre: number; arClose: number; urClose: number; mat: number[]; factor: number; su: Map<string, { A: number; pre: { area: number; rev: number }; post: { area: number; rev: number } }>; H: () => string; line: RevenueLine; phase: Phase }
    interface HotelRes { win: { s: () => string; e: () => string }; inOps: number; occ: number; factor: number; adr: number; arn: number; orn: number; guests: number; rooms: number; fb: number; other: number; total: number; keys: number; days: () => string; fbPct: () => string; otherPct: () => string; guestsIn: () => string }
    interface LeaseRes { win: { s: () => string; e: () => string }; inOps: number; occ: number; factor: number; rate: number; occupied: number; rev: number; gla: number; su: Map<string, { gla: number; rate: number; occ: number; rev: number }> }
    const sellRes = new Map<string, SellRes>();
    const hotelRes = new Map<string, HotelRes>();
    const leaseRes = new Map<string, LeaseRes>();

    for (const l of lines) {
      const p = phaseOf(l);
      const a = earning(l)[0];
      if (!p || !a) continue;
      const off0 = Math.max(0, offsetAt(p));
      const units = revRows(a);
      if (l.form === 'sell') {
        if (!a.revenue?.sell) continue;
        const ix = a.revenue.sell.indexation as Idx;
        const fRow = newRow(`rvc:${l.key}:factor`, `${revenueLineName(l)}: indexation factor`);
        perT(fRow, (t) => factorF(l, ix, t));
        const suMap: SellRes['su'] = new Map();
        const passRows: Array<{ pre: number[]; post: number[] }> = [];
        for (const u of units) {
          const sc = newRow(`rvc:${l.key}:su:${u.id}`, `${u.name}: area, units, area per unit, price`);
          w.fA(C(sc, 3), `N(${w.ref(`su:${u.id}:area`)})`);
          w.valueA(C(sc, 4), 0);
          w.valueA(C(sc, 5), 0);
          w.fA(C(sc, 6), `MAX(0,N(${w.ref(`su:${u.id}:rate`)}))`);
          const A_ = (): string => w.refA(C(sc, 3)), U_ = (): string => w.refA(C(sc, 4)), APU = (): string => w.refA(C(sc, 5)), P_ = (): string => w.refA(C(sc, 6));
          const pass = (kind: 'pre' | 'post', init: { typed: () => string; cum: () => string; soldA: () => string; soldU: () => string } | null): { rows: Record<string, number>; last: { typed: () => string; cum: () => string; soldA: () => string; soldU: () => string } } => {
            const rows: Record<string, number> = {};
            for (const nm of ['v', 'typed', 'rem', 'cap', 'ex', 'area', 'units', 'act', 'cum', 'soldA', 'soldU', 'rev']) rows[nm] = newRow(`rvc:${l.key}:${u.id}:${kind}:${nm}`, `${u.name} ${kind} ${nm}`);
            const inKey = K(l, kind === 'pre' ? 'Pre-Sales velocity' : 'Sales During Operation', u.name || 'sub-unit');
            const inRow = w.has(inKey) ? w.addr(inKey).row : undefined;
            const prev = (nm: 'typed' | 'cum' | 'soldA' | 'soldU', t: number): string => (t > 0 ? at(rows[nm], t - 1) : init ? init[nm]() : '0');
            for (let t = 0; t < N; t++) {
              w.fA(C(rows.v, cT(t)), inRow !== undefined ? `MAX(0,${shifted(inRow, off0, p, t)})` : '0');
              w.fA(C(rows.typed, cT(t)), `${prev('typed', t)}+${at(rows.v, t)}`);
              w.fA(C(rows.rem, cT(t)), `MAX(0,1-${prev('cum', t)})`);
              w.fA(C(rows.cap, cT(t)), `MIN(${at(rows.v, t)},${at(rows.rem, t)})`);
              w.fA(C(rows.ex, cT(t)), `IF(AND(OR(${at(rows.typed, t)}>=1-1E-9,${at(rows.cap, t)}>=${at(rows.rem, t)}-1E-9),${at(rows.rem, t)}>0),1,0)`);
              const skip = `OR(${at(rows.v, t)}=0,${at(rows.cap, t)}=0)`;
              w.fA(C(rows.area, cT(t)), `IF(${skip},0,IF(${at(rows.ex, t)}=1,MAX(0,${A_()}-${prev('soldA', t)}),IF(${APU()}>0,ROUND(${A_()}*${at(rows.cap, t)}/${APU()},0)*${APU()},ROUND(${A_()}*${at(rows.cap, t)},0))))`);
              w.fA(C(rows.units, cT(t)), `IF(${skip},0,IF(${at(rows.ex, t)}=1,IF(${APU()}>0,MAX(0,${U_()}-${prev('soldU', t)}),0),IF(${APU()}>0,ROUND(${A_()}*${at(rows.cap, t)}/${APU()},0),0)))`);
              w.fA(C(rows.act, cT(t)), `IF(${skip},0,IF(${at(rows.ex, t)}=1,${at(rows.rem, t)},IF(${A_()}>0,${at(rows.area, t)}/${A_()},0)))`);
              w.fA(C(rows.cum, cT(t)), `${prev('cum', t)}+IF(${at(rows.area, t)}=0,0,${at(rows.act, t)})`);
              w.fA(C(rows.soldA, cT(t)), `${prev('soldA', t)}+${at(rows.area, t)}`);
              w.fA(C(rows.soldU, cT(t)), `${prev('soldU', t)}+IF(${at(rows.area, t)}=0,0,${at(rows.units, t)})`);
              w.fA(C(rows.rev, cT(t)), `${at(rows.area, t)}*(${P_()}*${at(fRow, t)})`);
            }
            const lastOf = (nm: 'typed' | 'cum' | 'soldA' | 'soldU') => (): string => at(rows[nm], N - 1);
            return { rows, last: { typed: lastOf('typed'), cum: lastOf('cum'), soldA: lastOf('soldA'), soldU: lastOf('soldU') } };
          };
          const pre = pass('pre', null);
          const post = pass('post', pre.last);
          suMap.set(u.id, { A: sc, pre: { area: pre.rows.area, rev: pre.rows.rev }, post: { area: post.rows.area, rev: post.rows.rev } });
          passRows.push({ pre: [pre.rows.area, pre.rows.rev], post: [post.rows.area, post.rows.rev] });
        }
        const sum = (key: string, label: string, pick: (s: SellRes['su'] extends Map<string, infer V> ? V : never) => number): number => {
          const r = newRow(`rvc:${l.key}:${key}`, `${revenueLineName(l)}: ${label}`);
          perT(r, (t) => ([...suMap.values()].map((s) => at(pick(s), t)).join('+') || '0'));
          return r;
        };
        const preRev = sum('preRev', 'pre-sales revenue', (s) => s.pre.rev);
        const postRev = sum('postRev', 'sales during operation revenue', (s) => s.post.rev);
        const preArea = sum('preArea', 'pre-sales area', (s) => s.pre.area);
        const postArea = sum('postArea', 'sales during operation area', (s) => s.post.area);
        // Sale cohorts: row s pays its sale value across the years.
        const dpKey = K(l, 'Sale cohort terms', 'Downpayment %');
        const dpRow = w.addr(dpKey).row;
        const instCell = w.addr(K(l, 'Sale cohort terms', 'Max instalment years after sale'), TOTAL_COL);
        const mat: number[] = [];
        for (let s = 0; s < N; s++) {
          const r = newRow(`rvc:${l.key}:coh:${s}`, `${revenueLineName(l)}: cohort sold in year ${s + 1} (instalments, downpayment)`);
          w.fA(C(r, 2), `IF(${s}>=${HS(p)},0,MIN(INT(MAX(0,${w.refA(instCell)})),${HS(p)}-${s}))`);
          w.fA(C(r, 3), `MAX(0,MIN(1,${shifted(dpRow, off0, p, s)}))`);
          const n = (): string => w.refA(C(r, 2)), d = (): string => w.refA(C(r, 3));
          perT(r, (t) => `MAX(0,${at(preRev, s)})*IF(OR(${s}>=${HS(p)},${n()}<=0),IF(${t}=${s},1,0),IF(${t}=${s},${d()},IF(AND(${t}>${s},${t}<=${s}+${n()}),(1-${d()})/${n()},0)))`);
          mat.push(r);
        }
        const cashPre = newRow(`rvc:${l.key}:cashPre`, `${revenueLineName(l)}: pre-sales cash`);
        perT(cashPre, (t) => `SUM(${mat.map((r) => at(r, t)).join(',')})`);
        const recPre = newRow(`rvc:${l.key}:recPre`, `${revenueLineName(l)}: pre-sales recognised (at handover)`);
        perT(recPre, (t) => `IF(${t}=MAX(0,MIN(${N - 1},${HS(p)})),SUMPRODUCT((${rowRange(CALC, preRev, cT(0), cT(N - 1))}>0)*${rowRange(CALC, preRev, cT(0), cT(N - 1))}),0)`);
        const arClose = newRow(`rvc:${l.key}:ar`, `${revenueLineName(l)}: receivable, closing`);
        perT(arClose, (t) => `${t > 0 ? at(arClose, t - 1) : '0'}+MAX(0,${at(preRev, t)})-MAX(0,${at(cashPre, t)})`);
        const urClose = newRow(`rvc:${l.key}:ur`, `${revenueLineName(l)}: unearned, closing`);
        perT(urClose, (t) => `${t > 0 ? at(urClose, t - 1) : '0'}+MAX(0,${at(preRev, t)})-MAX(0,${at(recPre, t)})`);
        // The sale revenue and the collections Capex's selling costs read.
        const saleTot = newRow(`rvc:${a.id}:saleRev`, `${a.name}: sale revenue over the hold (selling cost base)`);
        w.fA(C(saleTot, 3), `SUM(${rowRange(CALC, preRev, cT(0), cT(N - 1))})+SUM(${rowRange(CALC, postRev, cT(0), cT(N - 1))})`);
        const cash = newRow(`rvc:${a.id}:cash`, `${a.name}: cash collected`);
        perT(cash, (t) => `${at(cashPre, t)}+${at(postRev, t)}`);
        sellRes.set(l.key, { preRev, postRev, preArea, postArea, cashPre, recPre, arClose, urClose, mat, factor: fRow, su: suMap, H: () => HS(p), line: l, phase: p });
        void passRows;
      } else if (l.form === 'operate') {
        const op = a.revenue?.operate;
        if (!op) continue;
        const ix = op.adrIndexation as Idx;
        const win = opsWindow(l, p, K(l, 'ADR Indexation', 'Operations start year'));
        const tk = a.assetTypeId;
        const sz = newRow(`rvc:${l.key}:size`, `${revenueLineName(l)}: unit size (sub-units first, the type second)`);
        const unitCells = units.filter((u) => w.has(`su:${u.id}:unit`)).map((u) => `su:${u.id}:unit`);
        const typeUnit = tk && w.has(`type:${tk}:unit`) ? w.ref(`type:${tk}:unit`) : '0';
        const cnt = unitCells.map((k) => `COUNTIF(${w.ref(k)},">0")`).join('+'), sm = unitCells.map((k) => `SUMIF(${w.ref(k)},">0")`).join('+');
        w.fA(C(sz, 3), unitCells.length ? `IF((${cnt})>0,(${sm})/(${cnt}),N(${typeUnit}))` : `N(${typeUnit})`);
        const inOps = newRow(`rvc:${l.key}:inOps`, 'in operations');
        perT(inOps, (t) => `IF(AND(${t}>=${win.s()},${t}<=${win.e()}),1,0)`);
        const occRow = w.addr(K(l, 'ADR Indexation', 'Occupancy ramp')).row;
        const occ = newRow(`rvc:${l.key}:occ`, 'occupancy');
        perT(occ, (t) => `IF(${at(inOps, t)}=1,MAX(0,MIN(1,${shifted(occRow, off0, p, t)})),0)`);
        const fRow = newRow(`rvc:${l.key}:factor`, 'ADR factor');
        perT(fRow, (t) => factorF(l, ix, t));
        const days = (): string => w.ref(`revfoot|${l.key}|days`, TOTAL_COL);
        const suKeys: Array<{ keys: number; adrT: number; arn: number; orn: number; rooms: number }> = [];
        for (const u of units) {
          const sc = newRow(`rvc:${l.key}:su:${u.id}`, `${u.name}: keys, ADR`);
          w.fA(C(sc, 3), `IF(AND(N(${w.ref(`su:${u.id}:area`)})>0,${w.refA(C(sz, 3))}>0),MAX(1,ROUND(N(${w.ref(`su:${u.id}:area`)})/${w.refA(C(sz, 3))},0)),0)`);
          w.fA(C(sc, 4), `IF(N(${w.ref(`su:${u.id}:rate`)})>0,N(${w.ref(`su:${u.id}:rate`)}),${Math.max(0, op.startingADR ?? 0)})`);
          const kz = (): string => w.refA(C(sc, 3)), adr0 = (): string => w.refA(C(sc, 4));
          const arn = newRow(`rvc:${l.key}:${u.id}:arn`, 'ARN'); perT(arn, (t) => `IF(${at(inOps, t)}=1,${kz()}*${days()},0)`);
          const orn = newRow(`rvc:${l.key}:${u.id}:orn`, 'ORN'); perT(orn, (t) => `${at(arn, t)}*${at(occ, t)}`);
          const adrT = newRow(`rvc:${l.key}:${u.id}:adr`, 'ADR'); perT(adrT, (t) => `IF(${at(inOps, t)}=1,MAX(0,${adr0()})*${at(fRow, t)},0)`);
          const rooms = newRow(`rvc:${l.key}:${u.id}:rooms`, 'rooms'); perT(rooms, (t) => `${at(orn, t)}*${at(adrT, t)}`);
          suKeys.push({ keys: sc, adrT, arn, orn, rooms });
        }
        const S = (key: string, label: string, f: (t: number) => string): number => { const r = newRow(`rvc:${l.key}:${key}`, label); perT(r, f); return r; };
        const keysTot = newRow(`rvc:${l.key}:keys`, 'keys');
        w.fA(C(keysTot, 3), suKeys.map((s) => w.refA(C(s.keys, 3))).join('+') || '0');
        const KT = (): string => w.refA(C(keysTot, 3));
        const arn = S('arn', 'ARN', (t) => suKeys.map((s) => at(s.arn, t)).join('+') || '0');
        const orn = S('orn', 'ORN', (t) => suKeys.map((s) => at(s.orn, t)).join('+') || '0');
        const rooms = S('rooms', 'rooms revenue', (t) => suKeys.map((s) => at(s.rooms, t)).join('+') || '0');
        const guestsIn = (): string => w.ref(K(l, 'ADR Indexation', 'Average guests per occupied room night'), TOTAL_COL);
        const fbPct = (): string => w.ref(K(l, 'ADR Indexation', 'F&B Revenue, F&B %'), TOTAL_COL);
        const otherPct = (): string => w.ref(K(l, 'ADR Indexation', 'Other Revenue, Other %'), TOTAL_COL);
        const guests = S('guests', 'guests', (t) => `${at(orn, t)}*MAX(0,${guestsIn()})`);
        const fb = S('fb', 'F&B', (t) => `IF(${at(inOps, t)}=1,MAX(0,${at(rooms, t)})*MAX(0,${fbPct()}),0)`);
        const other = S('other', 'other', (t) => `IF(${at(inOps, t)}=1,MAX(0,${at(rooms, t)})*MAX(0,${otherPct()}),0)`);
        const total = S('total', 'total', (t) => `${at(rooms, t)}+${at(fb, t)}+${at(other, t)}`);
        const adr = S('wadr', 'ADR (keys weighted)', (t) => `IF(AND(${at(inOps, t)}=1,${KT()}>0),(${suKeys.map((s) => `${w.refA(C(s.keys, 3))}*${at(s.adrT, t)}`).join('+') || '0'})/${KT()}/1,0)`);
        const factor = S('wfactor', 'ADR factor (keys weighted)', (t) => `IF(AND(${at(inOps, t)}=1,${KT()}>0),(${suKeys.map((s) => `${w.refA(C(s.keys, 3))}*${at(fRow, t)}`).join('+') || '0'})/${KT()}/1,0)`);
        hotelRes.set(l.key, { win, inOps, occ, factor, adr, arn, orn, guests, rooms, fb, other, total, keys: keysTot, days, fbPct, otherPct, guestsIn });
      } else {
        const le = a.revenue?.lease;
        if (!le) continue;
        const ix = le.rentIndexation as Idx;
        const win = opsWindow(l, p, K(l, 'Rent Indexation', 'Operations start year'));
        const inOps = newRow(`rvc:${l.key}:inOps`, 'in operations');
        perT(inOps, (t) => `IF(AND(${t}>=${win.s()},${t}<=${win.e()}),1,0)`);
        const occRow = w.addr(K(l, 'Rent Indexation', 'Occupancy ramp')).row;
        const occ = newRow(`rvc:${l.key}:occ`, 'occupancy');
        perT(occ, (t) => `IF(${at(inOps, t)}=1,MAX(0,MIN(1,${shifted(occRow, off0, p, t)})),0)`);
        const fRow = newRow(`rvc:${l.key}:factor`, 'rent factor');
        perT(fRow, (t) => factorF(l, ix, t));
        const suMap: LeaseRes['su'] = new Map();
        for (const u of units) {
          const sc = newRow(`rvc:${l.key}:su:${u.id}`, `${u.name}: GLA, base rent`);
          w.fA(C(sc, 3), `MAX(0,N(${w.ref(`su:${u.id}:area`)}))`);
          w.fA(C(sc, 4), `MAX(0,IF(N(${w.ref(`su:${u.id}:rate`)})>0,N(${w.ref(`su:${u.id}:rate`)}),${Math.max(0, le.baseRate ?? 0)}))`);
          const gla = (): string => w.refA(C(sc, 3)), base = (): string => w.refA(C(sc, 4));
          const occupied = newRow(`rvc:${l.key}:${u.id}:occ`, 'occupied'); perT(occupied, (t) => `IF(${at(inOps, t)}=1,${gla()}*${at(occ, t)},0)`);
          const rate = newRow(`rvc:${l.key}:${u.id}:rate`, 'indexed rent'); perT(rate, (t) => `IF(${at(inOps, t)}=1,${base()}*${at(fRow, t)},0)`);
          const rev = newRow(`rvc:${l.key}:${u.id}:rev`, 'rent'); perT(rev, (t) => `${at(occupied, t)}*${at(rate, t)}`);
          suMap.set(u.id, { gla: sc, rate, occ: occupied, rev });
        }
        const glaTot = newRow(`rvc:${l.key}:gla`, 'GLA');
        w.fA(C(glaTot, 3), [...suMap.values()].map((s) => w.refA(C(s.gla, 3))).join('+') || '0');
        const GT = (): string => w.refA(C(glaTot, 3));
        const S = (key: string, label: string, f: (t: number) => string): number => { const r = newRow(`rvc:${l.key}:${key}`, label); perT(r, f); return r; };
        const occupied = S('occupied', 'occupied area', (t) => [...suMap.values()].map((s) => at(s.occ, t)).join('+') || '0');
        const rev = S('rev', 'lease revenue', (t) => [...suMap.values()].map((s) => at(s.rev, t)).join('+') || '0');
        const rate = S('wrate', 'indexed rent (GLA weighted)', (t) => `IF(AND(${at(inOps, t)}=1,${GT()}>0),(${[...suMap.values()].map((s) => `${w.refA(C(s.gla, 3))}*${at(s.rate, t)}`).join('+') || '0'})/${GT()},0)`);
        const factor = S('wfactor', 'rent factor (GLA weighted)', (t) => `IF(AND(${at(inOps, t)}=1,${GT()}>0),(${[...suMap.values()].map((s) => `${w.refA(C(s.gla, 3))}*${at(fRow, t)}`).join('+') || '0'})/${GT()},0)`);
        leaseRes.set(l.key, { win, inOps, occ, factor, rate, occupied, rev, gla: glaTot, su: suMap });
      }
    }
    for (let col = 1; col <= cT(N - 1); col++) cs.getColumn(col).width = col <= 3 ? 26 : 14;

    // ── The visible Revenue sheet ────────────────────────────────────────────
    const V = (key: string, col: number) => w.addr(key, col);
    const has = (key: string): boolean => w.has(key);
    /** Write a period row (t in 0..N-1) and its Total column as the platform does. */
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'none' | ((range: string) => string) = 'sum', only?: (t: number) => boolean): void => {
      if (!has(key)) return;
      const r = w.addr(key).row;
      for (let t = 0; t < N; t++) {
        if (only && !only(t)) continue;
        w.fA({ sheet: REV, row: r, col: pc(t) }, f(t));
      }
      const range = (): string => w.rangeA(REV, r, pc(0), pc(N - 1));
      if (total === 'sum') w.fA({ sheet: REV, row: r, col: TOTAL_COL }, `SUM(${range()})+N(${w.refA({ sheet: REV, row: r, col: OPEN_COL })})`);
      else if (total === 'last') w.fA({ sheet: REV, row: r, col: TOTAL_COL }, w.refA({ sheet: REV, row: r, col: pc(N - 1) }));
      else if (typeof total === 'function') w.fA({ sheet: REV, row: r, col: TOTAL_COL }, total(range()));
    };
    const cell = (key: string, t: number): string => w.refA({ sheet: REV, row: w.addr(key).row, col: pc(t) });
    const lastPos = (range: string): string => `IFERROR(LOOKUP(2,1/(${range}>0),${range}),0)`;
    const avgPos = (range: string): string => `IFERROR(AVERAGEIF(${range},">0"),0)`;
    const worst = (range: string): string => `IF(MAX(${range})<0.005,IF(-MIN(${range})<0.005,0,MIN(${range})),IF(MAX(${range})>=-MIN(${range}),MAX(${range}),MIN(${range})))`;
    const fmtRate = (x: string): string => `IF(${x}=INT(${x}),TEXT(${x},"#,##0"),TEXT(${x},"#,##0.##"))`;
    const cur = state.project.currency ?? 'SAR';

    for (const l of lines) {
      const p = phaseOf(l);
      const a = earning(l)[0];
      if (!p) continue;
      const name = revenueLineName(l);
      // Input card: the Table 5 price, read from Inputs.
      for (const u of l.subUnits) {
        const key = K(l, '', u.name || 'sub-unit');
        if (has(key) && w.has(`su:${u.id}:rate`) && typeof w.platformValue(V(key, TOTAL_COL)) === 'number') w.f(key, `N(${w.ref(`su:${u.id}:rate`)})`, { col: TOTAL_COL });
      }
      const sr = sellRes.get(l.key);
      if (sr && a) {
        // Input card: the factor and the price per year it gives.
        const fk = K(l, 'Sale price per year', 'Indexation factor');
        if (has(fk)) for (let t = 0; t < N; t++) if (w.platformValue(V(fk, pc(t))) !== undefined) w.fA(V(fk, pc(t)), at(sr.factor, t));
        for (const u of l.subUnits) {
          const lk = [...(w.reg.keys())].find((k) => k.startsWith(`${K(l, 'Sale price per year', u.name || 'sub-unit')} (`));
          const s = sr.su.get(u.id);
          if (!lk || !s) continue;
          for (let t = 0; t < N; t++) if (w.platformValue(V(lk, pc(t))) !== undefined) w.fA(V(lk, pc(t)), `IF(${w.refA(C(s.A, 6))}>0,${w.refA(C(s.A, 6))}*${at(sr.factor, t)},0)`);
          w.fA(V(lk, 1), `"${(u.name || 'sub-unit').replace(/"/g, '""')} (${cur} "&${fmtRate(w.refA(C(s.A, 6)))}&" / sqm)"`);
        }
        // 1a share sold, 1b sold, 1c inventory, 2a price, 2b revenue.
        const inv = (): string => [...sr.su.values()].map((s) => w.refA(C(s.A, 3))).join('+') || '0';
        for (const u of l.subUnits) {
          const s = sr.su.get(u.id); if (!s) continue;
          const nm = u.name || 'sub-unit';
          const A_ = (): string => w.refA(C(s.A, 3));
          const sold = (t: number): string => `(${at(s.pre.area, t)}+${at(s.post.area, t)})`;
          row(O(l, '1a.', nm), (t) => `IF(${A_()}>0,${sold(t)}/${A_()},0)`, () => `IF(${A_()}>0,(SUM(${rowRange(CALC, s.pre.area, cT(0), cT(N - 1))})+SUM(${rowRange(CALC, s.post.area, cT(0), cT(N - 1))}))/${A_()},0)`);
          row(O(l, '1b.', nm), (t) => sold(t));
          row(O(l, '2b.', nm), (t) => `${at(s.pre.rev, t)}+${at(s.post.rev, t)}`);
          const pk = [...w.reg.keys()].find((k) => k.startsWith(`${O(l, '2a.', nm)} (`));
          if (pk) {
            row(pk, (t) => `IF(${w.refA(C(s.A, 6))}>0,${w.refA(C(s.A, 6))}*${at(sr.factor, t)},0)`, 'none');
            w.fA(V(pk, 1), `"${nm.replace(/"/g, '""')} (${cur} "&${fmtRate(w.refA(C(s.A, 6)))}&" / sqm)"`);
          }
        }
        const soldAll = (t: number): string => `(${at(sr.preArea, t)}+${at(sr.postArea, t)})`;
        row(O(l, '1a.', 'Asset Total'), (t) => `IF((${inv()})>0,${soldAll(t)}/(${inv()}),0)`, () => `IF((${inv()})>0,(SUM(${rowRange(CALC, sr.preArea, cT(0), cT(N - 1))})+SUM(${rowRange(CALC, sr.postArea, cT(0), cT(N - 1))}))/(${inv()}),0)`);
        row(O(l, '1b.', 'Total pre-sales sqm'), (t) => at(sr.preArea, t));
        row(O(l, '1b.', 'Total sales during operation sqm'), (t) => at(sr.postArea, t));
        row(O(l, '1b.', 'Asset Total SQM Sold'), (t) => soldAll(t));
        const openU = O(l, '1c.', 'Opening unsold'), soldU = O(l, '1c.', 'Sold in year'), closeU = O(l, '1c.', 'Closing unsold'), chkU = O(l, '1c.', 'Check (must be zero)');
        row(closeU, (t) => `${t === 0 ? `(${inv()})` : cell(closeU, t - 1)}-${soldAll(t)}`, 'last');
        row(openU, (t) => (t === 0 ? `(${inv()})` : cell(closeU, t - 1)), 'none');
        row(soldU, (t) => `-${soldAll(t)}`);
        row(chkU, (t) => `${cell(openU, t)}+${cell(soldU, t)}-${cell(closeU, t)}`, worst);
        row(O(l, '2a.', 'Indexation factor (every sub-unit of this line)'), (t) => at(sr.factor, t), 'none');
        row(O(l, '2b.', 'Total pre-sales revenue'), (t) => at(sr.preRev, t));
        row(O(l, '2b.', 'Total sales during operation revenue'), (t) => at(sr.postRev, t));
        row(O(l, '2b.', 'Asset Total Revenue'), (t) => `${at(sr.preRev, t)}+${at(sr.postRev, t)}`);
        // 3a / 3b recognition at handover.
        const Hc = (): string => `MAX(0,MIN(${N - 1},${sr.H()}))`;
        for (let s = 0; s < N; s++) row(O(l, '3a.', `Sold in ${snap.yearLabels[s]}`), (t) => `IF(${t}=${Hc()},MAX(0,${at(sr.preRev, s)}),0)`);
        row(O(l, '3a.', 'Year Total'), (t) => at(sr.recPre, t));
        row(O(l, '3b.', 'Pre-Sales Recognised'), (t) => at(sr.recPre, t));
        row(O(l, '3b.', 'Sales During Operation Recognised'), (t) => at(sr.postRev, t));
        row(O(l, '3b.', 'Total Revenue Recognised'), (t) => `${at(sr.recPre, t)}+${at(sr.postRev, t)}`);
        // 4a the cohort grid (rows as exported), its check table, 4b cash.
        for (let s = 0; s < N; s++) {
          const yr = snap.yearLabels[s];
          const gk = [...w.reg.keys()].find((k) => k.startsWith(`${O(l, '4a.', `${yr} sale,`)}`));
          if (gk) {
            row(gk, (t) => `${at(sr.mat[s], t)}+IF(${t}=${s},${at(sr.postRev, s)},0)`);
            w.fA(V(gk, 1), `"${yr} sale, "&IF(${s}>=${sr.H()},"paid in full",TEXT(${w.refA(C(sr.mat[s], 3))}*100,"0.00")&"% down")`);
          }
          const ck = `rev|${l.key}|4achk|${yr}`;
          if (has(ck) && gk) {
            const r = w.addr(ck).row;
            w.fA({ sheet: REV, row: r, col: 2 }, `IF(${s}>=${sr.H()},1,${w.refA(C(sr.mat[s], 3))})`);
            w.fA({ sheet: REV, row: r, col: 4 }, `${at(sr.preRev, s)}+${at(sr.postRev, s)}`);
            w.fA({ sheet: REV, row: r, col: 5 }, `SUM(${w.rangeA(REV, w.addr(gk).row, pc(0), pc(N - 1))})`);
            w.fA({ sheet: REV, row: r, col: 6 }, `${w.refA({ sheet: REV, row: r, col: 5 })}-${w.refA({ sheet: REV, row: r, col: 4 })}`);
          }
        }
        row(O(l, '4a.', 'Total collected'), (t) => `${at(sr.cashPre, t)}+${at(sr.postRev, t)}`);
        row(O(l, '4b.', 'Pre-Sales Cash'), (t) => at(sr.cashPre, t));
        row(O(l, '4b.', 'Sales During Operation Cash'), (t) => at(sr.postRev, t));
        row(O(l, '4b.', 'Total Cash Collected'), (t) => `${at(sr.cashPre, t)}+${at(sr.postRev, t)}`);
        // 5 / 6 roll-forwards.
        const roll = (tbl: string, open: string, add: string, less: string, change: string, close: string, closeRow: number, flow: number): void => {
          row(O(l, tbl, close), (t) => at(closeRow, t), 'last');
          row(O(l, tbl, open), (t) => (t === 0 ? '0' : at(closeRow, t - 1)), 'none');
          row(O(l, tbl, add), (t) => `MAX(0,${at(sr.preRev, t)})`);
          row(O(l, tbl, less), (t) => `-MAX(0,${at(flow, t)})`);
          row(O(l, tbl, change), (t) => `${at(closeRow, t)}-${t === 0 ? '0' : at(closeRow, t - 1)}`);
          row(O(l, tbl, 'Check (must be zero)'), (t) => `${cell(O(l, tbl, open), t)}+${cell(O(l, tbl, add), t)}+${cell(O(l, tbl, less), t)}-${cell(O(l, tbl, close), t)}`, worst);
        };
        roll('5.', 'Opening receivable', 'Add: sales contracted', 'Less: cash collected', 'Change in receivable (cash flow delta)', 'Closing receivable', sr.arClose, sr.cashPre);
        roll('6.', 'Opening unearned', 'Add: sales contracted', 'Less: revenue recognised', 'Change in unearned (cash flow delta)', 'Closing unearned', sr.urClose, sr.recPre);
      }
      const hr = hotelRes.get(l.key);
      if (hr) {
        const KT = (): string => w.refA(C(hr.keys, 3));
        const occKey = K(l, 'ADR Indexation', 'Occupancy ramp');
        const occR = w.addr(occKey).row;
        // The average over the operations window, which moves with the phase.
        w.fA(V(occKey, TOTAL_COL), `SUM(${rowRange(CALC, hr.occ, cT(0), cT(N - 1))})/MAX(1,${hr.win.e()}-${hr.win.s()}+1)`);
        void occR;
        w.f(K(l, '', 'Keys the engine counts'), KT(), { col: TOTAL_COL });
        const mask = (t: number): string => `IF(${at(hr.arn, t)}>0,1,0)`;
        row(O(l, '1.', 'Total Rooms (Keys)'), (t) => `${mask(t)}*${KT()}`, () => KT());
        row(O(l, '1.', 'Days per Year'), (t) => `${mask(t)}*${hr.days()}`, () => hr.days());
        // A LINE's rates are struck on its sums (lineRevenueResults / sumHospitalityResults):
        // occupancy = ORN / ARN, ADR = rooms / ORN, the factor weighted by ARN.
        row(O(l, '1.', 'Occupancy %'), (t) => `IF(${at(hr.arn, t)}>0,${at(hr.orn, t)}/${at(hr.arn, t)},0)`, avgPos);
        row(O(l, '1.', 'ADR Indexation Factor'), (t) => `IF(${at(hr.arn, t)}>0,${at(hr.factor, t)}*${at(hr.arn, t)}/${at(hr.arn, t)},0)`, lastPos);
        row(O(l, '1.', `ADR (${cur} per occupied room night)`), (t) => `IF(${at(hr.orn, t)}>0,${at(hr.rooms, t)}/${at(hr.orn, t)},0)`, lastPos);
        row(O(l, '1.', 'F&B % of Rooms Revenue'), (t) => `${mask(t)}*MAX(0,${hr.fbPct()})`, () => `MAX(0,${hr.fbPct()})`);
        row(O(l, '1.', 'Other % of Rooms Revenue'), (t) => `${mask(t)}*MAX(0,${hr.otherPct()})`, () => `MAX(0,${hr.otherPct()})`);
        row(O(l, '1.', 'Available Room Nights'), (t) => at(hr.arn, t));
        row(O(l, '1.', 'Occupied Room Nights'), (t) => at(hr.orn, t));
        const gk = [...w.reg.keys()].find((k) => k.startsWith(`${O(l, '1.', 'Guests per Year (x ')}`));
        if (gk) {
          row(gk, (t) => at(hr.guests, t));
          w.fA(V(gk, 1), `"Guests per Year (x "&TEXT(MAX(0,${hr.guestsIn()}),"0.00")&" guests / ORN)"`);
        }
        row(O(l, '2.', 'Rooms Revenue'), (t) => at(hr.rooms, t));
        row(O(l, '2.', 'F&B Revenue'), (t) => at(hr.fb, t));
        row(O(l, '2.', 'Other Revenue'), (t) => at(hr.other, t));
        row(O(l, '2.', 'Total Hospitality Revenue'), (t) => at(hr.total, t));
      }
      const lr = leaseRes.get(l.key);
      if (lr) {
        const occKey = K(l, 'Rent Indexation', 'Occupancy ramp');
        const occR = w.addr(occKey).row;
        w.fA(V(occKey, TOTAL_COL), `SUM(${rowRange(CALC, lr.occ, cT(0), cT(N - 1))})/MAX(1,${lr.win.e()}-${lr.win.s()}+1)`);
        void occR;
        const GT = (): string => w.refA(C(lr.gla, 3));
        row(O(l, '1.', 'Total Gross Lease Area (sqm)'), (t) => `IF(${at(lr.occupied, t)}>0,${GT()},0)`, () => GT());
        // A LINE's rates are struck on its sums (sumLeaseResults): occupancy = occupied / GLA,
        // the rate = revenue / occupied area, the factor weighted by GLA.
        row(O(l, '1.', 'Occupancy %'), (t) => `IF(${GT()}>0,${at(lr.occupied, t)}/${GT()},0)`, avgPos);
        row(O(l, '1.', 'Rent Indexation Factor'), (t) => `IF(${GT()}>0,${at(lr.factor, t)}*${GT()}/${GT()},0)`, lastPos);
        row(O(l, '1.', l.subUnits.length > 1 ? `Indexed Rate (GLA-weighted avg, ${cur} per sqm/yr)` : `Indexed Rate (${cur} per sqm/yr)`), (t) => `IF(${at(lr.occupied, t)}>0,${at(lr.rev, t)}/${at(lr.occupied, t)},0)`, lastPos);
        for (const u of l.subUnits) {
          const s = lr.su.get(u.id); if (!s) continue;
          const nm = u.name || 'sub-unit';
          const rk = [...w.reg.keys()].find((k) => k.startsWith(`${O(l, '1.', `${nm} Indexed Rate (`)}`));
          if (rk) {
            row(rk, (t) => at(s.rate, t), lastPos);
            w.fA(V(rk, 1), `"${nm.replace(/"/g, '""')} Indexed Rate ("&TEXT(ROUND(MAX(0,${w.refA(C(s.gla, 3))}),0),"#,##0")&" sqm GLA)"`);
          }
          row(O(l, '1.', `${nm} Occupied Area (sqm)`), (t) => at(s.occ, t));
          row(O(l, '2.', `${nm} Rent Revenue`), (t) => at(s.rev, t));
        }
        row(O(l, '1.', 'Total Occupied Lease Area (sqm)'), (t) => at(lr.occupied, t));
        row(O(l, '2.', 'Total Lease Revenue'), (t) => at(lr.rev, t));
      }
      void name;
    }

    // The project totals, three views, grouped by section as the builder groups them.
    const lineSeries = (l: RevenueLine, view: 'revenue' | 'recognition' | 'cash', seg: 'pre' | 'post' | 'all', t: number): string => {
      const sr = sellRes.get(l.key);
      if (sr) {
        const pre = view === 'revenue' ? at(sr.preRev, t) : view === 'recognition' ? at(sr.recPre, t) : at(sr.cashPre, t);
        const post = at(sr.postRev, t);
        return seg === 'pre' ? pre : seg === 'post' ? post : `(${pre}+${post})`;
      }
      const hr = hotelRes.get(l.key); if (hr) return at(hr.total, t);
      const lr = leaseRes.get(l.key); if (lr) return at(lr.rev, t);
      return '0';
    };
    const views: Array<['revenue' | 'recognition' | 'cash', string]> = [['revenue', 'Project Revenue (Sales Value year-on-year)'], ['recognition', 'Project Revenue Recognised'], ['cash', 'Project Cash Collected']];
    for (const [view, title] of views) {
      const P = (label: string): string => `rev|__project__|${title}|${label}`;
      const sectionTotals: string[] = [];
      for (const g of groupRevenueLines(lines)) {
        const sells = g.lines.filter((l) => l.form === 'sell');
        const ops = g.lines.filter((l) => l.form !== 'sell');
        const parts: string[] = [];
        if (sells.length && view === 'revenue') {
          for (const l of sells) { row(P(revenueLineName(l)), (t) => lineSeries(l, view, 'all', t)); parts.push(P(revenueLineName(l))); }
        } else if (sells.length) {
          for (const l of sells) row(P(revenueLineName(l)), (t) => lineSeries(l, view, 'pre', t));
          row(P('Total Pre-Sales'), (t) => sells.map((l) => cell(P(revenueLineName(l)), t)).join('+'));
          for (const l of sells) row(P(`${revenueLineName(l)}~1`), (t) => lineSeries(l, view, 'post', t));
          row(P('Total Sales During Operation'), (t) => sells.map((l) => cell(P(`${revenueLineName(l)}~1`), t)).join('+'));
          parts.push(P('Total Pre-Sales'), P('Total Sales During Operation'));
        }
        for (const l of ops) { row(P(revenueLineName(l)), (t) => lineSeries(l, view, 'all', t)); parts.push(P(revenueLineName(l))); }
        row(P(`Total ${g.section}`), (t) => parts.filter(has).map((k) => cell(k, t)).join('+') || '0');
        sectionTotals.push(P(`Total ${g.section}`));
      }
      row(P('Total Project'), (t) => sectionTotals.filter(has).map((k) => cell(k, t)).join('+') || '0');
    }

    return [
      { sheet: REV, status: 'partial' as const, formulas: w.formulas.get(REV) ?? 0,
        note: 'Live on this sheet: the input cards (prices from the Inputs sheet, velocities, downpayments, instalment years, occupancy, F&B and other shares, operations start) and the Revenue Output for every line: share sold, units and area sold, closing inventory, price per year, revenue, recognition, the sale cohort grid and its check, cash, the receivable and unearned roll-forwards, the hotel and lease statements, and the three project totals, computed on a hidden working sheet (Revenue Calc). The indexation rates and start years and the days per year are listed as inputs at the foot of the sheet. Not yet live: selling costs, Cost of Sales, Schedules and Escrow, which read capitalised interest and Capex (their own stages).' },
    ];
  },
};
