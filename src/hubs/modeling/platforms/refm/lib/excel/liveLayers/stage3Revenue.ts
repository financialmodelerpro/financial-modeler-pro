/**
 * stage3Revenue.ts (2026-09-27, rebuilt 2026-10-15, shortened 2026-10-27), FORMULA-LINKED EXPORT: REVENUE.
 *
 * ONE PATH PER LINE (founder, 2026-10-27): drivers, sales, revenue recognised, cash
 * collected, then one summary block. There are no input cards: every formula reads
 * the input where it is typed on Inputs. The engine's rules, row by row:
 *
 *   SELL, per sub-unit. "Velocity" is the velocity typed on Inputs at the years it
 *     applies to now: a construction grid (pre-sales, the downpayment) by
 *     construction year and an operating grid (sales during operation, occupancy)
 *     by operating year, each read through the Timeline's year counters. The engine
 *     sells the pre-sales years first, then the operation years, which is the order
 *     of the years, so one "sqm sold" row carries both passes: each year sells the
 *     velocity share of the inventory rounded to whole sqm, and takes exactly what is
 *     still unsold once the share reaches it or the typed velocity reaches 100%
 *     (sell.ts). A sale up to the handover year is a pre-sale, after it a sale during
 *     operation. Revenue = sqm sold x the Inputs price x the indexation factor.
 *     Pre-sales are recognised in the handover year (their running total x the
 *     Timeline's handover flag); a sale during operation as it is sold. Each pre-sales
 *     year's cohort pays its downpayment in the year it sells and the balance in equal
 *     instalments over the instalment years (the lesser of the maximum and the years
 *     left to handover); a sale in the handover year pays in full. A sale during
 *     operation is collected in its year. The receivable and the unearned revenue are
 *     running totals.
 *   HOTEL. In operation from the operations start year to the last operating year;
 *     keys x days x occupancy; ADR = the Inputs rate x the indexation factor; F&B and
 *     other as shares of rooms revenue.
 *   LEASE. Lettable area x occupancy, x the Inputs rent x the factor.
 *
 * Its checks sit on the Checks tab: typed velocity inside the model years, pre-sales
 * collected in full, and a handover-year downpayment a sale in that year does not use.
 *
 * REFUSES by name (Revenue stays values) what it does not express: another
 * indexation method, recognition other than at handover, a handover override,
 * instalments past handover, a sales pace lever, a lockstep velocity row, a
 * sub-unit sold by units, a downpayment carried or defaulted, an input stored
 * where the sheet does not show it, a year carrying both a pre-sales and an
 * operation velocity, an operation velocity before the last pre-sales year, a
 * phase with no construction years, F&B or other not a flat share of rooms, a
 * rental pool, an occupancy lever, a stored ADR, a hotel line with more than one
 * room type, a line whose revenue sits on more than one plot, and an exit before
 * the last year.
 *
 * No em dashes in this file.
 */
