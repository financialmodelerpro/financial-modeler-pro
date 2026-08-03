/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-layer-guard.ts (fund layer, Step 1: the regression guard)
 *
 * Written BEFORE any fund feature code exists, and it is the safety net every
 * later step is checked against. See docs/FUND_LAYER_GUIDELINE.md.
 *
 * THE CLAIM IT PINS: with the fund toggle present and OFF, the model produces
 * numerically identical results to a model with no fund toggle at all. Not
 * "close", not "within tolerance": identical, value for value, including the
 * sign of a zero.
 *
 * WHY THIS SHAPE. The existing returns suite (verify-returns-snapshot, 99
 * checks) is property-based: it asserts identities (build-up components sum to
 * each stream), relationships (the first construction year is cash negative)
 * and ranges (LTV within [0,2]), all with a 1e-2 tolerance. Those are the
 * right checks for correctness, but a UNIFORM drift, say every distribution
 * three percent lower, satisfies every one of them. So that suite alone cannot
 * answer "is this still what it was yesterday".
 *
 * The obvious fix, pinning golden numbers, rots: the moment the model changes
 * for a legitimate reason, every golden value has to be re-blessed by hand,
 * and a verifier nobody trusts gets re-blessed without being read. So the
 * baseline here is not a frozen number, it is THE SAME ENGINE RUN WITHOUT THE
 * TOGGLE, in the same process, on the same inputs. That comparison stays
 * meaningful for the whole life of the fund layer and needs no maintenance
 * when the model legitimately moves.
 *
 * FOUR LAYERS OF CHECK:
 *   A. The toggle resolves OFF by default, and only a literal true turns it on.
 *   B. Deep, exact equality of the FULL financials snapshot and the FULL
 *      returns snapshot, toggle-absent versus toggle-present-and-off, across
 *      several project shapes. Any divergence is reported with its exact path.
 *   C. The entire existing returns suite is run TWICE as a child process, with
 *      and without the toggle, and both runs must pass with identical counts.
 *      This is what makes the guard cover the whole suite rather than the two
 *      snapshots this file happens to build.
 *   D. The toggle survives the jsonb round trip it is actually stored through,
 *      and its absence survives too.
 *
 * WHAT IT DOES NOT ASSERT: that the toggle ON changes nothing. That is true
 * TODAY only because no feature code exists, and asserting it would turn this
 * guard into a landmine that Step 3 has to defuse. A guard you have to delete
 * to make progress is not a guard.
 *
 * Run: npx tsx scripts/verify-fund-layer-guard.ts
 *
 * No em dashes in this file.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { resolveFundTerms, isFundLayerActive, DEFAULT_FUND_TERMS } from '../src/hubs/modeling/platforms/refm/lib/fundTerms';
import { makeDefaultPhase, makeDefaultProject, makeDefaultCostLines, makeDefaultFinancingTranche } from '../src/hubs/modeling/platforms/refm/lib/state/module1-types';
import { applyOverrides } from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

const root = join(__dirname, '..');

// ── Exact deep comparison ───────────────────────────────────────────────────
//
// Object.is, not ===, so a drift from 0 to -0 or a NaN appearing where a NaN
// was not before is caught rather than passed. Maps are compared by entry
// because the financing snapshot carries per-facility Maps, and JSON.stringify
// renders a Map as {}, which would make a JSON-only comparison blind exactly
// where the debt numbers live.

const typeTag = (v: unknown): string => Object.prototype.toString.call(v);

