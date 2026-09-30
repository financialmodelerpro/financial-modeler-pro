/**
 * verify-covenants.ts (2026-06-15): pure lender-covenant evaluation.
 *
 * Covers the threshold defaults, the per-period ratio derivation (incl. the
 * derived Debt Yield = NOI / debt and the peak-debt LTV = debt / GDV, with an
 * exit-only fallback), and the pass / breach verdict vs editable thresholds.
 * No engine: the ratio inputs are the series the RE Metrics tab reads off the
 * returns snapshot.
 *
 * Run: npx tsx scripts/verify-covenants.ts
 */
import { evaluateCovenant, covenantSeries, covenantUnit, reduceWorst, reduceAvg, covenantCoverageNote, THIN_TEST_YEARS, type CovenantInputs } from '../src/hubs/modeling/platforms/refm/lib/covenants';
import { readFileSync } from 'fs';
import { readLiveProjectVersion } from './fixtures/liveProject';
import { loadStoredModel } from '../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { DEFAULT_COVENANTS, type CovenantThreshold } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';

let pass = 0, fail = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const near = (a: number, b: number, t = 1e-9) => Math.abs(a - b) <= t;

console.log('=== Lender covenants ===');

// ── Defaults ────────────────────────────────────────────────────────────────
{
  const byId = new Map(DEFAULT_COVENANTS.map((c) => [c.metric, c]));
  check('default DSCR = min 1.20x', byId.get('dscr')!.operator === 'min' && byId.get('dscr')!.threshold === 1.20);
  check('default ICR = min 2.00x', byId.get('icr')!.operator === 'min' && byId.get('icr')!.threshold === 2.00);
  check('default LTV = max 0.60 (60%)', byId.get('ltv')!.operator === 'max' && byId.get('ltv')!.threshold === 0.60);
  check('default Debt Yield = min 0.10 (10%)', byId.get('debt_yield')!.operator === 'min' && byId.get('debt_yield')!.threshold === 0.10);
  check('units: dscr/icr = x, ltv/debt_yield = pct', covenantUnit('dscr') === 'x' && covenantUnit('icr') === 'x' && covenantUnit('ltv') === 'pct' && covenantUnit('debt_yield') === 'pct');
}

// A fixture: 6 periods, debt service in periods 2..5, NOI ramping, debt paying down.
const inp: CovenantInputs = {
  dscrPerPeriod: [0, 0, 1.10, 1.45, 1.80, 2.10],   // period 2 breaches 1.20
  dscrMin: 1.10, dscrAvg: 1.6125,
  icrPerPeriod: [0, 0, 2.50, 3.10, 3.80, 4.50],     // min 2.50 passes 2.00
  icrMin: 2.50,
  noiPerPeriod: [0, 0, 9_000_000, 12_000_000, 14_000_000, 15_000_000],
  debtOutstandingPerPeriod: [0, 100_000_000, 90_000_000, 70_000_000, 40_000_000, 0],
  gdvValue: 200_000_000,   // peak debt 100M / GDV 200M = 0.50 peak-debt LTV
  ltvAtExit: 0.55,
};

// ── Reducers (the single derivation used by both covenants AND the cards) ──────
{
  check('reduceWorst min ignores nulls', reduceWorst([null, 1.8, 1.1, null, 2.0], 'min') === 1.1);
  check('reduceWorst max ignores nulls', reduceWorst([null, 0.5, 0.3, 0.6], 'max') === 0.6);
  check('reduceAvg = mean over non-null', near(reduceAvg([null, 1.0, 2.0, null, 3.0])!, 2.0));
  check('reduceWorst all-null => null', reduceWorst([null, null], 'min') === null);
  check('reduceAvg all-null => null', reduceAvg([null, null]) === null);
}

// ── DSCR ──────────────────────────────────────────────────────────────────────
{
  const cov: CovenantThreshold = { id: 'd', metric: 'dscr', label: 'DSCR', operator: 'min', threshold: 1.20 };
  const ev = evaluateCovenant(cov, inp);
  // Single source of truth: worst / avg are reduced from the per-period series.
  check('DSCR worst = min over the per-period series (1.10)', ev.worst === 1.10);
  check('DSCR worst === reduceWorst(covenantSeries) (no parallel path)', ev.worst === reduceWorst(covenantSeries('dscr', inp), 'min'));
  check('DSCR avg = mean over the per-period series', near(ev.avg!, 1.6125) && near(ev.avg!, reduceAvg(covenantSeries('dscr', inp))!));
  check('DSCR worst independent of (removed) engine dscrMin input', evaluateCovenant(cov, { ...inp, dscrMin: undefined, dscrAvg: undefined }).worst === 1.10);
  check('DSCR vs 1.20 => BREACH (worst 1.10 < 1.20)', ev.pass === false);
  check('DSCR series masks no-debt periods to null', ev.seriesPerPeriod[0] === null && ev.seriesPerPeriod[2] === 1.10);
  const ev2 = evaluateCovenant({ ...cov, threshold: 1.05 }, inp);
  check('DSCR vs 1.05 => PASS', ev2.pass === true);
}

