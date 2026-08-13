/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * verify-ic-fund-sections.ts
 *
 * Feature B: the fund layer reaches the IC deck.
 *
 * The fund numbers already existed in Module 5, the workbook and both PDFs, and
 * were absent from the deck for one reason: `ICReportModel` carried no fund data
 * at all (`grep -i fund` on icReport.ts returned only `fundingMethodLabel`). So
 * this checks two different things, and the second matters more:
 *
 *   1. THE SECTIONS ARE THERE and carry the right rows, on a REAL engine model
 *      with the fund toggle on.
 *
 *   2. THEY COME FROM THE SHARED BUILDERS. The row order, the labels, and the
 *      no-total-on-balances rule are asserted against fundReports.ts itself, and
 *      the deck is asserted to RE-DECLARE none of them. A presence check alone
 *      would pass just as happily against a fourth hand-maintained copy that
 *      agrees today and drifts next month, which is exactly the failure the
 *      shared builder was extracted to prevent (the PDF's stream build-up had
 *      already drifted once).
 *
 * AND TOGGLE OFF STAYS BYTE-IDENTICAL. Proven by seeding two decks from the
 * same project, one with fund terms absent and one with them fully populated but
 * DISABLED, and comparing them in full. Populated-but-disabled is the state a
 * real user reaches, and it is the state the fund guard has tested since Step 1.
 *
 * Run: npx tsx scripts/verify-ic-fund-sections.ts
 *
 * No em dashes in this file.
 */
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { buildICReportModel, type ICReportModel } from '../src/hubs/modeling/platforms/refm/lib/reports/icReport';
import { seedDeck, SLIDE_TEMPLATES, TEMPLATE_BY_ID } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/templates';
import { TABLE_BINDINGS, resolveTable, type TableBindingKey } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { makeDeckFmt } from '../src/hubs/modeling/platforms/refm/lib/reports/deck/bindings';
import { icMoneyScaleSpec } from '../src/hubs/modeling/platforms/refm/lib/reportInputs';
import {
  buildFundWaterfallRows, buildFundEarnerRows, buildFundGrossNetRows, fundGrossNetNote,
  buildFundTermsPairs, FUND_WATERFALL_ROW_ORDER, FUND_WATERFALL_NO_TOTAL_ROWS,
  FUND_GROSS_NET_COLUMNS, FUND_EARNER_COLUMNS, isFundActive, type FundReportCtx,
} from '../src/hubs/modeling/platforms/refm/lib/reports/fundReports';
import { buildFundCapitalRows, buildFundFeeBasisRows } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import { readFileSync } from 'fs';
import { buildExcelSampleState } from './excelSampleState';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

const TERMS = {
  enabled: true, fundSize: 0, fundSizeOverride: false, facilityLimit: 0, facilityLimitOverride: false,
  fundStructureFeePct: 0.005, fundManagementFeePct: 0.005, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.005, otherExpensesPerAnnum: 3_000_000,
  performanceFeePct: 0.2, hurdleRatePct: 0.08,
  fundManagerName: 'Riverside Fund Managers', feeDistribution: [] as any[],
};

/** `mode` picks the three states the fund guard cares about: terms ABSENT,
 *  terms fully populated but DISABLED, and terms ON. */
function state(mode: 'absent' | 'disabled' | 'on', o: { hurdle?: number } = {}): any {
  const s = buildExcelSampleState();
  if (mode !== 'absent') {
    s.project.fundTerms = { ...TERMS, enabled: mode === 'on', hurdleRatePct: o.hurdle ?? TERMS.hurdleRatePct };
  }
  for (const ph of s.phases) ph.dividendPolicy = { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.9, mode: 'cash_above_min' };
  return s;
}

function model(mode: 'absent' | 'disabled' | 'on', o: { hurdle?: number } = {}): { m: ICReportModel; snap: any; rs: any; st: any } {
  const st = state(mode, o);
  const snap: any = computeFinancialsSnapshot(st);
  const rs: any = computeReturnsSnapshot(snap, st.project);
  const m = buildICReportModel({
    project: st.project, phases: st.phases, assets: st.assets, subUnits: st.subUnits,
    rs, snap, parties: [], asOf: '2026-08-13', cases: [{ id: 'base' } as any],
  });
  return { m, snap, rs, st };
}

const fmt = makeDeckFmt(icMoneyScaleSpec('millions', 'SAR'));
const DECK_SRC = 'src/hubs/modeling/platforms/refm/lib/reports/deck/';