/** First difference between two values, as a path, or null when identical. */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null;

  const ta = typeTag(a), tb = typeTag(b);
  if (ta !== tb) return `${path || '<root>'}: type ${ta} vs ${tb}`;

  if (typeof a === 'number' || typeof a === 'string' || typeof a === 'boolean'
      || a === null || a === undefined || typeof a === 'bigint') {
    return `${path || '<root>'}: ${String(a)} vs ${String(b)}`;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime() ? null : `${path}: date ${a.toISOString()} vs ${b.toISOString()}`;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return `${path}.size: ${a.size} vs ${b.size}`;
    for (const [k, va] of a.entries()) {
      if (!b.has(k)) return `${path}.get(${String(k)}): missing on the toggled side`;
      const d = firstDiff(va, b.get(k), `${path}.get(${String(k)})`);
      if (d) return d;
    }
    return null;
  }

  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return `${path}.size: ${a.size} vs ${b.size}`;
    for (const v of a) if (!b.has(v)) return `${path}: missing member ${String(v)}`;
    return null;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(ao), ...Object.keys(bo)])).sort();
    for (const k of keys) {
      if (!(k in ao)) return `${path}.${k}: absent without the toggle, present with it`;
      if (!(k in bo)) return `${path}.${k}: present without the toggle, absent with it`;
      const d = firstDiff(ao[k], bo[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }

  return `${path || '<root>'}: not comparable (${ta})`;
}

// ── State builders ──────────────────────────────────────────────────────────
//
// Mirrors verify-returns-snapshot's buildState (a 200-key hotel, dividends, one
// senior tranche) rather than importing it: that file runs its whole suite at
// import time, so importing it here would execute 99 checks as a side effect.
// The shapes below deliberately cover a levered project, an unlevered one, a
// different terminal-value method, and a scenario override, so the comparison
// is not resting on one arrangement of the engine.

function buildState(opts: { returns?: any; noDebt?: boolean } = {}): any {
  const project: any = makeDefaultProject();
  project.startDate = '2026-01-01';
  project.operatingAr = { dsoDays: 30, daysPerYear: 365 };
  project.tax = { rate: 0.15 };
  if (opts.returns) project.returns = opts.returns;
  const p1: any = {
    ...makeDefaultPhase(), id: 'p1', name: 'P1', startDate: '2026-01-01',
    constructionPeriods: 2, operationsPeriods: 8, overlapPeriods: 0,
    dividendPolicy: { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.5, mode: 'cash_above_min' },
  };
  const hotel: any = {
    id: 'H1', phaseId: 'p1', name: 'Hotel', type: '', strategy: 'Operate', visible: true,
    gfaSqm: 0, buaSqm: 30000, sellableBuaSqm: 0, parkingBaysRequired: 0, usefulLifeYears: 20,
    revenue: { operate: { assetId: 'H1', daysPerYear: 365, startingADR: 900, adrIndexation: { method: 'yoy_compound', rate: 0.03 }, occupancyPerPeriodByPhase: Array(11).fill(0.75), guestsPerOccupiedRoom: 1.5, fb: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } }, otherRevenue: { mode: 'fixed_amount', fixedAmountPerPeriodByPhase: Array(11).fill(0), indexation: { method: 'none' } } } },
    opex: { defaultIndexation: { method: 'yoy_compound', rate: 0.03 }, lines: [{ id: 'o1', name: 'Rooms cost', category: 'direct_rooms', mode: 'fixed_baseline', value: 12_000_000, indexation: { method: 'yoy_compound', rate: 0.03 }, useAssetDefault: true, rateMode: 'single' }] },
  };
  const su: any = { id: 'su1', assetId: 'H1', name: 'Keys', category: 'Operable', metric: 'units', metricValue: 200, unitArea: 0, unitPrice: 900, startingAdr: 900 };
  const cl = makeDefaultCostLines('p1', 2);
  const parcel: any = { id: 'parcel1', phaseId: 'p1', name: 'Plot', area: 10000, rate: 1000, cashPct: 100, inKindPct: 0 };
  return {
    project, phases: [p1], assets: [hotel], subUnits: [su], parcels: [parcel],
    costLines: cl, costOverrides: [], landAllocationMode: 'autoByBua',
    financingTranches: opts.noDebt ? [] : [makeDefaultFinancingTranche('t1', 'p1')],
    equityContributions: [],
  };
}

/**
 * The same state with fund terms PRESENT and DISABLED. Nothing else differs.
 *
 * Step 2 made this a FULLY POPULATED block rather than a bare `enabled: false`,
 * because that is the state a real user reaches: they open the Fund Terms tab,
 * type a 2% fee, a 8% hurdle, 20% carry and a fee split, and leave the toggle
 * off until they are ready. "Stored but no effect" has to hold for THOSE
 * values, not only for an empty object. A bare toggle would have passed this
 * guard while a populated one silently changed the model.
 */
function withToggleOff(state: any): any {
  return {
    ...state,
    project: {
      ...state.project,
      fundTerms: {
        enabled: false,
        managementFeePct: 0.02,
        feeBase: 'committed_capital',
        hurdleRatePct: 0.08,
        carryPct: 0.20,
        committedCapital: 250_000_000,
        feeShares: [{ role: 'Sponsor', sharePct: 0.6 }, { role: 'Developer', sharePct: 0.4 }],
      },
    },
  };
}

