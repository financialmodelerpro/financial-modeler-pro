/**
 * opsYearGrids.ts (2026-10-26, founder): EVERY OPERATING GRID IS STORED BY
 * OPERATING YEAR, SETTLED ON LOAD AND SAVE.
 *
 * The occupancy ramp of a hotel or lease line and a Sell row's sales during
 * operation were stored by year of the phase, so a longer construction opened
 * the hotel on the ramp's second value (measured on the live project, Phase 2
 * construction 3 to 4 years: 2032 at 50%, the 45% first year lost, and the new
 * last operating year at 0%). The rule now lives in
 * `src/core/calculations/revenue/opsYearGrid.ts`; this settle writes the
 * operating-year field for a block that has none, from the values the engine
 * reads today, at the construction length the project has today.
 *
 * EXACT, OR NOT DONE. A block is converted only when the engine, reading the
 * new field by the new rule, sells and occupies the same years at the same
 * values as it does now; otherwise it is left on the old rule and the engine
 * reads it as before (a Sell row with sales during operation inside the
 * construction years, or pre-sales after them, is the case). So the
 * conversion moves no figure on any project.
 *
 * IT SETTLES: the input array comes back when nothing is missing, so a
 * converted project hydrates to the object it always did. The new field is an
 * ADDITION, never a rewrite of a stored one, so the schema banner (which
 * counts an added field as a derived fill) is not raised. Called from
 * `settleModel` (every load and every case model) and `extractPersistSnapshot`.
 *
 * No em dashes in this file.
 */

import type { Asset, Phase, Project } from './module1-types';
import { expandPhaseLocalToAxis, revenueAxisOf } from '../revenue-resolvers';
import { opsGridToPhaseLocal, sellFirstOpsLocal } from '@/src/core/calculations/revenue/opsYearGrid';

type Row = { preSalesVelocity?: number[]; postSalesVelocity?: number[]; preSalesVelocityByPhase?: number[]; postSalesVelocityByPhase?: number[]; postSalesVelocityByOpsYear?: number[] };

const sameAxis = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => Math.abs(x - (b[i] ?? 0)) < 1e-12);

/** The operating window of a hotel or lease block on the axis: the resolver's own rule. */
function opsWindow(phase: Phase, projectStartYear: number, N: number, override: number | undefined): { start: number; end: number; cs: number } {
  const ps = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
  const cp = Math.max(0, phase.constructionPeriods ?? 0), op = Math.max(0, phase.operationsPeriods ?? 0), ov = Math.max(0, phase.overlapPeriods ?? 0);
  const cs = Math.max(0, Math.min(N - 1, ps - projectStartYear));
  const hand = Math.max(cs, Math.min(N - 1, cs + cp - 1));
  const dflt = Math.max(cs, Math.min(N - 1, hand + 1 - ov));
  const start = override != null ? Math.max(cs, Math.min(N - 1, override - projectStartYear)) : dflt;
  return { start, end: Math.max(start, Math.min(N - 1, dflt + op - 1)), cs };
}

/** A Sell row keyed by operating year, or undefined when the old rule cannot be restated exactly. */
function convertRow(row: Row, phase: Phase, phaseOffset: number, N: number): number[] | undefined {
  const cp = Math.max(0, phase.constructionPeriods ?? 0), op = Math.max(0, phase.operationsPeriods ?? 0);
  const first = sellFirstOpsLocal(cp, phase.overlapPeriods ?? 0);
  const preNow = expandPhaseLocalToAxis(row.preSalesVelocityByPhase, row.preSalesVelocity, phaseOffset, N);
  const postNow = expandPhaseLocalToAxis(row.postSalesVelocityByPhase, row.postSalesVelocity, phaseOffset, N);
  const firstIdx = phaseOffset + first;
  let last = -1;
  postNow.forEach((v, i) => { if (v !== 0) last = i; });
  const len = Math.max(op, last + 1 - firstIdx, 0);
  const byOps = Array.from({ length: len }, (_, k) => postNow[firstIdx + k] ?? 0);
  const pre = Array.from({ length: cp }, (_, i) => row.preSalesVelocityByPhase?.[i] ?? 0);
  const preNew = expandPhaseLocalToAxis(pre, undefined, phaseOffset, N);
  const postNew = expandPhaseLocalToAxis(opsGridToPhaseLocal(byOps, first), undefined, phaseOffset, N);
  return sameAxis(preNow, preNew) && sameAxis(postNow, postNew) ? byOps : undefined;
}

export interface OpsGridSettleReport { assets: Asset[]; changed: boolean; converted: string[]; leftOnPhaseYears: string[] }

export function settleOpsYearGrids(assets: readonly Asset[], phases: readonly Phase[], project: Project): OpsGridSettleReport {
  const { projectStartYear, N } = revenueAxisOf(project, phases);
  const converted: string[] = [], left: string[] = [];
  let changed = false;
  const next = assets.map((a) => {
    const rev = a.revenue;
    const phase = phases.find((p) => p.id === a.phaseId);
    if (!rev || !phase) return a;
    const ps = phase.startDate ? new Date(phase.startDate).getUTCFullYear() : projectStartYear;
    const phaseOffset = ps - projectStartYear;
    let out = rev;
    for (const form of ['operate', 'lease'] as const) {
      const b = out[form];
      if (!b || b.occupancyByOpsYear !== undefined) continue;
      const w = opsWindow(phase, projectStartYear, N, b.operationsStartYearOverride ?? undefined);
      const axis = expandPhaseLocalToAxis(b.occupancyPerPeriodByPhase, b.occupancyPerPeriod, phaseOffset, N);
      out = { ...out, [form]: { ...b, occupancyByOpsYear: axis.slice(w.start, w.end + 1) } };
      converted.push(`${a.id}:${form}`);
    }
    const sell = out.sell;
    if (sell) {
      let rows = sell.subUnits, dflt = sell.velocityDefault, moved = false;
      if (rows?.some((r) => r.postSalesVelocityByOpsYear === undefined)) {
        rows = rows.map((r) => {
          if (r.postSalesVelocityByOpsYear !== undefined) return r;
          const byOps = convertRow(r, phase, phaseOffset, N);
          if (!byOps) { left.push(`${a.id}:${r.subUnitId}`); return r; }
          moved = true;
          return { ...r, postSalesVelocityByOpsYear: byOps };
        });
      }
      if (dflt && dflt.postSalesVelocityByOpsYear === undefined) {
        const byOps = convertRow(dflt, phase, phaseOffset, N);
        if (byOps) { dflt = { ...dflt, postSalesVelocityByOpsYear: byOps }; moved = true; } else left.push(`${a.id}:line pace`);
      }
      if (moved) { out = { ...out, sell: { ...sell, subUnits: rows, velocityDefault: dflt } }; converted.push(`${a.id}:sell`); }
    }
    if (out === rev) return a;
    changed = true;
    return { ...a, revenue: out };
  });
  return changed ? { assets: next, changed, converted, leftOnPhaseYears: left } : { assets: assets as Asset[], changed: false, converted, leftOnPhaseYears: left };
}