// ── ICR ───────────────────────────────────────────────────────────────────────
{
  const ev = evaluateCovenant({ id: 'i', metric: 'icr', label: 'ICR', operator: 'min', threshold: 2.00 }, inp);
  check('ICR worst = min over the per-period series (2.50)', ev.worst === 2.50);
  check('ICR worst === reduceWorst(covenantSeries) (no parallel path)', ev.worst === reduceWorst(covenantSeries('icr', inp), 'min'));
  check('ICR worst independent of (removed) engine icrMin input', evaluateCovenant({ id: 'i', metric: 'icr', label: 'ICR', operator: 'min', threshold: 2.0 }, { ...inp, icrMin: undefined }).worst === 2.50);
  check('ICR vs 2.00 => PASS', ev.pass === true);
  check('ICR breaches at a higher bar (3.00)', evaluateCovenant({ id: 'i2', metric: 'icr', label: 'ICR', operator: 'min', threshold: 3.0 }, inp).pass === false);
}

// ── Debt Yield (DERIVED NOI / debt) ────────────────────────────────────────────
{
  const ev = evaluateCovenant({ id: 'dy', metric: 'debt_yield', label: 'Debt Yield', operator: 'min', threshold: 0.10 }, inp);
  // period 2: 9,000,000 / 90,000,000 = 0.10 ; period 5: debt 0 => null
  check('Debt Yield derived = NOI / debt', near(ev.seriesPerPeriod[2] as number, 0.10) && near(ev.seriesPerPeriod[3] as number, 12_000_000 / 70_000_000));
  check('Debt Yield null where debt = 0', ev.seriesPerPeriod[1] === null && ev.seriesPerPeriod[5] === null);
  check('Debt Yield worst = min over debt periods (0.10)', near(ev.worst!, 0.10));
  check('Debt Yield vs 10% => PASS (worst 10% >= 10%)', ev.pass === true);
  check('Debt Yield vs 12% => BREACH', evaluateCovenant({ id: 'dy2', metric: 'debt_yield', label: 'DY', operator: 'min', threshold: 0.12 }, inp).pass === false);
}

// ── LTV (peak debt / GDV) ──────────────────────────────────────────────────────
{
  const ev = evaluateCovenant({ id: 'l', metric: 'ltv', label: 'LTV', operator: 'max', threshold: 0.60 }, inp);
  check('LTV is peak-debt, not exit-only (has a per-period series)', ev.exitOnly === false);
  check('LTV basis labelled peak debt / GDV', ev.basis === 'peak-debt' && ev.basisLabel === 'peak debt / GDV');
  check('LTV per-period = debt / GDV (period 1: 100M/200M = 0.50)', near(ev.seriesPerPeriod[1] as number, 0.50) && near(ev.seriesPerPeriod[3] as number, 70_000_000 / 200_000_000));
  check('LTV null where no debt drawn', ev.seriesPerPeriod[0] === null && ev.seriesPerPeriod[5] === null);
  check('LTV worst = peak debt / GDV (max 0.50)', near(ev.worst!, 0.50));
  check('LTV vs 60% max => PASS (peak 0.50 <= 0.60)', ev.pass === true);
  check('LTV vs 40% max => BREACH (peak 0.50 > 0.40)', evaluateCovenant({ id: 'l2', metric: 'ltv', label: 'LTV', operator: 'max', threshold: 0.40 }, inp).pass === false);
}

// ── LTV fallback (no GDV basis) => exit-only, explicitly labelled ───────────────
{
  const noGdv: CovenantInputs = { ...inp, gdvValue: null };
  const ev = evaluateCovenant({ id: 'l3', metric: 'ltv', label: 'LTV', operator: 'max', threshold: 0.60 }, noGdv);
  check('LTV falls back to exit-only when no GDV', ev.exitOnly === true && ev.basis === 'exit' && ev.basisLabel === 'LTV at exit');
  check('LTV fallback worst = ltvAtExit (0.55)', ev.worst === 0.55);
  check('LTV fallback series all null', ev.seriesPerPeriod.every((v) => v === null));
  check('LTV fallback vs 60% max => PASS', ev.pass === true);
  check('LTV fallback vs 50% max => BREACH', evaluateCovenant({ id: 'l4', metric: 'ltv', label: 'LTV', operator: 'max', threshold: 0.50 }, noGdv).pass === false);
}