function runPair(label: string, state: any): void {
  const plain = state;
  const toggled = withToggleOff(state);

  // Sanity: the two inputs really do differ by exactly the fund block, and the
  // block is POPULATED, or the comparison below would be proving nothing.
  check(`${label}: the toggled state carries populated fund terms, disabled`,
    toggled.project.fundTerms?.enabled === false
    && toggled.project.fundTerms?.managementFeePct === 0.02
    && toggled.project.fundTerms?.carryPct === 0.20
    && (toggled.project.fundTerms?.feeShares ?? []).length === 2
    && plain.project.fundTerms === undefined);

  const finA = computeFinancialsSnapshot(plain);
  const finB = computeFinancialsSnapshot(toggled);
  const dFin = firstDiff(finA, finB, 'financials');
  check(`${label}: financials snapshot identical`, dFin === null, dFin ?? '');

  const rsA = computeReturnsSnapshot(finA, plain.project);
  const rsB = computeReturnsSnapshot(finB, toggled.project);
  const dRs = firstDiff(rsA, rsB, 'returns');
  check(`${label}: returns snapshot identical`, dRs === null, dRs ?? '');

  // A blunt second opinion. JSON is blind to Maps, which is why the deep walk
  // above is the primary check, but a serialised match catches anything the
  // walker's key handling might have skipped.
  check(`${label}: serialised returns snapshot identical`,
    JSON.stringify(rsA) === JSON.stringify(rsB));

  // And the headline numbers, named individually, so a failure report says
  // which economics moved rather than only a path.
  check(`${label}: FCFF IRR identical`, Object.is(rsA.result.fcff.irr, rsB.result.fcff.irr),
    `${rsA.result.fcff.irr} vs ${rsB.result.fcff.irr}`);
  check(`${label}: FCFE IRR identical`, Object.is(rsA.result.fcfe.irr, rsB.result.fcfe.irr));
  check(`${label}: equity multiple identical`,
    Object.is(rsA.result.realEstate.equityMultiple, rsB.result.realEstate.equityMultiple));
  check(`${label}: total development cost identical`,
    Object.is(rsA.totalDevelopmentCost, rsB.totalDevelopmentCost));
  check(`${label}: total dividends distributed identical`,
    Object.is(rsA.totalDividendsDistributed, rsB.totalDividendsDistributed));
}

console.log('=== A. The toggle defaults OFF ===');
{
  check('absent fund terms resolve to off', resolveFundTerms({} as any).enabled === false);
  check('undefined project resolves to off', resolveFundTerms(undefined).enabled === false);
  check('null project resolves to off', resolveFundTerms(null).enabled === false);
  check('empty fund terms resolve to off', resolveFundTerms({ fundTerms: {} } as any).enabled === false);
  check('explicit false resolves to off', resolveFundTerms({ fundTerms: { enabled: false } } as any).enabled === false);
  check('explicit true resolves to on', resolveFundTerms({ fundTerms: { enabled: true } } as any).enabled === true);
  // Only a literal true switches it on: a snapshot written by an older build,
  // or a hand-edited jsonb, must not be able to turn the fund layer on.
  check('a truthy non-boolean does NOT switch it on', resolveFundTerms({ fundTerms: { enabled: 'yes' } } as any).enabled === false);
  check('a non-object does NOT switch it on', resolveFundTerms({ fundTerms: true } as any).enabled === false);
  check('isFundLayerActive agrees with the resolver', isFundLayerActive({} as any) === false && isFundLayerActive({ fundTerms: { enabled: true } } as any) === true);
  check('the exported default is off', DEFAULT_FUND_TERMS.enabled === false);
  // The resolver must not hand out its own default object, or one caller
  // mutating the result would flip the default for everyone.
  const r = resolveFundTerms({} as any); r.enabled = true;
  check('the resolver returns a fresh object each time', DEFAULT_FUND_TERMS.enabled === false && resolveFundTerms({} as any).enabled === false);
}

console.log('\n=== B. Toggle present and OFF is byte-identical to no toggle ===');
runPair('levered base', buildState());
runPair('unlevered (no debt)', buildState({ noDebt: true }));
runPair('perpetuity terminal, early exit', buildState({ returns: { discountRate: 0.14, exitYearOffset: 6, terminalMethod: 'perpetuity', perpetuityGrowth: 0.025 } }));
runPair('no terminal value', buildState({ returns: { terminalMethod: 'none' } }));
{
  // A scenario override on top, because the active case drives the whole model
  // and the fund toggle has to be inert through that path too.
  const base = buildState();
  const up = applyOverrides(base, { 'subUnits[id=su1].startingAdr': 1800 });
  runPair('scenario override (ADR up)', up);
}

