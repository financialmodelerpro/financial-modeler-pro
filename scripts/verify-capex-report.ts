/**
 * verify-capex-report.ts
 *
 * Locks the shared Capex report builder (lib/reports/capexReports.ts) the PDF
 * Capex mirror renders from. Critically pins that the per-asset Results rows
 * RECONCILE to the project capex totals on the financials snapshot (so the PDF
 * mirror cannot silently drift from the engine), plus the asset-wise input
 * table carries the per-metric quantity + engine amount.
 */
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { buildCapexReport, planCapexSummaryLines } from '../src/hubs/modeling/platforms/refm/lib/reports/capexReports';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}
const A = (n: number, f = 0): number[] => Array(n).fill(f);

function buildState(): any {
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  const p1: any = { ...makeDefaultPhase(), id: 'p1', name: 'Phase 1', startDate: '2026-01-01', constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0 };
  const p2: any = { ...makeDefaultPhase(), id: 'p2', name: 'Phase 2', startDate: '2028-01-01', constructionPeriods: 2, operationsPeriods: 6, overlapPeriods: 0 };
  const resi: any = { id: 'R1', phaseId: 'p1', name: 'Residences', type: '', strategy: 'Sell', visible: true, gfaSqm: 0, buaSqm: 20000, sellableBuaSqm: 20000, parkingBaysRequired: 0,
    revenue: { sell: { assetId: 'R1', subUnits: [{ subUnitId: 'rsu1', preSalesVelocityByPhase: [30, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], postSalesVelocityByPhase: [0, 0, 10, 10, 10, 10, 0, 0, 0, 0, 0] }], cashPaymentProfile: { percentages: [0.5, 0.5] }, recognitionProfile: { method: 'point_in_time', pointInTimeYear: 'handover' }, indexation: { method: 'none' } } } };
  const suR: any = { id: 'rsu1', assetId: 'R1', name: 'Apartments', category: 'Sellable', metric: 'units', metricValue: 100, unitArea: 100, unitPrice: 1_000_000 };
  const retail: any = { id: 'L1', phaseId: 'p2', name: 'Retail', type: '', strategy: 'Lease', visible: true, gfaSqm: 0, buaSqm: 5000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 25,
    revenue: { lease: { assetId: 'L1', baseRate: 1200, rentIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: A(8, 0.9), arDays: 60 } } };
  const suL: any = { id: 'lsu1', assetId: 'L1', name: 'Shops', category: 'Leasable', metric: 'area', metricValue: 5000, unitArea: 0, unitPrice: 1200 };
  const cl: any[] = [...makeDefaultCostLines('p1', 2), ...makeDefaultCostLines('p2', 2)];
  // A percent-of-construction line so the basis column covers % methods.
  cl.push({ id: 'pct1', phaseId: 'p1', name: 'Contingency', stage: 'soft', method: 'percent_of_construction', value: 10, phasing: 'even', startPeriod: 0, endPeriod: 1 });
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  return { project, phases: [p1, p2], assets: [resi, retail], subUnits: [suR, suL], parcels: [parcel], costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua', financingTranches: [makeDefaultFinancingTranche('t1', 'p1'), makeDefaultFinancingTranche('t2', 'p2')], equityContributions: [] };
}

// A SUBTOTAL IS NOT A BODY ROW (2026-09-11). The summary tables gained a
// per-phase subtotal, and this summed every row that was not the grand total,
// so each phase counted twice. Caught by the fixture, which has two phases.
function reconciles(rows: { values: number[]; isTotal?: boolean; isSection?: boolean; isSubtotal?: boolean }[], N: number): number {
  const total = rows.find((r) => r.isTotal)?.values ?? [];
  const summed = A(N);
  for (const r of rows.filter((r) => !r.isTotal && !r.isSection && !r.isSubtotal)) for (let i = 0; i < N; i++) summed[i] += r.values[i] ?? 0;
  let maxDiff = 0;
  for (let i = 0; i < N; i++) maxDiff = Math.max(maxDiff, Math.abs(summed[i] - (total[i] ?? 0)));
  return maxDiff;
}

function main(): void {
  console.log('=== Capex report builder test ===');
  const state = buildState();
  const snap = computeFinancialsSnapshot(state);
  const N = snap.yearLabels.length;
  const rep = buildCapexReport(snap, state);

  check('input tables emitted per asset', rep.inputAssets.length >= 1, `n=${rep.inputAssets.length}`);
  check('input lines carry an engine amount', rep.inputAssets.every((a) => a.lines.every((l) => Number.isFinite(l.amount))));
  check('input total matches sum of line amounts', rep.inputAssets.every((a) => Math.abs(a.total - a.lines.reduce((s, l) => s + l.amount, 0)) < Math.max(1, a.total * 1e-6)));

  // Percent line: basis column = a money basis where amount = basis x rate%.
  const allLines = rep.inputAssets.flatMap((a) => a.lines);
  const rateLine = allLines.find((l) => l.metricKind === 'area' && (l.metricValue ?? 0) > 0);
  check('rate line carries an area/count quantity', !!rateLine);
  const pctLine = allLines.find((l) => l.name === 'Contingency' && l.isPercent);
  check('percent line present + flagged isPercent', !!pctLine);
  if (pctLine) {
    check('percent line basis is a money amount', pctLine.metricKind === 'money' && (pctLine.metricValue ?? 0) > 0, `kind=${pctLine.metricKind} base=${pctLine.metricValue}`);
    const reconstructed = (pctLine.metricValue ?? 0) * (pctLine.rate / 100);
    check('percent line: basis x rate% == amount', Math.abs(reconstructed - pctLine.amount) < Math.max(1, pctLine.amount * 1e-6), `recon=${reconstructed} amount=${pctLine.amount}`);
  }

  for (const title of ['Total Capex (incl. all land)', 'Capex excl. Land In-Kind (cash-impact schedule)', 'Capex excl. Total Land (pure development cost)']) {
    const t = rep.results.find((r) => r.title === title);
    check(`results table present: ${title}`, !!t);
    if (t) check(`per-asset rows reconcile to project total: ${title}`, reconciles(t.rows, N) < 1, `maxDiff=${reconciles(t.rows, N).toFixed(2)}`);
  }

  // ── THE SHAPE OF A SUMMARY TABLE (2026-09-11) ──
  //
  // Four properties, all of them things the table got wrong: it printed one row
  // per PLOT, carried the phase inside the label, offered no phase subtotal, and
  // put the retail companion after every grouped line so phase 1 retail printed
  // below phase 2 plots.
  const t2 = rep.results.find((r) => r.title === 'Total Capex (incl. all land)');
  const body = (t2?.rows ?? []).filter((r) => !r.isTotal && !r.isSubtotal);
  const subs = (t2?.rows ?? []).filter((r) => r.isSubtotal);
  check('a subtotal per phase, inside the table',
    subs.length === 2 && subs.every((r) => r.label.startsWith('Subtotal, ')),
    subs.map((r) => r.label).join(' | '));
  check('the subtotals sum to the body, so they are subtotals and not extra rows',
    (() => {
      const b = A(N); const s = A(N);
      for (const r of body) for (let k = 0; k < N; k++) b[k] += r.values[k] ?? 0;
      for (const r of subs) for (let k = 0; k < N; k++) s[k] += r.values[k] ?? 0;
      return b.every((v, k) => Math.abs(v - s[k]) < 0.01);
    })());
  check('the phase is stated ONCE per row, never twice',
    body.every((r) => (r.label.match(/Phase /g) ?? []).length <= 1),
    body.map((r) => r.label).join(' | '));
  check('rows are grouped by phase and never revisit one',
    (() => {
      const order = (t2?.rows ?? []).filter((r) => r.isSubtotal).map((r) => r.label);
      return order.length === new Set(order).size;
    })());

  // MERGED BY LINE, and a companion beside its OWN line. Built directly so the
  // ordering rule is exercised rather than inferred from a fixture that happens
  // to have one plot per type.
  {
    const phases = [{ id: 'p1', name: 'Phase 1' }, { id: 'p2', name: 'Phase 2' }];
    const mk = (id: string, phaseId: string, type: string, extra: Record<string, unknown> = {}): any =>
      ({ id, phaseId, type, strategy: 'Sell', visible: true, ...extra });
    const lines = planCapexSummaryLines([
      mk('a1', 'p1', 'Branded Villas'),
      mk('a2', 'p1', 'Branded Villas'),
      mk('retail_p1__branded-villas', 'p1', 'Branded Villas', { strategy: 'Lease', isCompanion: true, companionType: 'retail' }),
      mk('b1', 'p2', 'Hotel'),
    ], phases, (id) => id);
    check('two plots of one type in one phase are ONE row',
      lines.filter((l) => l.phaseId === 'p1' && !l.isCompanion).length === 1
      && lines[0].assetIds.length === 2,
      lines.map((l) => `${l.phaseName}:${l.label}[${l.assetIds.length}]`).join(' | '));
    check('the companion sits with its OWN line, not at the end',
      lines[1]?.isCompanion === true && lines[1]?.phaseId === 'p1' && lines[2]?.phaseId === 'p2',
      lines.map((l) => `${l.phaseName}:${l.label}`).join(' | '));
    check('and no line label carries its phase, because the phase is a column',
      lines.every((l) => !l.label.includes('Phase')),
      lines.map((l) => l.label).join(' | '));
    check('every asset lands in exactly one row',
      lines.flatMap((l) => l.assetIds).length === 4
      && new Set(lines.flatMap((l) => l.assetIds)).size === 4);
  }

  // The per-line schedule (Table 1) project total reconciles to incl-all too.
  const t1 = rep.results.find((r) => r.title.startsWith('Capex Schedule by Period'));
  check('per-line schedule table present', !!t1);

  /**
   * TABLE 1 IS THE LINE'S SCHEDULE, WITH ITS PLOTS INSIDE IT (2026-09-11).
   *
   * It was one block per plot in ASSET ORDER, so a line's plots sat apart with
   * other lines and another phase's plots between them, and a reader adding up
   * what one line spends had to find its blocks first.
   *
   * THE WRAPPER IS CONDITIONAL, which is the half a shape check would miss: a
   * line holding ONE plot is that plot, so a heading naming the line above a
   * heading naming the plot, and a line subtotal repeating the plot subtotal
   * one row above it, would be two redundant rows on almost every block. So
   * this asserts BOTH directions, on two fixtures.
   */
  {
    const two = buildState();
    // A SECOND PLOT OF THE SAME TYPE IN THE SAME PHASE, which is the only shape
    // that earns a wrapper. Both carry a type, because an untyped asset keys to
    // a different line.
    const first: any = two.assets[0];
    first.type = 'Branded Villas';
    const second: any = { ...first, id: 'R2', revenue: { sell: { ...first.revenue.sell, assetId: 'R2', subUnits: [{ ...first.revenue.sell.subUnits[0], subUnitId: 'rsu2' }] } } };
    two.assets = [first, second, two.assets[1]];
    two.subUnits = [...two.subUnits, { ...two.subUnits[0], id: 'rsu2', assetId: 'R2' }];
    const snapTwo = computeFinancialsSnapshot(two);
    const repTwo = buildCapexReport(snapTwo, two);
    const tblTwo = repTwo.results.find((r) => r.title.startsWith('Capex Schedule by Period'));
    const rowsTwo = tblTwo?.rows ?? [];
    const wrappers = rowsTwo.filter((r) => r.isSection && (r.indent ?? 0) === 0 && rowsTwo.some((q) => q.isSection && (q.indent ?? 0) === 1));
    const nested = rowsTwo.filter((r) => r.isSection && (r.indent ?? 0) === 1);
    check('T1a a line holding two plots is wrapped, with both plots nested inside it',
      nested.length === 2 && wrappers.length >= 1,
      `nested=${nested.length} wrappers=${wrappers.length}`);
    const lineSub = rowsTwo.find((r) => r.isSubtotal && (r.indent ?? 0) === 0 && r.label.includes('Branded Villas') && !r.label.includes('R1') && !r.label.includes('R2'));
    const plotSubs = rowsTwo.filter((r) => r.isSubtotal && (r.indent ?? 0) === 1);
    check('T1b the line subtotal is the sum of its plots, to the cent',
      lineSub !== undefined && plotSubs.length === 2
      && lineSub.values.every((v, i) => Math.abs(v - plotSubs.reduce((s, r) => s + (r.values[i] ?? 0), 0)) < 0.005),
      `lineSub=${lineSub ? lineSub.label : 'none'} plotSubs=${plotSubs.length}`);
    check('T1c and the schedule still foots to the project total',
      (() => {
        const total = rowsTwo.find((r) => r.isTotal)?.values ?? [];
        const summed = A(N);
        // Only the deepest rows, the cost lines: every subtotal above them
        // repeats money that is already counted.
        const deepest = rowsTwo.filter((r) => !r.isTotal && !r.isSection && !r.isSubtotal);
        for (const r of deepest) for (let i = 0; i < N; i++) summed[i] += r.values[i] ?? 0;
        return summed.every((v, i) => Math.abs(v - (total[i] ?? 0)) < 1);
      })());
    // THE OTHER DIRECTION. The one-plot fixture must gain NOTHING: no nested
    // section, and no subtotal whose value repeats the row above it.
    const rowsOne = (rep.results.find((r) => r.title.startsWith('Capex Schedule by Period'))?.rows ?? []);
    check('T1d a line holding one plot is NOT wrapped, so no heading or subtotal repeats',
      rowsOne.every((r) => (r.indent ?? 0) === 0 || !r.isSection)
      && rowsOne.filter((r) => r.isSubtotal).every((r, i, arr) => {
        const prev = arr[i - 1];
        return prev === undefined || !prev.values.every((v, k) => Math.abs(v - (r.values[k] ?? 0)) < 0.005);
      }),
      rowsOne.filter((r) => r.isSection).map((r) => `${r.indent ?? 0}:${r.label}`).join(' | '));
  }


  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

main();