import type { LayerContext, LiveLayer } from '../formulaWorkbook';
import type { CellAddr } from '../cellRegistry';
import { LiveWriter } from './writer';
import { statedLineReceivableDays } from '../../receivableDays';
import { PERIOD_COLS } from '../buildModelWorkbook';
import { NUMFMT, colLetter } from '../styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { resolveAssetTypeKey } from '../../state/assetTypeStandards';
import { resolveSubUnitMetric, isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, groupRevenueLines, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { resolveRowVelocity, occupancyAxis } from '../../revenue-resolvers';
import { hasAnyDownpayment } from '@/src/core/calculations/revenue/cohortTerms';
import type { Asset, Phase, SubUnit } from '../../state/module1-types';

const REV = 'Revenue';
const CHK = 'Checks';
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
    const has = (k: string): boolean => w.has(k);
    const phases = state.phases as Phase[];
    const subUnits = state.subUnits as SubUnit[];
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const revRows = (a: Asset): SubUnit[] => subUnits.filter((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const nm = (u: SubUnit): string => u.name || 'sub-unit';
    /** A row of a line on this tab: `rev|<line>|<table id>|<label>` (the builder's liveOutput). */
    const O = (line: RevenueLine, table: string, label: string): string => `rev|${line.key}|${table}|${label}`;
    const byPrefix = (prefix: string): string | undefined => reg.keys().find((k) => k.startsWith(prefix));

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    const phaseOf = (l: RevenueLine): Phase | undefined => phases.find((p) => p.id === l.phaseId);
    const earning = (l: RevenueLine): Asset[] => l.members.filter((m) => revRows(m).length > 0);
    const offsetAt = (p: Phase): number => new Date(p.startDate as string).getUTCFullYear() - snap.revenue.projectStartYear;
    /** A value stored for a year the sheet's row does not show cannot be expressed. */
    const shownOrZero = (name: string, byPhase: readonly (number | null | undefined)[] | undefined, off: number, rowKey: string | undefined): void => {
      if (!byPhase) return;
      const row = rowKey && has(rowKey) ? w.addr(rowKey).row : undefined;
      byPhase.forEach((v, i) => {
        if (!(typeof v === 'number' && v !== 0)) return;
        const t = off + i;
        const shown = row !== undefined && t >= 0 && t < N && w.platformValue({ sheet: REV, row, col: pc(t) }) !== undefined;
        if (!shown) refuse.push(`${name}: a value is stored for a year the sheet does not show`);
      });
    };
    /** The year of the phase (0-based) a hotel or lease line opens in: the resolver's own rule. */
    const opsLocalOf = (p: Phase, override: number | undefined): number => {
      const cs = Math.max(0, Math.min(N - 1, offsetAt(p))), hand = Math.max(cs, Math.min(N - 1, cs + Math.max(0, p.constructionPeriods ?? 0) - 1));
      const dflt = Math.max(cs, Math.min(N - 1, hand + 1));
      return (override != null ? Math.max(cs, Math.min(N - 1, override - snap.revenue.projectStartYear)) : dflt) - cs;
    };
    const idxOf = (l: RevenueLine, a: Asset): Idx => (l.form === 'sell' ? a.revenue?.sell?.indexation : l.form === 'operate' ? a.revenue?.operate?.adrIndexation : a.revenue?.lease?.rentIndexation) as Idx;
    for (const l of lines) {
      const p = phaseOf(l);
      if (!p) continue;
      const name = revenueLineName(l);
      const earners = earning(l);
      if (earners.length > 1) refuse.push(`${name}: revenue sits on more than one plot`);
      const a = earners[0] ?? l.host;
      if (earners.length && (p.constructionPeriods ?? 0) < 1) refuse.push(`${name}: its phase has no construction years`);
      if (!has(`tl:phase:${p.id}:hy`) || !has('tl:horizon')) refuse.push(`${name}: the Timeline's phase years are not live`);
      if (!has(`tl:ctr:${p.id}:con`) || !has(`tl:ctr:${p.id}:ops`)) refuse.push(`${name}: the Timeline's year counters are not live`);
      if (!has(`tl:flag:${p.id}:hand`)) refuse.push(`${name}: the Timeline's handover flag is not live`);
      const ix = idxOf(l, a);
      if (!IDX_METHODS.has(ix?.method ?? 'none')) refuse.push(`${name}: indexation ${ix?.method}`);
      if ((ix?.method ?? 'none') !== 'none' && earners.length && (!has(`rxin|${l.key}|rate`) || !has(`rxin|${l.key}|from`))) refuse.push(`${name}: its indexation has no rate on Inputs`);
      const off = offsetAt(p);
      if (l.form !== 'sell' && statedLineReceivableDays(a) !== statedLineReceivableDays(l.host)) refuse.push(`${name}: the earning plot and the line card state different receivable days`);
      if (l.form !== 'sell' && earners.length && !has(`rxin|${l.key}|arDays`)) refuse.push(`${name}: its receivable days are not on Inputs`);
      if (l.form === 'sell') {
        const sell = a.revenue?.sell;
        if (!sell) continue;
        const rec = sell.recognitionProfile;
        if (rec && !(rec.method === 'point_in_time' && (rec.pointInTimeYear ?? 'handover') === 'handover')) refuse.push(`${name}: recognition is not at handover`);
        if (sell.handoverYearOverride != null) refuse.push(`${name}: a handover year override`);
        if (sell.instalmentsStopAtHandover === false) refuse.push(`${name}: instalments run past handover`);
        if (sell.paceFactor != null && sell.paceFactor !== 1) refuse.push(`${name}: a sales pace lever`);
        if (sell.velocityDefault && l.subUnits.length > 1) refuse.push(`${name}: a lockstep velocity row`);
        if (!hasAnyDownpayment(sell.downpaymentByPhase)) refuse.push(`${name}: no downpayment of its own`);
        if (!has(`rxin|${l.key}|inst`)) refuse.push(`${name}: its instalment years are not on Inputs`);
        for (let k = 0; k < Math.max(0, p.constructionPeriods ?? 0); k++) {
          const v = sell.downpaymentByPhase?.[k];
          if (!(typeof v === 'number' && Number.isFinite(v))) refuse.push(`${name}: a sale year's downpayment is carried, not typed`);
          else if (!has(`rxgrid|${l.key}|dp@${k + 1}`)) refuse.push(`${name}: a sale year's downpayment is not on Inputs`);
        }
        for (const u of revRows(a)) {
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} is sold by units`);
          const v = resolveRowVelocity(sell, u.id, p);
          if (v.source !== 'none' && v.postOps === undefined && (v.post ?? []).some((x) => (x ?? 0) !== 0)) refuse.push(`${name}: ${u.name}'s sales during operation are still keyed by year of the phase`);
          if (v.pre === undefined && (v.preLegacy ?? []).some((x) => x)) refuse.push(`${name}: velocity held on the legacy axis`);
          if (v.post === undefined && (v.postLegacy ?? []).some((x) => x)) refuse.push(`${name}: velocity held on the legacy axis`);
          // One chronological row carries both passes only while every pre-sales year comes first.
          const pre = (v.pre ?? []).map((x, i) => ((x ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
          const post = (v.post ?? []).map((x, i) => ((x ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
          if (pre.some((i) => post.includes(i))) refuse.push(`${name}: ${u.name} has a pre-sales and an operation velocity in the same year`);
          else if (pre.length && post.length && Math.min(...post) < Math.max(...pre)) refuse.push(`${name}: ${u.name} sells during operation before its last pre-sales year`);
          shownOrZero(`${name} pre-sales velocity`, v.pre, off, O(l, 's', `${nm(u)}: velocity`));
          shownOrZero(`${name} sales during operation`, v.post, off, O(l, 's', `${nm(u)}: velocity`));
          if (!has(`su:${u.id}:area`) || !has(`su:${u.id}:rate`)) refuse.push(`${name}: ${u.name}'s area or price is not on Inputs`);
        }
      } else if (l.form === 'operate') {
        const op = a.revenue?.operate;
        if (!op) continue;
        if ((op.fb?.mode ?? 'percent_of_rooms') !== 'percent_of_rooms' || Array.isArray(op.fb?.percentOfRooms) || op.fb?.percentOfRoomsByPhase !== undefined) refuse.push(`${name}: F&B is not a flat share of rooms`);
        if ((op.otherRevenue?.mode ?? 'percent_of_rooms') !== 'percent_of_rooms' || Array.isArray(op.otherRevenue?.percentOfRooms) || op.otherRevenue?.percentOfRoomsByPhase !== undefined) refuse.push(`${name}: other revenue is not a flat share of rooms`);
        if (op.keysParticipationProfile !== undefined || op.keysParticipationProfileByPhase !== undefined) refuse.push(`${name}: a rental pool`);
        if (op.occupancyShiftPts) refuse.push(`${name}: an occupancy lever`);
        if (revRows(a).length > 1) refuse.push(`${name}: more than one room type`);
        if (!has(`rxin|${l.key}|days`)) refuse.push(`${name}: its days per year are not on Inputs`);
        if (!has(`rxin|${l.key}|guests`) || !has(`rxin|${l.key}|fb`) || !has(`rxin|${l.key}|other`)) refuse.push(`${name}: its guests, F&B or other share is not on Inputs`);
        for (const u of revRows(a)) {
          if ((u.startingAdr ?? 0) > 0) refuse.push(`${name}: ${u.name} stores an ADR of its own`);
          if (u.hospitalityIndexation) refuse.push(`${name}: ${u.name} has its own ADR indexation`);
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} counts keys`);
          if (!has(`su:${u.id}:area`) || !has(`su:${u.id}:rate`)) refuse.push(`${name}: ${u.name}'s area or ADR is not on Inputs`);
        }
        shownOrZero(`${name} occupancy`, occupancyAxis(op, opsLocalOf(p, op.operationsStartYearOverride), off, N).slice(Math.max(0, off)), off, O(l, 'o', 'Occupancy'));
        if (op.occupancyByOpsYear === undefined) refuse.push(`${name}: its occupancy is still keyed by year of the phase`);
      } else {
        const le = a.revenue?.lease;
        if (!le) continue;
        if (le.occupancyShiftPts) refuse.push(`${name}: an occupancy lever`);
        for (const u of revRows(a)) {
          if (!((u.unitPrice ?? 0) > 0) && (le.baseRate ?? 0) > 0) refuse.push(`${name}: ${u.name} takes the line's base rent`);
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} is let by units`);
          if (!has(`su:${u.id}:area`) || !has(`su:${u.id}:rate`)) refuse.push(`${name}: ${u.name}'s area or rent is not on Inputs`);
        }
        shownOrZero(`${name} occupancy`, occupancyAxis(le, opsLocalOf(p, le.operationsStartYearOverride), off, N).slice(Math.max(0, off)), off, O(l, 'o', 'Occupancy'));
        if (le.occupancyByOpsYear === undefined) refuse.push(`${name}: its occupancy is still keyed by year of the phase`);
      }
    }
    if (snap.disposal.booked && snap.disposal.exitIdx < N - 1 && lines.some((l) => l.form !== 'sell')) refuse.push('the exit falls before the last year, which stops the hotel and lease lines trading after it');
    if (refuse.length) {
      return [{ sheet: REV, status: 'values' as const, formulas: 0, note: `Revenue could not be made live for this model: ${[...new Set(refuse)].join('; ')}.` }];
    }

    // ── Writing helpers ──────────────────────────────────────────────────────
    const at = (key: string, col: number): CellAddr => ({ sheet: w.addr(key).sheet, row: w.addr(key).row, col });
    /** This year's cell of a registered row (column relative; no sheet name on this tab). */
    const P = (key: string, t: number): string => w.refP(at(key, pc(t)), REV);
    /** The cell of a registered row one year to the left (the opening column for year 1). */
    const Prev = (key: string, t: number): string => w.refP(at(key, pc(t) - 1), REV);
    /** A fixed cell of a registered row. */
    const A = (key: string, col: number): string => w.refA(at(key, col), REV);
    /** A fixed cell, any column of a row on this tab. */
    const AR = (row: number, col: number): string => w.refA({ sheet: REV, row, col }, REV);
    const yr = (t: number): string => w.refP({ sheet: REV, row: 3, col: pc(t) }, REV);
    const rowOf = (key: string): number => w.addr(key).row;
    const span = (row: number): string => { for (let t = 0; t < N; t++) w.refP({ sheet: REV, row, col: pc(t) }, REV); return `$${colLetter(pc(0))}$${row}:$${colLetter(pc(N - 1))}$${row}`; };
    /** From the first year to this one, on a row of this tab: a running total. */
    const toDate = (key: string, t: number): string => { const r = rowOf(key); w.refP({ sheet: REV, row: r, col: pc(t) }, REV); return `SUM($${colLetter(pc(0))}$${r}:${colLetter(pc(t))}$${r})`; };
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'none' | (() => string) = 'sum'): void => {
      if (!has(key)) return;
      const r = rowOf(key);
      for (let t = 0; t < N; t++) w.fA({ sheet: REV, row: r, col: pc(t) }, f(t));
      const T = { sheet: REV, row: r, col: TOTAL_COL };
      if (total === 'sum') w.fA(T, `SUM(${span(r)})`);
      else if (total === 'last') w.fA(T, AR(r, pc(N - 1)));
      else if (typeof total === 'function') w.fA(T, total());
    };
    const TL = (p: Phase, k: string): string => w.ref(`tl:phase:${p.id}:${k}`);
    /** An Inputs cell registered on its value (column B for a single figure). */
    const IN = (key: string): string => w.ref(key);
    /**
     * AN INPUTS GRID (2026-10-26). Inputs registers each cell `rxgrid|<grid>@<n>`, n the
     * construction year of a construction grid or the operating year of an operating grid.
     */
    const gridOf = (grid: string): { k0: number; n: number; range: string } | undefined => {
      const ks = reg.keys().filter((k) => k.startsWith(`rxgrid|${grid}@`)).map((k) => Number(k.slice(k.lastIndexOf('@') + 1))).sort((x, y) => x - y);
      if (!ks.length) return undefined;
      const first = w.addr(`rxgrid|${grid}@${ks[0]}`), last = w.addr(`rxgrid|${grid}@${ks[ks.length - 1]}`);
      for (const k of ks) w.refA(w.addr(`rxgrid|${grid}@${k}`), REV);
      return { k0: ks[0], n: ks.length, range: `${w.refA(first, REV)}:$${colLetter(last.col)}$${last.row}` };
    };
    /** A grid read by a year counter `y` (1, 2, 3 ..., 0 outside its years); its length is read from Inputs. */
    const atYear = (g: { k0: number; n: number; range: string } | undefined, y: string, clamp01 = false): string => {
      if (!g) return '0';
      const k = g.k0 === 1 ? y : `${y}-${g.k0 - 1}`;
      const v = `INDEX(${g.range},${k})`;
      return `IF(AND(${k}>=1,${k}<=COLUMNS(${g.range})),${clamp01 ? `MIN(1,MAX(0,${v}))` : v},0)`;
    };
    /** The Timeline's construction or operating year number of phase p, in year t's column. */
    const ctr = (p: Phase, kind: 'con' | 'ops', t: number): string => w.refP({ sheet: 'Timeline', row: w.addr(`tl:ctr:${p.id}:${kind}`).row, col: pc(t) }, REV);
    /** The Timeline's handover flag of phase p (1 in the handover year). */
    const handF = (p: Phase, t: number): string => w.refP({ sheet: 'Timeline', row: w.addr(`tl:flag:${p.id}:hand`).row, col: pc(t) }, REV);
    /** The indexation factor of the line for year t, from the rate and start year on Inputs. */
    const factorF = (l: RevenueLine, idx: Idx, t: number): string => {
      const m = idx?.method ?? 'none';
      if (m === 'none') return '1';
      const rate = w.ref(`rxin|${l.key}|rate`, 2), from = `MAX(${w.ref('project:axisYear')},${w.ref(`rxin|${l.key}|from`, 2)})`;
      return m === 'yoy_compound' ? `(1+${rate})^MAX(0,${yr(t)}-${from})` : `IF(${yr(t)}>=${from},1+${rate},1)`;
    };
    /** A block of rows on this tab, this year's column, as one SUM (or a single cell). */
    const sumRows = (rows: number[], t: number): string => {
      if (!rows.length) return '0';
      const sorted = [...rows].sort((x, y) => x - y);
      for (const r of sorted) w.refP({ sheet: REV, row: r, col: pc(t) }, REV);
      const c = colLetter(pc(t));
      const contiguous = sorted.every((r, i) => i === 0 || r === sorted[i - 1] + 1);
      if (sorted.length === 1) return `${c}$${sorted[0]}`;
      return contiguous ? `SUM(${c}$${sorted[0]}:${c}$${sorted[sorted.length - 1]})` : sorted.map((r) => `${c}$${r}`).join('+');
    };
    const claim = (k: string, at2: string): void => { if (has(at2) && !has(k)) w.claim(k, REV, rowOf(at2), 1); };
    /** What the summary block links, per line. */
    const lineTotals = new Map<string, { value: (t: number) => string; rec: (t: number) => string; cash: (t: number) => string }>();
    /** Formulas for the Checks rows, written once every line is placed. */
    const checks: Array<() => void> = [];
    const chkCell = (key: string, dc: number): CellAddr => ({ sheet: CHK, row: w.addr(key).row, col: w.addr(key).col + dc });

    // ── Each line ────────────────────────────────────────────────────────────
    for (const l of lines) {
      const p = phaseOf(l);
      const a = earning(l)[0];
      if (!p || !a) continue;
      const units = revRows(a);
      const before = (t: number): string => `(${yr(t)}<=${TL(p, 'hy')})`;
      const idx = idxOf(l, a);

      if (l.form === 'sell' && a.revenue?.sell) {
        const S = (label: string): string => O(l, 's', label);
        const area = (u: SubUnit): string => w.ref(`su:${u.id}:area`);
        // Velocity in force: the pre-sales and operation grids on Inputs, at the Timeline's year numbers.
        for (const u of units) {
          const gPre = gridOf(`${l.key}|pre|${nm(u)}`), gPost = gridOf(`${l.key}|post|${nm(u)}`);
          row(S(`${nm(u)}: velocity`), (t) => [gPre ? atYear(gPre, ctr(p, 'con', t)) : '', gPost ? atYear(gPost, ctr(p, 'ops', t)) : ''].filter(Boolean).join('+') || '0');
        }
        // Sqm sold: the velocity share of the inventory, rounded to whole sqm, or exactly what is still
        // unsold once the share reaches it or the typed velocity reaches 100%. The one tolerance is the
        // engine's on the typed total (typed shares can add to 0.9999999999999999).
        for (const u of units) {
          const vk = S(`${nm(u)}: velocity`), sk = S(`${nm(u)}: sqm sold`), uk = S(`${nm(u)}: sqm unsold at year end`);
          if (!has(vk) || !has(sk) || !has(uk)) continue;
          row(sk, (t) => {
            const v = P(vk, t), A_ = area(u), left = Prev(uk, t);
            return `IF(${v}=0,0,IF(OR(${toDate(vk, t)}>=1-1E-9,${v}*${A_}>=${left}),${left},ROUND(${A_}*${v},0)))`;
          });
          // Unsold at the year end: the inventory in the opening column, less each year's sales.
          w.fA({ sheet: REV, row: rowOf(uk), col: OPEN_COL }, area(u));
          row(uk, (t) => `${Prev(uk, t)}-${P(sk, t)}`, 'last');
        }
        const fk = S('Price indexation factor');
        row(fk, (t) => factorF(l, idx, t), 'none');
        const suRev: number[] = [];
        for (const u of units) {
          const rk = S(`${nm(u)}: revenue`);
          if (!has(rk)) continue;
          row(rk, (t) => `${P(S(`${nm(u)}: sqm sold`), t)}*${w.ref(`su:${u.id}:rate`)}*${P(fk, t)}`);
          suRev.push(rowOf(rk));
        }
        const preRev = S('Pre-sales revenue'), postRev = S('Sales during operation revenue');
        row(preRev, (t) => `${before(t)}*${sumRows(suRev, t)}`);
        row(postRev, (t) => `(1-${before(t)})*${sumRows(suRev, t)}`);
        // Recognised: the pre-sales to date, in the handover year.
        const recPre = O(l, 'r', 'Pre-sales revenue recognised in the handover year');
        row(recPre, (t) => `${toDate(preRev, t)}*${handF(p, t)}`);
        // Collections: one row per pre-sales year, its down % and instalment years beside it.
        const gDp = gridOf(`${l.key}|dp`);
        const cohortRows: number[] = [];
        for (let s = 0; s < N; s++) {
          const ck = O(l, 'c', `${snap.yearLabels[s]} sales: cash collected`);
          if (!has(ck)) continue;
          const cr = rowOf(ck), sy = AR(3, pc(s));
          const B = AR(cr, 2), C = AR(cr, 3);
          const dp = atYear(gDp, w.refA({ sheet: 'Timeline', row: w.addr(`tl:ctr:${p.id}:con`).row, col: pc(s) }, REV), true);
          w.fA({ sheet: REV, row: cr, col: 2 }, `IF(${sy}>=${TL(p, 'hy')},1,${dp})`, { numFmt: NUMFMT.pct });
          w.fA({ sheet: REV, row: cr, col: 3 }, `IF(${sy}>=${TL(p, 'hy')},0,MIN(INT(${IN(`rxin|${l.key}|inst`)}),${TL(p, 'hy')}-${sy}))`, { numFmt: NUMFMT.int });
          const pre = AR(rowOf(preRev), pc(s));
          row(ck, (t) => `IF(${yr(t)}=${sy},IF(${C}=0,1,${B})*${pre},IF(AND(${yr(t)}>${sy},${yr(t)}<=${sy}+${C}),(1-${B})*${pre}/${C},0))`);
          w.fA({ sheet: REV, row: cr, col: 1 }, `${sy}&" sales: cash collected"`);
          cohortRows.push(cr);
        }
        const preCash = O(l, 'c', 'Pre-sales cash collected'), postCash = O(l, 'c', 'Sales during operation cash collected');
        row(preCash, (t) => sumRows(cohortRows, t));
        row(postCash, (t) => P(postRev, t));
        // Balances: running totals of what was billed less what was collected or recognised.
        const ar = O(l, 'b', 'Receivable at year end'), ur = O(l, 'b', 'Unearned revenue at year end');
        row(ar, (t) => `${toDate(preRev, t)}-${toDate(preCash, t)}`, 'last');
        row(ur, (t) => `${toDate(preRev, t)}-${toDate(recPre, t)}`, 'last');
        lineTotals.set(l.key, {
          value: (t) => `${P(preRev, t)}+${P(postRev, t)}`,
          rec: (t) => `${P(recPre, t)}+${P(postRev, t)}`,
          cash: (t) => `${P(preCash, t)}+${P(postCash, t)}`,
        });
        // What later tabs read, at the rows that now hold it.
        claim(`rvc:${l.key}:preRev`, preRev); claim(`rvc:${l.key}:postRev`, postRev);
        claim(`rvc:${l.key}:cashPre`, preCash); claim(`rvc:${l.key}:recPre`, recPre);
        claim(`rvc:${l.key}:ar`, ar); claim(`rvc:${l.key}:ur`, ur);
        claim(`rvc:${l.key}:factor`, fk);
        for (const u of units) { claim(`rvc:${l.key}:${u.id}:pre:area`, S(`${nm(u)}: sqm sold`)); claim(`rvc:${l.key}:${u.id}:pre:rev`, S(`${nm(u)}: revenue`)); }
        // Checks: typed velocity inside the model years; pre-sales collected; the handover-year downpayment.
        checks.push(() => {
          for (const u of units) {
            const key = `chk|vel|${l.key}|${nm(u)}`, vk = S(`${nm(u)}: velocity`);
            if (!has(key) || !has(vk)) continue;
            const grids = [gridOf(`${l.key}|pre|${nm(u)}`), gridOf(`${l.key}|post|${nm(u)}`)].filter((g): g is NonNullable<typeof g> => !!g);
            const res = w.addr(key);
            w.fA(res, `${grids.length ? grids.map((g) => `SUM(${g.range.replace(/^\$/, 'Inputs!$')})`).join('+') : '0'}-SUM(${w.rangeA(REV, rowOf(vk), pc(0), pc(N - 1))})`, { numFmt: NUMFMT.pct2 });
            const C = w.refA(res, CHK);
            w.fA(chkCell(key, -1), `IF(${C}>0.000001,"CHECK","OK")`);
            w.fA(chkCell(key, 1), `IF(${C}>0.000001,TEXT(${C},"0.00%")&" of typed velocity is outside the model years","All typed velocity is inside the model years")`);
          }
          const ck = `chk|col|${l.key}`;
          if (has(ck)) {
            const res = w.addr(ck);
            w.fA(res, `SUM(${w.rangeA(REV, rowOf(preRev), pc(0), pc(N - 1))})-SUM(${w.rangeA(REV, rowOf(preCash), pc(0), pc(N - 1))})`);
            const C = w.refA(res, CHK);
            w.fA(chkCell(ck, -1), `IF(ABS(${C})<0.005,"OK","CHECK")`);
            w.fA(chkCell(ck, 1), `IF(ABS(${C})<0.005,"Every pre-sale is collected by the handover year","Pre-sales billed less collected")`);
          }
          const dk = `chk|dp|${l.key}`;
          if (has(dk) && gDp) {
            const res = w.addr(dk);
            const k = `(${TL(p, 'hy')}-YEAR(${TL(p, 'cs')})+1)`;
            w.fA(res, atYear({ ...gDp, range: gDp.range.startsWith('Inputs!') ? gDp.range : `Inputs!${gDp.range}` }, k), { numFmt: NUMFMT.pct });
            const C = w.refA(res, CHK), St = w.refA(chkCell(dk, -1), CHK);
            w.fA(chkCell(dk, -1), `IF(AND(${C}>0,${C}<1),"NOTE","OK")`);
            w.fA(chkCell(dk, 1), `IF(${St}="NOTE","A handover-year sale pays in full; the "&TEXT(${C},"0%")&" typed is unused","No downpayment typed for the handover year")`);
          }
        });
        continue;
      }

      // HOTEL and LEASE: drivers, then the years in operation.
      const isOp = l.form === 'operate';
      const D = (label: string): string => O(l, 'd', label), R = (label: string): string => O(l, 'o', label);
      // The operations start in force: the override on Inputs (never before construction starts), else the year after handover.
      const startKey = D('Operations start year');
      const ovKey = `oxin|opsStart|${l.key}`;
      if (has(ovKey) && has(startKey)) {
        const ov = w.ref(ovKey, 2), sy = `MAX(${w.ref('project:axisYear')},YEAR(${TL(p, 'cs')}))`;
        w.fA(at(startKey, TOTAL_COL), `IF(ISNUMBER(${ov}),MAX(${sy},${ov}),${TL(p, 'hy')}+1)`);
      }
      const ioK = R('In operations (1 = yes)');
      row(ioK, (t) => { const s = A(startKey, TOTAL_COL); return `(${yr(t)}>=${s})*(${yr(t)}<=MAX(${s},${TL(p, 'ly')}))`; });
      const IO = (t: number): string => P(ioK, t);
      const opsNo = (t: number): string => `${IO(t)}*(${yr(t)}-${A(startKey, TOTAL_COL)}+1)`;
      // Occupancy: Inputs, at the line's operating year; the Total is its average over the years in operation.
      const gOcc = gridOf(`${l.key}|occ`);
      const occR = R('Occupancy');
      row(occR, (t) => `${IO(t)}*${atYear(gOcc, opsNo(t), true)}`, () => `SUM(${span(rowOf(occR))})/MAX(1,SUM(${span(rowOf(ioK))}))`);
      claim(`rvc:${l.key}:inOps`, ioK); claim(`rvc:${l.key}:opsStart`, startKey);
      if (isOp && a.revenue?.operate) {
        const u = units[0];
        // Keys: the sub-unit's area over the unit size (the sub-unit's own size first, the type's second).
        const tk = resolveAssetTypeKey(a);
        const unitCell = u && has(`su:${u.id}:unit`) ? w.ref(`su:${u.id}:unit`) : '';
        const typeUnit = tk && has(`type:${tk}:unit`) ? w.ref(`type:${tk}:unit`) : '0';
        const size = unitCell ? `IF(N(${unitCell})>0,${unitCell},N(${typeUnit}))` : `N(${typeUnit})`;
        const keysK = D('Keys');
        if (u && has(keysK)) w.fA(at(keysK, TOTAL_COL), `IF(AND(${w.ref(`su:${u.id}:area`)}>0,${size}>0),MAX(1,ROUND(${w.ref(`su:${u.id}:area`)}/${size},0)),0)`);
        const keys = (): string => A(keysK, TOTAL_COL);
        const adrR = byPrefix(R('ADR ('));
        if (adrR && u) row(adrR, (t) => `${IO(t)}*${w.ref(`su:${u.id}:rate`)}*${factorF(l, idx, t)}`, 'none');
        const arnR = R('Available room nights'), ornR = R('Occupied room nights');
        row(arnR, (t) => `${IO(t)}*${keys()}*${IN(`rxin|${l.key}|days`)}`);
        row(ornR, (t) => `${P(arnR, t)}*${P(occR, t)}`);
        row(R('Guests'), (t) => `${P(ornR, t)}*${IN(`rxin|${l.key}|guests`)}`);
        const roomsR = R('Rooms revenue'), fbRev = R('F&B revenue'), otRev = R('Other revenue'), totR = R('Hotel revenue');
        if (adrR) row(roomsR, (t) => `${P(ornR, t)}*${P(adrR, t)}`);
        row(fbRev, (t) => `${P(roomsR, t)}*${IN(`rxin|${l.key}|fb`)}`);
        row(otRev, (t) => `${P(roomsR, t)}*${IN(`rxin|${l.key}|other`)}`);
        row(totR, (t) => sumRows([rowOf(roomsR), rowOf(fbRev), rowOf(otRev)], t));
        lineTotals.set(l.key, { value: (t) => P(totR, t), rec: (t) => P(totR, t), cash: (t) => P(totR, t) });
        claim(`rvc:${l.key}:total`, totR); claim(`rvc:${l.key}:rooms`, roomsR); claim(`rvc:${l.key}:fb`, fbRev); claim(`rvc:${l.key}:other`, otRev);
        claim(`rvc:${l.key}:arn`, arnR); claim(`rvc:${l.key}:orn`, ornR); claim(`rvc:${l.key}:keys`, keysK);
        continue;
      }
      if (!isOp && a.revenue?.lease) {
        const glaK = D('Lettable area (sqm)');
        if (has(glaK)) w.fA(at(glaK, TOTAL_COL), units.map((u) => w.ref(`su:${u.id}:area`)).join('+') || '0');
        const occRows: number[] = [], revRowsL: number[] = [];
        for (const u of units) {
          const rk = R(`${nm(u)}: rent per sqm`), ok = R(`${nm(u)}: area let (sqm)`), vk = R(`${nm(u)}: rent`);
          row(rk, (t) => `${IO(t)}*${w.ref(`su:${u.id}:rate`)}*${factorF(l, idx, t)}`, 'none');
          row(ok, (t) => `${w.ref(`su:${u.id}:area`)}*${P(occR, t)}`);
          row(vk, (t) => `${P(ok, t)}*${P(rk, t)}`);
          if (has(ok)) occRows.push(rowOf(ok));
          if (has(vk)) revRowsL.push(rowOf(vk));
        }
        // One sub-unit: its rows are the line's. Several: a total of each.
        const occTot = units.length === 1 ? R(`${nm(units[0])}: area let (sqm)`) : R('Area let (sqm)');
        const revTot = units.length === 1 ? R(`${nm(units[0])}: rent`) : R('Lease revenue');
        if (units.length !== 1) { row(occTot, (t) => sumRows(occRows, t)); row(revTot, (t) => sumRows(revRowsL, t)); }
        lineTotals.set(l.key, { value: (t) => P(revTot, t), rec: (t) => P(revTot, t), cash: (t) => P(revTot, t) });
        claim(`rvc:${l.key}:rev`, revTot); claim(`rvc:${l.key}:occupied`, occTot); claim(`rvc:${l.key}:gla`, glaK);
      }
    }

    // ── The summary: sales value, revenue recognised, cash collected, one row per line ──
    const views: Array<['sv' | 'rec' | 'cash', 'value' | 'rec' | 'cash', string]> = [['sv', 'value', 'Total sales value'], ['rec', 'rec', 'Total revenue recognised'], ['cash', 'cash', 'Total cash collected']];
    for (const [id, k, totalLabel] of views) {
      const lineRows: number[] = [];
      for (const g of groupRevenueLines(lines)) for (const l of g.lines) {
        const f = lineTotals.get(l.key);
        const key = O(l, `sum-${id}`, revenueLineName(l));
        if (!f || !has(key)) continue;
        row(key, f[k]);
        lineRows.push(rowOf(key));
        const a = earning(l)[0];
        if (id === 'sv') { claim(`rvc:${l.key}:salesValue`, key); if (l.form === 'sell' && a) claim(`rvc:${a.id}:saleRev`, key); }
        if (id === 'rec') claim(`rvc:${l.key}:recognised`, key);
        if (id === 'cash') { claim(`rvc:${l.key}:collected`, key); if (l.form === 'sell' && a) claim(`rvc:${a.id}:cash`, key); }
      }
      const tk = `rev|__project__|sum-${id}|${totalLabel}`;
      row(tk, (t) => sumRows(lineRows, t));
      if (id === 'sv') claim('rvc:__project__:salesValue', tk);
    }

    for (const c of checks) c();

    return [
      { sheet: REV, status: 'partial' as const, formulas: w.formulas.get(REV) ?? 0,
        note: 'Live on this sheet: every line, each figure built from rows on the tabs and the inputs on Inputs: the velocity and the sqm sold per sub-unit, revenue split at handover, recognition, collections by pre-sales year, the receivable and unearned balances, the hotel and lease statements with their years in operation, and the summary of sales value, revenue recognised and cash collected.' },
    ];

  },
};