// ── Custom (placeholder, no auto ratio) ────────────────────────────────────────
{
  const ev = evaluateCovenant({ id: 'c', metric: 'custom', label: 'Bank-specific', operator: 'min', threshold: 1.5 }, inp);
  check('custom covenant has no series / verdict (user-tracked)', ev.pass === null && ev.worst === null && ev.seriesPerPeriod.every((v) => v === null));
}

// ── covenantSeries length aligns with the period axis ──────────────────────────
check('covenantSeries length = axis length', covenantSeries('dscr', inp).length === inp.dscrPerPeriod.length);

// ── How many years each covenant is tested in (2026-09-30, export review item 14) ──
// A Pass resting on one or two points must say so; a covenant tested across the debt life says
// nothing extra. Both branches driven here, the firing one on the live project too.
{
  const yl = [2027, 2028, 2029, 2030];
  const ev = (series: Array<number | null>, exitOnly = false) => ({ seriesPerPeriod: series, exitOnly });
  const thin = covenantCoverageNote([
    { label: 'Debt Yield', ev: ev([null, 0.1, null, null]) },
    { label: 'DSCR', ev: ev([null, 3, 5, null]) },
    { label: 'LTV (peak debt)', ev: ev([0.1, 0.2, 0.2, 0.1]) },
    { label: 'LTV at exit', ev: ev([null, null, null, null], true) },
  ], yl);
  check('CV1 a covenant tested in one year is named with that year', !!thin && /Debt Yield is tested in one year only \(2028\)/.test(thin), thin ?? 'null');
  check('CV2 one tested in two years is named with both', !!thin && /DSCR is tested in 2 years only \(2028, 2029\)/.test(thin));
  check('CV3 one tested across the life is not mentioned', !!thin && !/LTV/.test(thin));
  check(`CV4 when every covenant is tested in ${THIN_TEST_YEARS} or more years, nothing is said`,
    covenantCoverageNote([{ label: 'DSCR', ev: ev([1, 2, 3, null]) }], yl) === null);
  const R = 'src/hubs/modeling/platforms/refm/';
  const callers = ['components/modules/Module5Metrics.tsx', 'lib/excel/buildModelWorkbook.ts', 'lib/pdf/generateProjectPdf.ts']
    .filter((f) => !/covenantCoverageNote\(/.test(readFileSync(R + f, 'utf8')));
  check('CV5 the screen, the workbook and the PDF print it through covenantCoverageNote', callers.length === 0, callers.join(', '));
}

(async () => {
  const live = await readLiveProjectVersion();
  if (!live.ok) { check('CV6 live project read', false, 'noCredentials' in live && live.noCredentials ? 'no credentials' : (live as { reason: string }).reason); }
  else {
    const q = <T,>(f: () => T): T => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };
    const m: any = q(() => loadStoredModel(live.snapshot).snapshot);
    const snap: any = q(() => computeFinancialsSnapshot(m));
    const rs: any = q(() => computeReturnsSnapshot(snap, m.project));
    const re = rs.result.realEstate;
    const li: CovenantInputs = { dscrPerPeriod: re.dscrPerPeriod, icrPerPeriod: re.icrPerPeriod, noiPerPeriod: rs.noiPerPeriod, debtOutstandingPerPeriod: snap.bs.debtOutstandingPerPeriod, gdvValue: rs.developmentEconomics.gdv, ltvAtExit: re.ltvAtExit };
    const evals = (m.project.covenants ?? DEFAULT_COVENANTS).map((c: CovenantThreshold) => ({ label: c.label, ev: evaluateCovenant(c, li) }));
    const note = covenantCoverageNote(evals, snap.yearLabels);
    // Independently counted: every covenant with 1..THIN-1 tested years must be named, no other.
    const expected = evals.filter((e: any) => !e.ev.exitOnly).map((e: any) => ({ label: e.label, n: e.ev.seriesPerPeriod.filter((v: any) => v != null).length })).filter((x: any) => x.n > 0 && x.n < THIN_TEST_YEARS);
    console.log(`     ${live.label}: ${expected.map((x: any) => `${x.label} ${x.n}`).join(', ') || 'none thin'}`);
    check(`CV6 ${live.label}: the note names exactly the covenants tested in fewer than ${THIN_TEST_YEARS} years`,
      expected.length > 0 && !!note && expected.every((x: any) => note.includes(`${x.label} is tested in`))
      && evals.filter((e: any) => !expected.some((x: any) => x.label === e.label)).every((e: any) => !note.includes(`${e.label} is tested in`)), note ?? 'null');
  }
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', fails.join(', ')); process.exit(1); }
})();
