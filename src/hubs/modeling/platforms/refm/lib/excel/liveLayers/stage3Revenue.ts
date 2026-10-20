/**
 * stage3Revenue.ts (2026-09-27, rebuilt 2026-10-15), FORMULA-LINKED EXPORT: REVENUE.
 *
 * EVERY FIGURE ON THE REVENUE TAB IS BUILT FROM ROWS ON THE TABS (founder,
 * 2026-10-14). There is no working sheet. The engine's rules, row by row:
 *
 *   SELL, per sub-unit. "Velocity in force" is the velocity typed on Inputs at
 *     the years it applies to now (a phase that moves since export reads its
 *     typed years shifted by the years it moved, Timeline). The engine sells the
 *     pre-sales years first, then the operation years, which is the order of the
 *     years, so one "sqm sold" row carries both passes: each year sells the
 *     velocity share of the inventory rounded to whole sqm, capped at what is
 *     still unsold, and the year the typed velocity reaches 100% (or the share
 *     reaches what is left) takes the exact remainder (sell.ts). A sale up to
 *     the handover year is a pre-sale, after it a sale during operation.
 *     Revenue = sqm sold x the base price x the indexation factor. Recognition
 *     at handover. Collections: each sale year's cohort pays its downpayment in
 *     the year it sells and the balance in equal instalments over the instalment
 *     years (the lesser of the maximum and the years left to handover); a sale
 *     at or after handover, or with no instalment years, pays in full. The
 *     receivable and unearned roll forward from those rows.
 *   HOTEL. In operation from the operations start year on Revenue to the last
 *     operating year; keys x days, x occupancy; ADR = the base rate x the
 *     indexation factor; F&B and other as shares of rooms revenue.
 *   LEASE. Gross lease area x occupancy, x the base rent x the factor.
 *
 * The keys of the old working sheet (rvc:) are claimed at the visible rows that
 * now hold those figures, so every later tab reads them where they are.
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
import { ARGB, NUMFMT, setLabel, fillRange, colLetter } from '../styles';
import { withResolvedAssetNames } from '@/src/core/calculations/assetName';
import { resolveAssetTypeKey } from '../../state/assetTypeStandards';
import { resolveSubUnitMetric, isRevenueSubUnit } from '@/src/core/calculations';
import { computeFinancialsSnapshot } from '../../financials-resolvers';
import { planRevenueLines, groupRevenueLines, type RevenueLine } from '../../revenueLines';
import { revenueLineName } from '../../reports/revenueOutputReports';
import { resolveRowVelocity } from '../../revenue-resolvers';
import { hasAnyDownpayment } from '@/src/core/calculations/revenue/cohortTerms';
import type { Asset, Phase, SubUnit } from '../../state/module1-types';

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
    const has = (k: string): boolean => w.has(k);
    const phases = state.phases as Phase[];
    const subUnits = state.subUnits as SubUnit[];
    const lines = planRevenueLines(state.assets, state.subUnits, state.phases, state.project);
    const revRows = (a: Asset): SubUnit[] => subUnits.filter((u) => u.assetId === a.id && isRevenueSubUnit(u));
    const K = (line: RevenueLine, table: string, label: string): string => `revin|${line.key}|${table}|${label}`;
    const O = (line: RevenueLine, table: string, label: string): string => `rev|${line.key}|${table}|${label}`;
    const byPrefix = (prefix: string): string | undefined => reg.keys().find((k) => k.startsWith(prefix));

    // ── Refusals ─────────────────────────────────────────────────────────────
    const refuse: string[] = [];
    const phaseOf = (l: RevenueLine): Phase | undefined => phases.find((p) => p.id === l.phaseId);
    const earning = (l: RevenueLine): Asset[] => l.members.filter((m) => revRows(m).length > 0);
    const offsetAt = (p: Phase): number => new Date(p.startDate as string).getUTCFullYear() - snap.revenue.projectStartYear;
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
    const idxOf = (l: RevenueLine, a: Asset): Idx => (l.form === 'sell' ? a.revenue?.sell?.indexation : l.form === 'operate' ? a.revenue?.operate?.adrIndexation : a.revenue?.lease?.rentIndexation) as Idx;
    for (const l of lines) {
      const p = phaseOf(l);
      if (!p) continue;
      const name = revenueLineName(l);
      const earners = earning(l);
      if (earners.length > 1) refuse.push(`${name}: revenue sits on more than one plot`);
      const a = earners[0] ?? l.host;
      if (earners.length && (p.constructionPeriods ?? 0) < 1) refuse.push(`${name}: its phase has no construction years`);
      if (!has(`tl:phase:${p.id}:hy`) || !has(`tl:phase:${p.id}:mv`) || !has('tl:horizon')) refuse.push(`${name}: the Timeline's phase years are not live`);
      const ix = idxOf(l, a);
      if (!IDX_METHODS.has(ix?.method ?? 'none')) refuse.push(`${name}: indexation ${ix?.method}`);
      if ((ix?.method ?? 'none') !== 'none' && earners.length && (!has(`rxin|${l.key}|rate`) || !has(`rxin|${l.key}|from`))) refuse.push(`${name}: its indexation has no rate on Inputs`);
      const off = offsetAt(p);
      if (l.form !== 'sell' && statedLineReceivableDays(a) !== statedLineReceivableDays(l.host)) refuse.push(`${name}: the earning plot and the line card state different receivable days`);
      if (l.form !== 'sell' && statedLineReceivableDays(a) !== undefined && !reg.keys().some((k) => k.startsWith(`revin|${l.key}|`) && k.endsWith('|Accounts Receivable Days'))) refuse.push(`${name}: its own receivable days are not on the sheet`);
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
        for (let k = 0; k < Math.max(0, p.constructionPeriods ?? 0); k++) {
          const v = sell.downpaymentByPhase?.[k];
          if (!(typeof v === 'number' && Number.isFinite(v))) refuse.push(`${name}: a sale year's downpayment is carried, not typed`);
        }
        for (const u of revRows(a)) {
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} is sold by units`);
          const v = resolveRowVelocity(sell, u.id);
          if (v.pre === undefined && (v.preLegacy ?? []).some((x) => x)) refuse.push(`${name}: velocity held on the legacy axis`);
          if (v.post === undefined && (v.postLegacy ?? []).some((x) => x)) refuse.push(`${name}: velocity held on the legacy axis`);
          // One chronological row carries both passes only while every pre-sales year comes first.
          const pre = (v.pre ?? []).map((x, i) => ((x ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
          const post = (v.post ?? []).map((x, i) => ((x ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
          if (pre.some((i) => post.includes(i))) refuse.push(`${name}: ${u.name} has a pre-sales and an operation velocity in the same year`);
          else if (pre.length && post.length && Math.min(...post) < Math.max(...pre)) refuse.push(`${name}: ${u.name} sells during operation before its last pre-sales year`);
          shownOrZero(`${name} pre-sales velocity`, v.pre, off, K(l, 'Pre-Sales velocity', u.name || 'sub-unit'));
          shownOrZero(`${name} sales during operation`, v.post, off, K(l, 'Sales During Operation', u.name || 'sub-unit'));
          if (!has(`su:${u.id}:area`) || !has(`su:${u.id}:rate`)) refuse.push(`${name}: ${u.name}'s area or price is not on Inputs`);
        }
        shownOrZero(`${name} downpayment`, sell.downpaymentByPhase as number[] | undefined, off, K(l, 'Sale cohort terms', 'Downpayment %'));
      } else if (l.form === 'operate') {
        const op = a.revenue?.operate;
        if (!op) continue;
        if ((op.fb?.mode ?? 'percent_of_rooms') !== 'percent_of_rooms' || Array.isArray(op.fb?.percentOfRooms) || op.fb?.percentOfRoomsByPhase !== undefined) refuse.push(`${name}: F&B is not a flat share of rooms`);
        if ((op.otherRevenue?.mode ?? 'percent_of_rooms') !== 'percent_of_rooms' || Array.isArray(op.otherRevenue?.percentOfRooms) || op.otherRevenue?.percentOfRoomsByPhase !== undefined) refuse.push(`${name}: other revenue is not a flat share of rooms`);
        if (op.keysParticipationProfile !== undefined || op.keysParticipationProfileByPhase !== undefined) refuse.push(`${name}: a rental pool`);
        if (op.occupancyShiftPts) refuse.push(`${name}: an occupancy lever`);
        if (revRows(a).length > 1) refuse.push(`${name}: more than one room type`);
        if (!has(`rxin|${l.key}|days`)) refuse.push(`${name}: its days per year are not on Inputs`);
        for (const u of revRows(a)) {
          if ((u.startingAdr ?? 0) > 0) refuse.push(`${name}: ${u.name} stores an ADR of its own`);
          if (u.hospitalityIndexation) refuse.push(`${name}: ${u.name} has its own ADR indexation`);
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} counts keys`);
          if (!has(`su:${u.id}:area`)) refuse.push(`${name}: ${u.name}'s area is not on Inputs`);
        }
        shownOrZero(`${name} occupancy`, op.occupancyPerPeriodByPhase, off, K(l, 'ADR Indexation', 'Occupancy ramp'));
        if (op.occupancyPerPeriodByPhase === undefined) refuse.push(`${name}: occupancy held on the legacy axis`);
      } else {
        const le = a.revenue?.lease;
        if (!le) continue;
        if (le.occupancyShiftPts) refuse.push(`${name}: an occupancy lever`);
        for (const u of revRows(a)) {
          if (!((u.unitPrice ?? 0) > 0) && (le.baseRate ?? 0) > 0) refuse.push(`${name}: ${u.name} takes the line's base rent`);
          if (resolveSubUnitMetric(u, a) === 'units') refuse.push(`${name}: ${u.name} is let by units`);
          if (!has(`su:${u.id}:area`)) refuse.push(`${name}: ${u.name}'s area is not on Inputs`);
        }
        shownOrZero(`${name} occupancy`, le.occupancyPerPeriodByPhase, off, K(l, 'Rent Indexation', 'Occupancy ramp'));
        if (le.occupancyPerPeriodByPhase === undefined) refuse.push(`${name}: occupancy held on the legacy axis`);
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
    /** A fixed cell of a registered row. */
    const A = (key: string, col: number): string => w.refA(at(key, col), REV);
    /** A fixed cell, any column of a row on this tab. */
    const AR = (row: number, col: number): string => w.refA({ sheet: REV, row, col }, REV);
    const yr = (t: number): string => w.refP({ sheet: REV, row: 3, col: pc(t) }, REV);
    const ix = (t: number): string => w.refP({ sheet: REV, row: 4, col: pc(t) }, REV);
    const rowOf = (key: string): number => w.addr(key).row;
    const span = (row: number): string => { for (let t = 0; t < N; t++) w.refP({ sheet: REV, row, col: pc(t) }, REV); return `$${colLetter(pc(0))}$${row}:$${colLetter(pc(N - 1))}$${row}`; };
    const row = (key: string, f: (t: number) => string, total: 'sum' | 'last' | 'none' | (() => string) = 'sum'): void => {
      if (!has(key)) return;
      const r = rowOf(key);
      for (let t = 0; t < N; t++) w.fA({ sheet: REV, row: r, col: pc(t) }, f(t));
      const T = { sheet: REV, row: r, col: TOTAL_COL };
      if (total === 'sum') w.fA(T, `SUM(${span(r)})`);
      else if (total === 'last') w.fA(T, AR(r, pc(N - 1)));
      else if (typeof total === 'function') w.fA(T, total());
    };
    /** A card cell is shown only in its window: link it where the platform shows it. */
    const linkShown = (cardKey: string, src: (t: number) => string): void => {
      if (!has(cardKey)) return;
      for (let t = 0; t < N; t++) { const c = at(cardKey, pc(t)); if (w.platformValue(c) !== undefined) w.fA(c, src(t)); }
    };
    const lastPos = (r: number): string => `IFERROR(LOOKUP(2,1/(${span(r)}>0),${span(r)}),0)`;
    const avgPos = (r: number): string => `IFERROR(AVERAGEIF(${span(r)},">0"),0)`;
    const worst = (r: number): string => { const s = span(r); return `IF(MAX(${s})<0.005,IF(-MIN(${s})<0.005,0,MIN(${s})),IF(MAX(${s})>=-MIN(${s}),MAX(${s}),MIN(${s})))`; };
    const fmtRate = (x: string): string => `IF(${x}=INT(${x}),TEXT(${x},"#,##0"),TEXT(${x},"#,##0.##"))`;
    const cur = state.project.currency ?? 'SAR';
    const TL = (p: Phase, k: string): string => w.ref(`tl:phase:${p.id}:${k}`);
    const HZ = (): string => w.ref('tl:horizon', TOTAL_COL);
    /** A typed card year read at the year it applies to now: the card's column less the years the phase moved. */
    const shifted = (cardRow: number, p: Phase, t: number, clamp01 = false): string => {
      const k = `${ix(t)}-${TL(p, 'mv')}`;
      const v = `INDEX(${span(cardRow)},${k})`;
      return `IF(AND(${k}>=1,${k}<=${HZ()}),${clamp01 ? `MIN(1,MAX(0,${v}))` : v},0)`;
    };
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

    // ── Each line ────────────────────────────────────────────────────────────
    for (const l of lines) {
      const p = phaseOf(l);
      const a = earning(l)[0];
      if (!p) continue;
      // Input card: the Table 5 price, read from Inputs.
      for (const u of l.subUnits) {
        const key = K(l, '', u.name || 'sub-unit');
        if (has(key) && has(`su:${u.id}:rate`) && typeof w.platformValue(at(key, TOTAL_COL)) === 'number') w.f(key, `N(${w.ref(`su:${u.id}:rate`)})`, { col: TOTAL_COL });
      }
      if (!a) continue;
      const units = revRows(a);
      const before = (t: number): string => `(${yr(t)}<=${TL(p, 'hy')})`;

      if (l.form === 'sell' && a.revenue?.sell) {
        const idx = a.revenue.sell.indexation as Idx;
        const nm = (u: SubUnit): string => u.name || 'sub-unit';
        const area = (u: SubUnit): string => w.ref(`su:${u.id}:area`);
        // 0. Velocity in force, each year: the pre-sales and the operation velocity shifted with the phase.
        for (const u of units) {
          const pre = K(l, 'Pre-Sales velocity', nm(u)), post = K(l, 'Sales During Operation', nm(u));
          row(O(l, '0.', nm(u)), (t) => [pre, post].filter(has).map((k) => shifted(rowOf(k), p, t)).join('+') || '0');
        }
        // 1b. Sold per sub-unit: the share of the inventory, capped at what is unsold; the exact remainder once the typed velocity reaches 100%.
        for (const u of units) {
          const vk = O(l, '0.', nm(u)), sk = O(l, '1b.', nm(u));
          if (!has(vk) || !has(sk)) continue;
          const vr = rowOf(vk), sr = rowOf(sk);
          const prevSold = (t: number): string => { w.refP({ sheet: REV, row: sr, col: pc(t) - 1 }, REV); return `SUM($${colLetter(OPEN_COL)}$${sr}:${colLetter(pc(t) - 1)}$${sr})`; };
          const typed = (t: number): string => { w.refP({ sheet: REV, row: vr, col: pc(t) }, REV); return `SUM($${colLetter(pc(0))}$${vr}:${colLetter(pc(t))}$${vr})`; };
          row(sk, (t) => {
            const v = P(vk, t), A_ = area(u), unsold = `(${A_}-${prevSold(t)})`;
            return `IF(${v}=0,0,IF(OR(${typed(t)}>=1-1E-9,${v}*${A_}>=${unsold}-1E-9*${A_}),${unsold},ROUND(${A_}*${v},0)))`;
          });
          row(O(l, '1a.', nm(u)), (t) => `IF(${area(u)}>0,${P(sk, t)}/${area(u)},0)`, () => `IF(${area(u)}>0,SUM(${span(sr)})/${area(u)},0)`);
        }
        const suSold = units.map((u) => O(l, '1b.', nm(u))).filter(has).map(rowOf);
        const preSqm = O(l, '1b.', 'Total pre-sales sqm'), postSqm = O(l, '1b.', 'Total sales during operation sqm'), allSqm = O(l, '1b.', 'Asset Total SQM Sold');
        row(preSqm, (t) => `${before(t)}*${sumRows(suSold, t)}`);
        row(postSqm, (t) => `(1-${before(t)})*${sumRows(suSold, t)}`);
        row(allSqm, (t) => `${P(preSqm, t)}+${P(postSqm, t)}`);
        const inv = (): string => units.map(area).join('+') || '0';
        row(O(l, '1a.', 'Asset Total'), (t) => `IF((${inv()})>0,${P(allSqm, t)}/(${inv()}),0)`, () => `IF((${inv()})>0,SUM(${span(rowOf(allSqm))})/(${inv()}),0)`);
        // 1c. Closing inventory.
        const openU = O(l, '1c.', 'Opening unsold'), soldU = O(l, '1c.', 'Sold in year'), closeU = O(l, '1c.', 'Closing unsold');
        row(openU, (t) => `IF(${ix(t)}=1,${inv()},${w.refP({ sheet: REV, row: rowOf(closeU), col: pc(t) - 1 }, REV)})`, 'none');
        row(soldU, (t) => `-${P(allSqm, t)}`);
        row(closeU, (t) => `${P(openU, t)}+${P(soldU, t)}`, 'last');
        const chk1c = O(l, '1c.', 'Check (must be zero)');
        row(chk1c, (t) => `${P(openU, t)}+${P(soldU, t)}-${P(closeU, t)}`, () => worst(rowOf(chk1c)));
        // 2a. The factor and each sub-unit's price per year; the input card links them where it shows them.
        const fk = O(l, '2a.', 'Indexation factor (every sub-unit of this line)');
        row(fk, (t) => factorF(l, idx, t), 'none');
        linkShown(K(l, 'Sale price per year', 'Indexation factor'), (t) => P(fk, t));
        const priceKey = new Map<string, string>();
        for (const u of units) {
          const pk = byPrefix(`${O(l, '2a.', nm(u))} (`);
          if (!pk) continue;
          const base = (): string => w.ref(`su:${u.id}:rate`);
          row(pk, (t) => `IF(${base()}>0,${base()}*${P(fk, t)},0)`, 'none');
          w.fA(at(pk, 1), `"${nm(u).replace(/"/g, '""')} (${cur} "&${fmtRate(base())}&" / sqm)"`);
          priceKey.set(u.id, pk);
          const ck = byPrefix(`${K(l, 'Sale price per year', nm(u))} (`);
          if (ck) { linkShown(ck, (t) => P(pk, t)); w.fA(at(ck, 1), `"${nm(u).replace(/"/g, '""')} (${cur} "&${fmtRate(base())}&" / sqm)"`); }
        }
        // 2b. Revenue: sqm sold x the price per year, split at handover.
        const suRev: number[] = [];
        for (const u of units) {
          const rk = O(l, '2b.', nm(u)), pk = priceKey.get(u.id);
          if (!has(rk) || !pk) continue;
          row(rk, (t) => `${P(O(l, '1b.', nm(u)), t)}*${P(pk, t)}`);
          suRev.push(rowOf(rk));
        }
        const preRev = O(l, '2b.', 'Total pre-sales revenue'), postRev = O(l, '2b.', 'Total sales during operation revenue'), allRev = O(l, '2b.', 'Asset Total Revenue');
        row(preRev, (t) => `${before(t)}*${sumRows(suRev, t)}`);
        row(postRev, (t) => `(1-${before(t)})*${sumRows(suRev, t)}`);
        row(allRev, (t) => `${P(preRev, t)}+${P(postRev, t)}`);
        // 3a / 3b. Each sale year's pre-sales recognised in the handover year.
        const recRows: number[] = [];
        for (let s = 0; s < N; s++) {
          const k = O(l, '3a.', `Sold in ${snap.yearLabels[s]}`);
          if (!has(k)) continue;
          row(k, (t) => `${AR(rowOf(preRev), pc(s))}*(${yr(t)}=${TL(p, 'hy')})`);
          recRows.push(rowOf(k));
        }
        const recTot = O(l, '3a.', 'Year Total');
        row(recTot, (t) => sumRows(recRows, t));
        const recPre = O(l, '3b.', 'Pre-Sales Recognised'), recPost = O(l, '3b.', 'Sales During Operation Recognised');
        row(recPre, (t) => P(recTot, t));
        row(recPost, (t) => P(postRev, t));
        row(O(l, '3b.', 'Total Revenue Recognised'), (t) => `${P(recPre, t)}+${P(recPost, t)}`);
        // 4a. The cohorts: the sale-year table holds each year's down %, instalment years and sale value.
        const dpRow = has(K(l, 'Sale cohort terms', 'Downpayment %')) ? rowOf(K(l, 'Sale cohort terms', 'Downpayment %')) : undefined;
        const maxInst = (): string => w.ref(K(l, 'Sale cohort terms', 'Max instalment years after sale'), TOTAL_COL);
        const cohortRows: number[] = [];
        for (let s = 0; s < N; s++) {
          const y = snap.yearLabels[s];
          const gk = byPrefix(O(l, '4a.', `${y} sale,`)), ck = O(l, '4achk', String(y));
          if (!gk || !has(ck)) continue;
          const cr = rowOf(ck), sy = AR(3, pc(s)), sx = AR(4, pc(s));
          const B = AR(cr, 2), D = AR(cr, 4), Nn = AR(cr, 7);
          w.fA({ sheet: REV, row: cr, col: 7 }, `IF(${sy}>=${TL(p, 'hy')},0,MIN(INT(${maxInst()}),${TL(p, 'hy')}-${sy}))`);
          const k = `${sx}-${TL(p, 'mv')}`;
          const dp = dpRow !== undefined ? `IF(AND(${k}>=1,${k}<=${HZ()}),MIN(1,MAX(0,INDEX(${span(dpRow)},${k}))),0)` : '0';
          w.fA({ sheet: REV, row: cr, col: 2 }, `IF(${sy}>=${TL(p, 'hy')},1,${dp})`);
          w.fA({ sheet: REV, row: cr, col: 4 }, AR(rowOf(allRev), pc(s)));
          const pre = AR(rowOf(preRev), pc(s)), post = AR(rowOf(postRev), pc(s));
          row(gk, (t) => `IF(${yr(t)}=${sy},IF(${Nn}=0,1,${B})*${pre}+${post},IF(AND(${yr(t)}>${sy},${yr(t)}<=${sy}+${Nn}),(1-${B})*${pre}/${Nn},0))`);
          w.fA(at(gk, 1), `"${y} sale, "&IF(${B}=1,"paid in full",TEXT(${B}*100,"0.00")&"% down")`);
          w.fA({ sheet: REV, row: cr, col: 5 }, `SUM(${span(rowOf(gk))})`);
          w.fA({ sheet: REV, row: cr, col: 6 }, `${AR(cr, 5)}-${D}`);
          cohortRows.push(rowOf(gk));
        }
        const collected = O(l, '4a.', 'Total collected');
        row(collected, (t) => sumRows(cohortRows, t));
        // 4b. Cash: sales during operation are paid in full in their year; the rest collected is pre-sales cash.
        const sdoCash = O(l, '4b.', 'Sales During Operation Cash'), preCash = O(l, '4b.', 'Pre-Sales Cash'), allCash = O(l, '4b.', 'Total Cash Collected');
        row(sdoCash, (t) => P(postRev, t));
        row(preCash, (t) => `${P(collected, t)}-${P(sdoCash, t)}`);
        row(allCash, (t) => `${P(preCash, t)}+${P(sdoCash, t)}`);
        // 5 / 6. The receivable and the unearned revenue roll forward.
        const roll = (tbl: string, open: string, add: string, less: string, change: string, close: string, lessFrom: string): void => {
          const C = O(l, tbl, close), Op = O(l, tbl, open), Ad = O(l, tbl, add), Ls = O(l, tbl, less), Ck = O(l, tbl, 'Check (must be zero)');
          row(Op, (t) => w.refP({ sheet: REV, row: rowOf(C), col: pc(t) - 1 }, REV), 'none');
          row(Ad, (t) => P(preRev, t));
          row(Ls, (t) => `-${P(lessFrom, t)}`);
          row(C, (t) => `${P(Op, t)}+${P(Ad, t)}+${P(Ls, t)}`, 'last');
          row(O(l, tbl, change), (t) => `${P(C, t)}-${P(Op, t)}`);
          row(Ck, (t) => `${P(Op, t)}+${P(Ad, t)}+${P(Ls, t)}-${P(C, t)}`, () => worst(rowOf(Ck)));
        };
        roll('5.', 'Opening receivable', 'Add: sales contracted', 'Less: cash collected', 'Change in receivable (cash flow delta)', 'Closing receivable', preCash);
        roll('6.', 'Opening unearned', 'Add: sales contracted', 'Less: revenue recognised', 'Change in unearned (cash flow delta)', 'Closing unearned', recPre);
        // What later tabs read, at the rows that now hold it.
        claim(`rvc:${l.key}:preRev`, preRev); claim(`rvc:${l.key}:postRev`, postRev);
        claim(`rvc:${l.key}:preArea`, preSqm); claim(`rvc:${l.key}:postArea`, postSqm);
        claim(`rvc:${l.key}:cashPre`, preCash); claim(`rvc:${l.key}:recPre`, recPre);
        claim(`rvc:${l.key}:ar`, O(l, '5.', 'Closing receivable')); claim(`rvc:${l.key}:ur`, O(l, '6.', 'Closing unearned'));
        claim(`rvc:${l.key}:factor`, fk);
        claim(`rvc:${a.id}:saleRev`, allRev); claim(`rvc:${a.id}:cash`, allCash);
        for (const u of units) { claim(`rvc:${l.key}:${u.id}:pre:area`, O(l, '1b.', nm(u))); claim(`rvc:${l.key}:${u.id}:pre:rev`, O(l, '2b.', nm(u))); }
        continue;
      }

      // HOTEL and LEASE: the years in operation, from the operations start on the card to the last operating year.
      const isOp = l.form === 'operate';
      const startKey = K(l, isOp ? 'ADR Indexation' : 'Rent Indexation', 'Operations start year');
      // THE CARD SHOWS THE YEAR IN FORCE, from the override on Inputs: the override, never
      // before construction starts, else the year after handover.
      const ovKey = `oxin|opsStart|${l.key}`;
      if (has(ovKey) && has(startKey)) {
        const ov = w.ref(ovKey, 2), sy = `MAX(${w.ref('project:axisYear')},YEAR(${w.ref(`phase:${p.id}:start`)}))`;
        w.fA(at(startKey, TOTAL_COL), `IF(ISNUMBER(${ov}),MAX(${sy},${ov}),${sy}+MAX(1,${w.ref(`phase:${p.id}:cp`)}))`);
      }
      const ioK = O(l, '1.', 'In operations (1 = yes)');
      row(ioK, (t) => { const s = A(startKey, TOTAL_COL); return `(${yr(t)}>=${s})*(${yr(t)}<=MAX(${s},${TL(p, 'ly')}))`; });
      const IO = (t: number): string => P(ioK, t);
      const idx = idxOf(l, a);
      const occCard = rowOf(K(l, isOp ? 'ADR Indexation' : 'Rent Indexation', 'Occupancy ramp'));
      if (isOp && a.revenue?.operate) {
        const u = units[0];
        // The card's keys: the sub-unit's area over the unit size (the sub-unit's own size first, the type's second).
        const tk = resolveAssetTypeKey(a);
        const unitCell = u && has(`su:${u.id}:unit`) ? w.ref(`su:${u.id}:unit`) : '';
        const typeUnit = tk && has(`type:${tk}:unit`) ? w.ref(`type:${tk}:unit`) : '0';
        const size = unitCell ? `IF(N(${unitCell})>0,${unitCell},N(${typeUnit}))` : `N(${typeUnit})`;
        const keysK = K(l, '', 'Keys the engine counts');
        if (u && has(keysK)) w.f(keysK, `IF(AND(${w.ref(`su:${u.id}:area`)}>0,${size}>0),MAX(1,ROUND(${w.ref(`su:${u.id}:area`)}/${size},0)),0)`, { col: TOTAL_COL });
        const keys = (): string => A(keysK, TOTAL_COL);
        const days = (): string => w.ref(`rxin|${l.key}|days`, 2);
        const card = (label: string): string => A(K(l, 'ADR Indexation', label), TOTAL_COL);
        const keyR = O(l, '1.', 'Total Rooms (Keys)'), daysR = O(l, '1.', 'Days per Year'), occR = O(l, '1.', 'Occupancy %');
        const facR = O(l, '1.', 'ADR Indexation Factor'), adrR = O(l, '1.', `ADR (${cur} per occupied room night)`);
        const fbR = O(l, '1.', 'F&B % of Rooms Revenue'), otR = O(l, '1.', 'Other % of Rooms Revenue');
        const arnR = O(l, '1.', 'Available Room Nights'), ornR = O(l, '1.', 'Occupied Room Nights');
        row(keyR, (t) => `${IO(t)}*${keys()}`, () => keys());
        row(daysR, (t) => `${IO(t)}*${days()}`, () => days());
        row(occR, (t) => `${IO(t)}*${shifted(occCard, p, t, true)}`, () => avgPos(rowOf(occR)));
        row(facR, (t) => `${IO(t)}*${factorF(l, idx, t)}`, () => lastPos(rowOf(facR)));
        const base = u ? A(K(l, '', u.name || 'sub-unit'), TOTAL_COL) : '0';
        row(adrR, (t) => `${P(facR, t)}*${base}`, () => lastPos(rowOf(adrR)));
        row(fbR, (t) => `${IO(t)}*${card('F&B Revenue, F&B %')}`, () => card('F&B Revenue, F&B %'));
        row(otR, (t) => `${IO(t)}*${card('Other Revenue, Other %')}`, () => card('Other Revenue, Other %'));
        row(arnR, (t) => `${P(keyR, t)}*${P(daysR, t)}`);
        row(ornR, (t) => `${P(arnR, t)}*${P(occR, t)}`);
        const gk = byPrefix(O(l, '1.', 'Guests per Year (x '));
        if (gk) {
          row(gk, (t) => `${P(ornR, t)}*${card('Average guests per occupied room night')}`);
          w.fA(at(gk, 1), `"Guests per Year (x "&TEXT(${card('Average guests per occupied room night')},"0.00")&" guests / ORN)"`);
        }
        const roomsR = O(l, '2.', 'Rooms Revenue'), fbRev = O(l, '2.', 'F&B Revenue'), otRev = O(l, '2.', 'Other Revenue'), totR = O(l, '2.', 'Total Hospitality Revenue');
        row(roomsR, (t) => `${P(ornR, t)}*${P(adrR, t)}`);
        row(fbRev, (t) => `${P(roomsR, t)}*${P(fbR, t)}`);
        row(otRev, (t) => `${P(roomsR, t)}*${P(otR, t)}`);
        row(totR, (t) => sumRows([rowOf(roomsR), rowOf(fbRev), rowOf(otRev)], t));
        // The card's occupancy Total: its average over the years in operation.
        w.fA(at(K(l, 'ADR Indexation', 'Occupancy ramp'), TOTAL_COL), `SUM(${span(rowOf(occR))})/MAX(1,SUM(${span(rowOf(ioK))}))`);
        claim(`rvc:${l.key}:total`, totR); claim(`rvc:${l.key}:rooms`, roomsR); claim(`rvc:${l.key}:fb`, fbRev); claim(`rvc:${l.key}:other`, otRev);
        claim(`rvc:${l.key}:arn`, arnR); claim(`rvc:${l.key}:orn`, ornR); claim(`rvc:${l.key}:inOps`, ioK); claim(`rvc:${l.key}:wfactor`, facR);
        claim(`rvc:${l.key}:keys`, keysK);
        continue;
      }
      if (!isOp && a.revenue?.lease) {
        const glaSum = (): string => units.map((u) => w.ref(`su:${u.id}:area`)).join('+') || '0';
        const glaR = O(l, '1.', 'Total Gross Lease Area (sqm)'), occR = O(l, '1.', 'Occupancy %'), facR = O(l, '1.', 'Rent Indexation Factor');
        const occTot = O(l, '1.', 'Total Occupied Lease Area (sqm)'), revTot = O(l, '2.', 'Total Lease Revenue');
        row(occR, (t) => `${IO(t)}*${shifted(occCard, p, t, true)}`, () => avgPos(rowOf(occR)));
        row(facR, (t) => `${IO(t)}*${factorF(l, idx, t)}`, () => lastPos(rowOf(facR)));
        const occRows: number[] = [], revRowsL: number[] = [];
        for (const u of l.subUnits) {
          if (!units.some((x) => x.id === u.id)) continue;
          const nm = u.name || 'sub-unit';
          const rk = byPrefix(O(l, '1.', `${nm} Indexed Rate (`)), ok = O(l, '1.', `${nm} Occupied Area (sqm)`), vk = O(l, '2.', `${nm} Rent Revenue`);
          const baseK = K(l, '', nm);
          if (rk) {
            row(rk, (t) => `${A(baseK, TOTAL_COL)}*${P(facR, t)}`, () => lastPos(rowOf(rk)));
            w.fA(at(rk, 1), `"${nm.replace(/"/g, '""')} Indexed Rate ("&TEXT(ROUND(${w.ref(`su:${u.id}:area`)},0),"#,##0")&" sqm GLA)"`);
          }
          row(ok, (t) => `${w.ref(`su:${u.id}:area`)}*${P(occR, t)}`);
          if (has(ok)) occRows.push(rowOf(ok));
          if (rk) row(vk, (t) => `${P(ok, t)}*${P(rk, t)}`);
          if (has(vk)) revRowsL.push(rowOf(vk));
        }
        row(occTot, (t) => sumRows(occRows, t));
        row(revTot, (t) => sumRows(revRowsL, t));
        row(glaR, (t) => `IF(${P(occTot, t)}>0,${glaSum()},0)`, () => glaSum());
        const rateK = byPrefix(O(l, '1.', 'Indexed Rate ('));
        if (rateK) row(rateK, (t) => `IF(${P(occTot, t)}>0,${P(revTot, t)}/${P(occTot, t)},0)`, () => lastPos(rowOf(rateK)));
        w.fA(at(K(l, 'Rent Indexation', 'Occupancy ramp'), TOTAL_COL), `SUM(${span(rowOf(occR))})/MAX(1,SUM(${span(rowOf(ioK))}))`);
        claim(`rvc:${l.key}:rev`, revTot); claim(`rvc:${l.key}:occupied`, occTot); claim(`rvc:${l.key}:gla`, glaR);
        claim(`rvc:${l.key}:inOps`, ioK); claim(`rvc:${l.key}:wfactor`, facR);
      }
    }

    // ── THE VELOCITY CHECK (founder, 2026-09-27: match the platform, and warn) ──
    // This workbook's years are FIXED at export, so a phase moved or lengthened past
    // them leaves some typed velocity in years it does not have: it stays unsold here
    // and a visible warning says so, typed and in-model figures side by side.
    const rv = wb.getWorksheet(REV)!;
    let fr = rv.rowCount + 3;
    setLabel(rv.getCell(fr, 1), 'Velocity check: does every typed sales velocity fall inside this workbook\'s years?', { bold: true });
    fillRange(rv, fr, 1, fr, OPEN_COL + N, ARGB.subtotal);
    fr += 1;
    setLabel(rv.getCell(fr, 1), 'Line / sub-unit', { bold: true }); setLabel(rv.getCell(fr, 2), 'Result', { bold: true });
    setLabel(rv.getCell(fr, TOTAL_COL), 'Typed', { bold: true }); setLabel(rv.getCell(fr, OPEN_COL), 'Inside the model', { bold: true });
    fr += 1;
    const warnCells: string[] = [];
    for (const l of lines) {
      if (l.form !== 'sell') continue;
      for (const u of l.subUnits) {
        const nm = u.name || 'sub-unit';
        const vk = O(l, '0.', nm);
        if (!has(vk)) continue;
        setLabel(rv.getCell(fr, 1), `${revenueLineName(l)} / ${nm}`, { indent: 1 });
        const inRows = [K(l, 'Pre-Sales velocity', nm), K(l, 'Sales During Operation', nm)].filter(has).map(rowOf);
        w.fA({ sheet: REV, row: fr, col: TOTAL_COL }, inRows.length ? inRows.map((r) => `SUM(${span(r)})`).join('+') : '0', { numFmt: NUMFMT.pct2 });
        w.fA({ sheet: REV, row: fr, col: OPEN_COL }, `SUM(${span(rowOf(vk))})`, { numFmt: NUMFMT.pct2 });
        const typed = AR(fr, TOTAL_COL), inside = AR(fr, OPEN_COL);
        // One short line (2026-10-20): the share outside the years, else OK; the Guide explains it.
        w.fA({ sheet: REV, row: fr, col: 2 }, `IF(${inside}<${typed}-1E-9,"WARNING: "&TEXT(${typed}-${inside},"0.00%")&" of typed velocity is outside the model years","OK")`);
        warnCells.push(`${inside}<${typed}-1E-9`);
        rv.addConditionalFormatting({ ref: `B${fr}`, rules: [{ type: 'expression', priority: 1, formulae: [`LEFT(B${fr},7)="WARNING"`], style: { font: { bold: true, color: { argb: 'FFC00000' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE9E7' } } } }] } as unknown as Parameters<typeof rv.addConditionalFormatting>[0]);
        fr += 1;
      }
    }
    if (warnCells.length) {
      w.fA({ sheet: REV, row: 1, col: TOTAL_COL }, `IF(OR(${warnCells.join(',')}),"WARNING: typed sales velocity falls outside this workbook's years after a phase change; see the velocity check at the foot of this sheet.","")`, { cached: '' });
      rv.getCell(1, TOTAL_COL).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFC00000' } };
    }

    // ── The project totals, three views, grouped by section ──────────────────
    const lineSeries = (l: RevenueLine, view: 'revenue' | 'recognition' | 'cash', seg: 'pre' | 'post' | 'all', t: number): string => {
      const pick = (k: string): string => (has(k) ? P(k, t) : '0');
      if (l.form === 'sell') {
        const pre = view === 'revenue' ? pick(O(l, '2b.', 'Total pre-sales revenue')) : view === 'recognition' ? pick(O(l, '3b.', 'Pre-Sales Recognised')) : pick(O(l, '4b.', 'Pre-Sales Cash'));
        const post = view === 'revenue' ? pick(O(l, '2b.', 'Total sales during operation revenue')) : view === 'recognition' ? pick(O(l, '3b.', 'Sales During Operation Recognised')) : pick(O(l, '4b.', 'Sales During Operation Cash'));
        return seg === 'pre' ? pre : seg === 'post' ? post : view === 'revenue' ? pick(O(l, '2b.', 'Asset Total Revenue')) : `${pre}+${post}`;
      }
      return l.form === 'operate' ? pick(O(l, '2.', 'Total Hospitality Revenue')) : pick(O(l, '2.', 'Total Lease Revenue'));
    };
    const views: Array<['revenue' | 'recognition' | 'cash', string]> = [['revenue', 'Project Revenue (Sales Value year-on-year)'], ['recognition', 'Project Revenue Recognised'], ['cash', 'Project Cash Collected']];
    for (const [view, title] of views) {
      const PK = (label: string): string => `rev|__project__|${title}|${label}`;
      const sectionTotals: string[] = [];
      for (const g of groupRevenueLines(lines)) {
        const sells = g.lines.filter((l) => l.form === 'sell');
        const ops = g.lines.filter((l) => l.form !== 'sell');
        const parts: string[] = [];
        if (sells.length && view === 'revenue') {
          for (const l of sells) { row(PK(revenueLineName(l)), (t) => lineSeries(l, view, 'all', t)); parts.push(PK(revenueLineName(l))); }
        } else if (sells.length) {
          for (const l of sells) row(PK(revenueLineName(l)), (t) => lineSeries(l, view, 'pre', t));
          row(PK('Total Pre-Sales'), (t) => sells.map((l) => P(PK(revenueLineName(l)), t)).join('+'));
          for (const l of sells) row(PK(`${revenueLineName(l)}~1`), (t) => lineSeries(l, view, 'post', t));
          row(PK('Total Sales During Operation'), (t) => sells.map((l) => P(PK(`${revenueLineName(l)}~1`), t)).join('+'));
          parts.push(PK('Total Pre-Sales'), PK('Total Sales During Operation'));
        }
        for (const l of ops) { row(PK(revenueLineName(l)), (t) => lineSeries(l, view, 'all', t)); parts.push(PK(revenueLineName(l))); }
        row(PK(`Total ${g.section}`), (t) => parts.filter(has).map((k) => P(k, t)).join('+') || '0');
        sectionTotals.push(PK(`Total ${g.section}`));
      }
      row(PK('Total Project'), (t) => sectionTotals.filter(has).map((k) => P(k, t)).join('+') || '0');
    }

    return [
      { sheet: REV, status: 'partial' as const, formulas: w.formulas.get(REV) ?? 0,
        note: 'Live on this sheet: the input cards and the Revenue Output for every line, each figure built from rows on the tabs: the velocity in force and the sqm sold per sub-unit, inventory, price per year, revenue split at handover, recognition, the sale cohort grid with each sale year\'s down %, instalment years and check, cash, the receivable and unearned roll-forwards, the hotel and lease statements with their years in operation, and the three project totals.' },
    ];
  },
};