console.log('\n=== C. The FULL returns suite passes both ways, identically ===');
{
  // Running the real suite as a child process is what makes this guard cover
  // all 99 of its checks rather than only the snapshots built above.
  // Through the shell on purpose: tsx is not a local dependency (the repo runs
  // its verifiers with `npx tsx`), so there is no node_modules/.bin/tsx to
  // spawn directly, and on Windows npx is a .cmd that execFile cannot launch.
  const runSuite = (toggle: boolean): { code: number; out: string } => {
    const env = { ...process.env };
    if (toggle) env.FUND_LAYER_TOGGLE = 'off-present'; else delete env.FUND_LAYER_TOGGLE;
    try {
      const out = execSync('npx tsx scripts/verify-returns-snapshot.ts', {
        cwd: root, env, encoding: 'utf8', stdio: 'pipe', maxBuffer: 32 * 1024 * 1024,
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
      return { code: err.status ?? 1, out: (err.stdout ?? '') + (err.stderr ?? err.message ?? '') };
    }
  };
  const resultLine = (out: string): string | null => {
    const m = /=== Result: (\d+) passed, (\d+) failed ===/.exec(out);
    return m ? `${m[1]} passed, ${m[2]} failed` : null;
  };

  const plain = runSuite(false);
  const toggled = runSuite(true);

  check('returns suite passes with NO fund toggle', plain.code === 0, `exit ${plain.code}`);
  check('returns suite passes with the fund toggle present and OFF', toggled.code === 0, `exit ${toggled.code}`);
  const rp = resultLine(plain.out), rt = resultLine(toggled.out);
  check('the plain run reported a result line', rp !== null);
  check('the toggled run reported a result line', rt !== null);
  check('both runs report the SAME pass and fail counts', rp !== null && rp === rt, `${rp} vs ${rt}`);
  check('no check failed in either run', rp !== null && / 0 failed$/.test(rp) && rt !== null && / 0 failed$/.test(rt));
  // Whole-transcript equality: not just the totals but every check line, so a
  // check that silently swapped from PASS to FAIL and back cannot hide behind
  // a matching count.
  check('both runs produce an identical transcript', plain.out === toggled.out);
}

console.log('\n=== D. The toggle survives the storage it actually uses ===');
{
  // The project rides inside the version snapshot jsonb, so the round trip that
  // matters is JSON. No migration exists for this field at Step 1 and none is
  // needed; the fund terms TABLE arrives with Step 2.
  const withToggle = withToggleOff(buildState()).project;
  const back = JSON.parse(JSON.stringify(withToggle));
  check('an off toggle survives the jsonb round trip', back.fundTerms?.enabled === false);
  check('it still resolves to off after the round trip', resolveFundTerms(back).enabled === false);
  // The Step 2 terms ride in the same snapshot, so a version save captures the
  // fee it was computed with rather than whatever the side table says today.
  check('the populated terms survive the round trip',
    resolveFundTerms(back).managementFeePct === 0.02 && resolveFundTerms(back).carryPct === 0.20
    && resolveFundTerms(back).feeShares.length === 2);

  const plainProject = buildState().project;
  const backPlain = JSON.parse(JSON.stringify(plainProject));
  check('a project with no fund terms stays that way', !('fundTerms' in backPlain));
  check('and still resolves to off', resolveFundTerms(backPlain).enabled === false);

  // Absent must not be silently rewritten into a stored false anywhere: today's
  // projects carry no fund field at all, and that has to stay true.
  check('makeDefaultProject does NOT stamp fund terms', (makeDefaultProject() as any).fundTerms === undefined);
}

console.log('\n=== E. House style ===');
{
  // Written as escapes, so the file that hunts for em dashes contains none
  // rather than being exempted from its own check (same trick as houseStyle.ts).
  const emDash = new RegExp('[\\u2014\\u2015]');
  for (const p of [
    'src/hubs/modeling/platforms/refm/lib/fundTerms.ts',
    'scripts/verify-fund-layer-guard.ts',
    'docs/FUND_LAYER_GUIDELINE.md',
  ]) check(`no em dash in ${p.split('/').pop()}`, !emDash.test(readFileSync(join(root, p), 'utf8')));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