async function main(): Promise<void> {
  console.log('=== IC deck: fund layer sections ===');
  const on = model('on');
  const off = model('absent');
  const disabled = model('disabled');

  console.log('\n-- The fixture actually exercises the fund layer --');
  check('the fund is ACTIVE with the toggle on', on.m.fund.active === true);
  check('and the snapshot agrees (the flag is the engine\'s, not the toggle\'s)', isFundActive(on.rs) === true);
  check('the fund is INERT with terms absent', off.m.fund.active === false);
  check('and INERT with terms populated but disabled', disabled.m.fund.active === false);
  check('fees actually arise on the fixture', on.m.fund.feeBasis.length > 0, `${on.m.fund.feeBasis.length} fee rows`);

  console.log('\n-- 1. Fund terms applied --');
  {
    const shared = buildFundTermsPairs({ snap: on.snap, returns: on.rs, fmt: { money: String, pct: (v, d = 1) => `${((v ?? 0) * 100).toFixed(d)}%`, mult: (v) => `${v}x` } } as FundReportCtx, 'Riverside Fund Managers');
    check('the model carries the terms', on.m.fund.terms.length === shared.length && on.m.fund.terms.length === 3, `${on.m.fund.terms.length}`);
    const labels = on.m.fund.terms.map((t) => t.label);
    check('hurdle, performance fee and fund manager are all named',
      labels.some((l) => /hurdle/i.test(l)) && labels.some((l) => /performance fee/i.test(l)) && labels.some((l) => /fund manager/i.test(l)),
      labels.join(' | '));
    check('the fund manager NAME comes through', on.m.fund.terms.some((t) => t.value === 'Riverside Fund Managers'));
    const t = resolveTable('table.fundTerms', on.m, fmt, {});
    check('the binding resolves on a fund project', t.available === true);
    check('and REFUSES with a reason on a standalone one', resolveTable('table.fundTerms', off.m, fmt, {}).available === false);
  }

  console.log('\n-- 2. Fund fee basis: three capital bases plus five fees --');
  {
    const capital = buildFundCapitalRows(on.snap);
    const basis = buildFundFeeBasisRows(on.snap);
    check('all three capital bases are carried', on.m.fund.capitalBases.length === capital.length && capital.length === 3, `${on.m.fund.capitalBases.length}`);
    check('equity plus debt reconciles to the fund size',
      Math.abs(on.m.fund.capitalBases[0].amount + on.m.fund.capitalBases[1].amount - on.m.fund.capitalBases[2].amount) < 0.01);
    check('all five fees are carried', on.m.fund.feeBasis.length === basis.length && basis.length === 5, `${on.m.fund.feeBasis.length}`);
    const first = on.m.fund.feeBasis[0];
    check('each fee states timing, base, rate and amount',
      !!first.timing && !!first.base && !!first.rate && Number.isFinite(first.charged),
      JSON.stringify(first));
    check('a per-period base names its period count on the Base cell',
      on.m.fund.feeBasis.some((b) => / x \d+$/.test(b.base)), on.m.fund.feeBasis.map((b) => b.base).join(' | '));
    check('the capital bases are captioned as capital, not as fees',
      /not fees/i.test(on.m.fund.capitalNote));
    const t = resolveTable('table.fundFeeBasis', on.m, fmt, {});
    check('the binding resolves', t.available === true);
    check('and puts the capital bases ABOVE the fee rows',
      t.available === true && t.value.rows.length === capital.length + basis.length
      && t.value.rows[0].cells[1].text === 'capital base',
      t.available ? `${t.value.rows.length} rows, first meta="${t.value.rows[0].cells[1].text}"` : 'unresolved');
  }

  console.log('\n-- 3. Distribution waterfall, in the REFERENCE row order --');
  {
    const rowCtx = { snap: on.snap, returns: on.rs, fmt: { money: (v: number) => String(v), pct: () => '', mult: () => '' } } as unknown as FundReportCtx;
    const shared = buildFundWaterfallRows(rowCtx);
    const deckRows = on.m.fund.waterfall.rows;
    check('the waterfall has rows', deckRows.length > 0);
    check('the row ORDER is the shared builder\'s, exactly',
      JSON.stringify(deckRows.map((r) => r.label)) === JSON.stringify(shared.map((r) => r.label)),
      deckRows.map((r) => r.label).join(' | '));
    check('and matches the exported reference order constant',
      JSON.stringify(deckRows.map((r) => r.label)) === JSON.stringify([...FUND_WATERFALL_ROW_ORDER]));
    // The balances must carry NO lifetime total. This is the single most likely
    // thing for a row-copying pass to get wrong, which is why the builder
    // encodes it and this asserts the deck honoured it.
    const noTotal = deckRows.filter((r) => r.total === null).map((r) => r.label);
    check('exactly the documented rows carry no lifetime total',
      noTotal.length === FUND_WATERFALL_NO_TOTAL_ROWS.length && noTotal.every((l) => FUND_WATERFALL_NO_TOTAL_ROWS.includes(l)),
      noTotal.join(' | '));
    check('Hurdle Paid DOES keep its lifetime total',
      (deckRows.find((r) => r.label === 'Hurdle Paid')?.total ?? null) !== null);
    check('the flow-vs-balance note is carried', /LIFETIME/.test(on.m.fund.waterfallNote));
    check('every row spans the full stream axis',
      deckRows.every((r) => r.values.length === on.m.fund.waterfall.years.length));
    check('the binding resolves', resolveTable('table.fundWaterfall', on.m, fmt, { page: 0 }).available === true);
    check('and refuses on a standalone project', resolveTable('table.fundWaterfall', off.m, fmt, { page: 0 }).available === false);
  }

  console.log('\n-- 4. Gross versus net, with the gross-equals-net note --');
  {
    const ctx = { snap: on.snap, returns: on.rs, fmt: { money: (v: number) => String(v), pct: (v: number) => `${v}`, mult: (v: number) => `${v}` } } as unknown as FundReportCtx;
    const shared = buildFundGrossNetRows(ctx);
    check('the columns are the shared list', JSON.stringify(on.m.fund.grossNetColumns) === JSON.stringify([...FUND_GROSS_NET_COLUMNS]));
    check('both rows are carried', on.m.fund.grossNetRows.length === shared.length && shared.length === 2);
    check('the net row is the emphasised one', on.m.fund.grossNetRows[1].emphasis === true);
    // The fixture's hurdle is never cleared, so no performance fee arises and
    // the note must be present. That is the case the note exists for.
    check('no performance fee arises on the fixture', on.rs.waterfall.totalPerformanceFee === 0,
      String(on.rs.waterfall.totalPerformanceFee));
    check('so the gross-equals-net note IS carried', on.m.fund.grossNetNote.length > 0);
    check('and it says why', /no performance fee arises/i.test(on.m.fund.grossNetNote));
    check('it matches the shared builder verbatim', on.m.fund.grossNetNote === fundGrossNetNote({
      snap: on.snap, returns: on.rs,
      fmt: { money: (v: number) => `${(v / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`, pct: () => '', mult: () => '' },
    } as unknown as FundReportCtx));
    check('the binding resolves', resolveTable('table.fundGrossNet', on.m, fmt, {}).available === true);
  }

  console.log('\n-- 5. Fund fee income by earner --');
  {
    const ctx = { snap: on.snap, returns: on.rs, fmt: { money: (v: number) => String(v), pct: (v: number) => `${v}`, mult: (v: number) => `${v}` } } as unknown as FundReportCtx;
    const shared = buildFundEarnerRows(ctx);
    check('the columns are the shared list', JSON.stringify(on.m.fund.earnerColumns) === JSON.stringify([...FUND_EARNER_COLUMNS]));
    check('the earner rows are carried', on.m.fund.earnerRows.length === shared.length && shared.length > 0, `${on.m.fund.earnerRows.length}`);
    check('the Fund Manager appears as an earner', on.m.fund.earnerRows.some((r) => /Fund Manager/i.test(r.cells[1] ?? '')));
    check('a Total row closes the grid', on.m.fund.earnerRows[on.m.fund.earnerRows.length - 1].emphasis === true);
    check('the binding resolves', resolveTable('table.fundFeeEarners', on.m, fmt, {}).available === true);
  }

  console.log('\n-- The deck actually seeds the fund slides --');
  {
    const deckOn = seedDeck('p1', on.m, { inputs: null }, { asOf: '2026-08-13' });
    const ids = deckOn.slides.map((s) => s.templateId);
    for (const id of ['fund_terms', 'fund_waterfall', 'fund_returns']) {
      check(`the seeded deck carries the ${id} slide`, ids.includes(id), ids.filter(Boolean).join(', '));
      check(`${id} is gated on the fund being active`, TEMPLATE_BY_ID[id]?.available(off.m, { inputs: null }) === false);
      check(`${id} is available when it is`, TEMPLATE_BY_ID[id]?.available(on.m, { inputs: null }) === true);
    }
    check('the fund slides carry real table objects',
      deckOn.slides.filter((s) => String(s.templateId).startsWith('fund_'))
        .every((s) => (s.objects ?? []).some((o) => o.type === 'table')));
  }

  console.log('\n-- Toggle OFF is byte-identical --');
  {
    const deckAbsent = seedDeck('p1', off.m, { inputs: null }, { asOf: '2026-08-13' });
    const deckDisabled = seedDeck('p1', disabled.m, { inputs: null }, { asOf: '2026-08-13' });
    // Ids are random per seed, so identity is compared on everything else.
    const strip = (d: any): string => JSON.stringify(d, (k, v) => (k === 'id' || k === 'objects' ? (k === 'id' ? '#' : (v as any[]).map((o: any) => ({ ...o, id: '#' }))) : v));
    check('fund terms ABSENT and populated-but-DISABLED seed identical decks',
      strip(deckAbsent) === strip(deckDisabled));
    check('neither carries a fund slide',
      !deckAbsent.slides.some((s) => String(s.templateId).startsWith('fund_'))
      && !deckDisabled.slides.some((s) => String(s.templateId).startsWith('fund_')));
    // Precise, not keyword-based. A keyword sweep for "hurdle" trips on a
    // pre-existing sensitivity caption ("before it breaks the committee's
    // hurdle"), which is ordinary prose and not fund content. What must be
    // absent is anything the fund layer itself emits: its binding keys and its
    // slide titles.
    const absentJson = JSON.stringify(deckAbsent);
    check('no fund BINDING is referenced by a standalone deck', !absentJson.includes('table.fund'),
      absentJson.slice(Math.max(0, absentJson.indexOf('table.fund') - 60), absentJson.indexOf('table.fund') + 60));
    check('and no fund slide title appears',
      !/Fund Terms and Fees|Fund Distribution Waterfall|Fund Returns and Fee Income/.test(absentJson));
    check('and none of the fund-only wording appears',
      !/preferred return|Performance fee on the excess|capital base|amounts of CAPITAL/i.test(absentJson));
    // The inert block must be inert in every field, not just in `active`.
    const f = off.m.fund;
    check('every fund list is empty with the fund off',
      f.terms.length === 0 && f.capitalBases.length === 0 && f.feeBasis.length === 0
      && f.grossNetRows.length === 0 && f.earnerRows.length === 0
      && f.waterfall.rows.length === 0 && f.feeIncome.rows.length === 0);
    check('and every fund note is empty', f.capitalNote === '' && f.waterfallNote === '' && f.grossNetNote === '');
    check('the schedules report hasData false', f.waterfall.hasData === false && f.feeIncome.hasData === false);
  }

  console.log('\n-- Nothing is a fourth copy of the rows --');
  {
    // The deck must CONSUME the shared builders. If any of these row lists were
    // re-declared here, the two would agree today and drift later, which is the
    // exact failure the shared module exists to prevent.
    const icSrc = readFileSync('src/hubs/modeling/platforms/refm/lib/reports/icReport.ts', 'utf8');
    check('icReport imports the shared fund builders',
      /from '\.\/fundReports'/.test(icSrc) && /buildFundWaterfallRows/.test(icSrc));
    check('and the shared fee basis builders', /buildFundFeeBasisRows/.test(icSrc) && /buildFundCapitalRows/.test(icSrc));
    for (const label of FUND_WATERFALL_ROW_ORDER) {
      check(`the deck layer does NOT restate the row label "${label}"`,
        !icSrc.includes(`'${label}'`) && !icSrc.includes(`"${label}"`));
    }
    const bindSrc = readFileSync(`${DECK_SRC}bindings.ts`, 'utf8');
    const tplSrc = readFileSync(`${DECK_SRC}templates.ts`, 'utf8');
    check('the bindings restate no waterfall row label',
      !FUND_WATERFALL_ROW_ORDER.some((l) => bindSrc.includes(l)));
    check('the templates restate no waterfall row label',
      !FUND_WATERFALL_ROW_ORDER.some((l) => tplSrc.includes(l)));
    check('the gross-vs-net note is not restated in the deck layer',
      !/no performance fee arises/i.test(bindSrc) && !/no performance fee arises/i.test(tplSrc) && !/no performance fee arises/i.test(icSrc));
  }

  console.log('\n-- Every fund binding is registered and reachable --');
  {
    const keys: TableBindingKey[] = ['table.fundTerms', 'table.fundFeeBasis', 'table.fundWaterfall', 'table.fundGrossNet', 'table.fundFeeEarners', 'table.fundFeeIncome'];
    for (const k of keys) check(`${k} is registered`, !!TABLE_BINDINGS[k], 'missing from TABLE_BINDINGS');
    check('every fund binding refuses on a standalone project',
      keys.every((k) => resolveTable(k, off.m, fmt, { page: 0 }).available === false));
  }

  console.log('\n-- House style --');
  for (const f of ['src/hubs/modeling/platforms/refm/lib/reports/icReport.ts', `${DECK_SRC}bindings.ts`, `${DECK_SRC}templates.ts`, 'scripts/verify-ic-fund-sections.ts']) {
    check(`no em dash in ${f.split('/').pop()}`, !readFileSync(f, 'utf8').includes(String.fromCharCode(0x2014)));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures:'); for (const x of failures) console.log(`  - ${x}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
