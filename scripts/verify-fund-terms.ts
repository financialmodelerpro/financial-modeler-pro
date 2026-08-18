/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-terms.ts (fund layer Step 2 extended: the fee set, the bases, and
 * the per-party distribution matrix)
 *
 * Step 2 is inputs only, so the things worth pinning are the ones that would
 * quietly corrupt money later:
 *
 *   1. LINEARITY IS ENFORCED, NOT DESCRIBED. Every fee declares its base in
 *      FUND_FEE_SPECS, every declared base must be in LINEAR_FEE_BASES, and no
 *      base may be one of the CIRCULAR_FEE_BASES. This is the assertion that
 *      stops Step 3 charging a fee on closing NAV or on the funding requirement
 *      and dragging the fund layer into the M4 circular solve. It fails on the
 *      REGISTRY, so it catches a bad fee added to the data as well as one added
 *      to the UI.
 *   2. NAV FEES CHARGE ON OPENING NAV. Spelled out as its own check because
 *      "opening versus closing" is one word in a spec and an entire circular
 *      dependency in an engine.
 *   3. NOTHING TRUSTS ITS INPUT. These values drive money from Step 3, so a NaN
 *      rate, a 300% fee, a negative amount, a share for a party that does not
 *      exist, or a matrix row with no party id must be coerced at the boundary.
 *   4. THE TWO STORES AGREE, and the migration-208 columns that were RETIRED
 *      still resolve, so a row a user already saved keeps its values.
 *   5. THE MATRIX IS PER PARTY, keyed on partyId with the name snapshotted,
 *      which is what stops a rename or a deletion blanking a saved row.
 *   6. THE TOGGLE STILL DEFAULTS OFF with the full extended terms present,
 *      which is Step 1's contract surviving the rebuild.
 *
 * Storage rules for migration 209 are asserted against the MIGRATION TEXT
 * because it is not applied yet. Those checks prove the SQL says what it should;
 * they do not prove the database enforces it. The migration ends with the five
 * behavioural probes to run after applying, which is what proves teeth.
 *
 * Pure and offline: no database, no React, no DOM.
 *
 * Run: npx tsx scripts/verify-fund-terms.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FUND_FEE_SPECS, LINEAR_FEE_BASES, CIRCULAR_FEE_BASES, FEE_BASE_LABELS, FEE_BASE_HELP,
  FEE_TIMING_LABELS, FEE_DISTRIBUTION_COLUMNS, LEGACY_FEE_BASES, DEFAULT_FUND_TERMS,
  resolveFundTerms, isFundLayerActive, coerceFeeBase, sanitizeFeeShares, sanitizeFeeDistribution,
  feeColumnTotal, feeColumnBalanced, feeShareTotal, feeSharesBalanced,
  toFundTermsPatch, fromRow, toRow, toLegacyRow,
  FUND_MANAGER_ROW_ID, DEFAULT_FUND_MANAGER_NAME, isFundManagerRow, resolveFeeEarners,
} from '../src/hubs/modeling/platforms/refm/lib/fundTerms';
import { resolveFacilityLimit } from '../src/hubs/modeling/platforms/refm/lib/fundFees';
import { PARTY_ROLES } from '../src/hubs/modeling/platforms/refm/lib/parties';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

const root = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const sql208 = read('supabase/migrations/208_refm_fund_terms.sql');
const sql209 = read('supabase/migrations/209_refm_fund_terms_extended.sql');

console.log('=== 1. Linearity is enforced by the registry ===');
{
  check('there are five fund management fees', FUND_FEE_SPECS.length === 5);
  check('every fee declares a timing', FUND_FEE_SPECS.every((f) => f.timing === 'one_time' || f.timing === 'annual'));
  check('every fee declares a base', FUND_FEE_SPECS.every((f) => !!f.base));

  // THE assertion. A fee whose base is not linear would put the fund layer in
  // the circular block, so the registry itself is the gate.
  check('EVERY fee base is in the linear set',
    FUND_FEE_SPECS.every((f) => (LINEAR_FEE_BASES as readonly string[]).includes(f.base)),
    FUND_FEE_SPECS.map((f) => `${f.key}:${f.base}`).join(' '));
  check('NO fee base is a circular one',
    FUND_FEE_SPECS.every((f) => !(CIRCULAR_FEE_BASES as readonly string[]).includes(f.base as never)));
  check('the linear and circular sets do not overlap',
    !(LINEAR_FEE_BASES as readonly string[]).some((b) => (CIRCULAR_FEE_BASES as readonly string[]).includes(b as never)));
  check('the circular set names the traps explicitly',
    ['closing_nav', 'average_nav', 'funding_requirement', 'fund_size_solved']
      .every((b) => (CIRCULAR_FEE_BASES as readonly string[]).includes(b as never)));

  check('every base has a label', LINEAR_FEE_BASES.every((b) => !!FEE_BASE_LABELS[b]));
  check('every base has help text', LINEAR_FEE_BASES.every((b) => !!FEE_BASE_HELP[b]));
  check('every timing has a label', !!FEE_TIMING_LABELS.one_time && !!FEE_TIMING_LABELS.annual);
  check('fee keys are unique', new Set(FUND_FEE_SPECS.map((f) => f.key)).size === FUND_FEE_SPECS.length);
  check('every fee key exists on the resolved terms',
    FUND_FEE_SPECS.every((f) => f.key in DEFAULT_FUND_TERMS));
}

console.log('\n=== 2. The five fees, each on the base it should be ===');
{
  const spec = (k: string) => FUND_FEE_SPECS.find((f) => f.key === k);
  check('fund structure fee is ONE TIME on fund size',
    spec('fundStructureFeePct')?.timing === 'one_time' && spec('fundStructureFeePct')?.base === 'fund_size');
  // CHANGED 2026-08-10: the two annual fees moved from OPENING NAV to FUND
  // SIZE. The model this platform mirrors sizes a fund by its total debt and
  // equity funding over the whole period, not by a net-asset balance that moves
  // every year, and a NAV-based fee could not be reconciled against the fund
  // size at all. Fund size is a constant resolved in the fee-free pass, so the
  // freeze is unchanged.
  check('fund management fee is ANNUAL on TOTAL EQUITY',
    spec('fundManagementFeePct')?.timing === 'annual' && spec('fundManagementFeePct')?.base === 'total_equity');
  check('custody and admin fee is ANNUAL on TOTAL EQUITY',
    spec('custodyAdminFeePct')?.timing === 'annual' && spec('custodyAdminFeePct')?.base === 'total_equity');
  check('NO fee charges on opening NAV any more',
    FUND_FEE_SPECS.every((f) => f.base !== 'opening_nav'));
  // THREE DISTINCT capital bases, matching the reference. An earlier version of
  // this check asserted they shared ONE base, which was the over-collapsed
  // design this replaced; it is inverted deliberately.
  check('the capital fees use THREE DISTINCT bases, not one',
    spec('fundStructureFeePct')?.base === 'fund_size'
    && spec('fundManagementFeePct')?.base === 'total_equity'
    && spec('debtArrangingFeePct')?.base === 'debt_facility');
  check('and fund size is the only base used by more than nothing else',
    FUND_FEE_SPECS.filter((f) => f.base === 'fund_size').length === 1
    && FUND_FEE_SPECS.filter((f) => f.base === 'total_equity').length === 2
    && FUND_FEE_SPECS.filter((f) => f.base === 'debt_facility').length === 1);
  // Moved off the facility LIMIT 2026-08-10: on the reference project the limit
  // resolves from an LTV cap to 4,273.8m against 2,834.1m actually raised, so
  // the fee would have charged on a ceiling the fund never drew.
  check('debt arranging fee is ONE TIME on the DEBT FACILITY (total raised)',
    spec('debtArrangingFeePct')?.timing === 'one_time' && spec('debtArrangingFeePct')?.base === 'debt_facility');
  check('other expenses is ANNUAL and a flat amount',
    spec('otherExpensesPerAnnum')?.timing === 'annual' && spec('otherExpensesPerAnnum')?.base === 'flat_amount'
    && spec('otherExpensesPerAnnum')?.kind === 'amount');
  check('every other fee is a rate, not an amount',
    FUND_FEE_SPECS.filter((f) => f.key !== 'otherExpensesPerAnnum').every((f) => f.kind === 'rate'));

  // Opening versus closing is one word in a spec and a circular dependency in
  // an engine, so it gets its own check.
  check('NAV fees say OPENING, never closing or average',
    FUND_FEE_SPECS.filter((f) => f.base.includes('nav')).every((f) => f.base === 'opening_nav'));
  // `opening_nav` stays a LEGAL base kind (it is linear and correctly
  // implemented) even though no fee uses it now, so the rule above still has
  // something to bite on if a future fee reaches for it.
  check('opening NAV remains a legal, linear base kind', (LINEAR_FEE_BASES as readonly string[]).includes('opening_nav'));
  check('the annual fee help names the fund size base',
    FUND_FEE_SPECS.filter((f) => f.timing === 'annual' && f.base === 'fund_size')
      .every((f) => /fund size/i.test(f.help)));
  check('the fund size base names the model figure AND the freeze',
    /total equity plus the debt facility/i.test(FEE_BASE_HELP.fund_size) && /frozen/i.test(FEE_BASE_HELP.fund_size));
  check('and offers the target override', /override/i.test(FEE_BASE_HELP.fund_size));
  check('the facility base is the LIMIT, not the drawn balance', /not the drawn balance/i.test(FEE_BASE_HELP.facility_limit));
}

console.log('\n=== 3. Nothing trusts its input ===');
{
  const r = (ft: any) => resolveFundTerms({ fundTerms: ft } as any);
  check('a NaN rate resolves to 0', r({ fundManagementFeePct: NaN }).fundManagementFeePct === 0);
  check('a string rate is read as a number', r({ fundManagementFeePct: '0.02' }).fundManagementFeePct === 0.02);
  check('a rate above 100% clamps to 1', r({ custodyAdminFeePct: 3 }).custodyAdminFeePct === 1);
  check('a negative rate clamps to 0', r({ debtArrangingFeePct: -0.5 }).debtArrangingFeePct === 0);
  check('a 300% performance fee clamps to 1', r({ performanceFeePct: 3 }).performanceFeePct === 1);
  check('a negative hurdle clamps to 0', r({ hurdleRatePct: -1 }).hurdleRatePct === 0);
  check('negative fund size clamps to 0', r({ fundSize: -5 }).fundSize === 0);
  check('negative facility limit clamps to 0', r({ facilityLimit: -5 }).facilityLimit === 0);
  check('negative other expenses clamps to 0', r({ otherExpensesPerAnnum: -1 }).otherExpensesPerAnnum === 0);
  check('amounts are NOT capped at 1 (they are money, not rates)',
    r({ fundSize: 500_000_000, otherExpensesPerAnnum: 1_500_000 }).fundSize === 500_000_000);
  check('Infinity resolves to 0', r({ fundSize: Infinity }).fundSize === 0);

  // performanceFeePct and carryPct are the same number under two names.
  check('carryPct alone resolves the performance fee', r({ carryPct: 0.2 }).performanceFeePct === 0.2);
  check('performanceFeePct wins when both are present', r({ carryPct: 0.1, performanceFeePct: 0.2 }).performanceFeePct === 0.2);
  check('the patch writes BOTH names', (() => {
    const p = toFundTermsPatch(r({ performanceFeePct: 0.2 })) as any;
    return p.performanceFeePct === 0.2 && p.carryPct === 0.2;
  })());
}

console.log('\n=== 4. The distribution matrix is per PARTY ===');
{
  check('three fee-type columns', FEE_DISTRIBUTION_COLUMNS.length === 3);
  check('the columns are Performance Fee, Developer Fee, Commission',
    FEE_DISTRIBUTION_COLUMNS.map((c) => c.label).join('|') === 'Performance Fee|Developer Fee|Commission');
  check('column keys are unique', new Set(FEE_DISTRIBUTION_COLUMNS.map((c) => c.key)).size === 3);

  const rows = sanitizeFeeDistribution([
    { partyId: 'p1', partyName: 'Sponsor Co', performanceFeePct: 0.6, developerFeePct: 1, commissionPct: 0.5 },
    { partyId: 'p2', partyName: 'JV Partner', performanceFeePct: 0.4, developerFeePct: 0, commissionPct: 0.5 },
  ]);
  check('rows keep the party id', rows[0].partyId === 'p1');
  check('rows SNAPSHOT the party name', rows[0].partyName === 'Sponsor Co');
  check('a row with no party id is dropped', sanitizeFeeDistribution([{ partyName: 'Ghost', performanceFeePct: 1 }]).length === 0);
  check('duplicate party ids collapse to the last', (() => {
    const d = sanitizeFeeDistribution([{ partyId: 'p1', performanceFeePct: 0.2 }, { partyId: 'p1', performanceFeePct: 0.7 }]);
    return d.length === 1 && d[0].performanceFeePct === 0.7;
  })());
  check('a missing name becomes empty, not undefined', sanitizeFeeDistribution([{ partyId: 'p1' }])[0].partyName === '');
  check('cells clamp to 0..1', sanitizeFeeDistribution([{ partyId: 'p1', commissionPct: 9 }])[0].commissionPct === 1);
  check('a NaN cell resolves to 0', sanitizeFeeDistribution([{ partyId: 'p1', developerFeePct: NaN }])[0].developerFeePct === 0);
  check('non-array input is dropped', sanitizeFeeDistribution('p1').length === 0);
  check('junk entries are skipped', sanitizeFeeDistribution([null, 7, { partyId: 'p1' }]).length === 1);

  // Column totals are REPORTED, not enforced: a half-entered split is a normal
  // intermediate state, so the tab warns rather than refusing to save.
  check('a full column totals 1', Math.abs(feeColumnTotal(rows, 'performanceFeePct') - 1) < 1e-9);
  check('a balanced column is balanced', feeColumnBalanced(rows, 'performanceFeePct'));
  // An untouched column has nothing to reconcile, so it must NOT nag. Written
  // against its own all-zero data: the earlier `rows` fixture has a fully
  // allocated developer column, so reusing it here would have asserted nothing.
  const untouched = [
    { partyId: 'a', partyName: 'A', performanceFeePct: 0.5, developerFeePct: 0, commissionPct: 0 },
    { partyId: 'b', partyName: 'B', performanceFeePct: 0.5, developerFeePct: 0, commissionPct: 0 },
  ];
  check('an all-zero column counts as balanced (nothing to reconcile)', feeColumnBalanced(untouched, 'developerFeePct'));
  check('an all-zero column totals zero', feeColumnTotal(untouched, 'developerFeePct') === 0);
  check('a sibling column in the same matrix still reconciles', feeColumnBalanced(untouched, 'performanceFeePct'));
  check('an empty matrix is balanced', feeColumnBalanced([], 'commissionPct'));
  check('a 90% column is NOT balanced',
    !feeColumnBalanced([{ partyId: 'a', partyName: 'A', performanceFeePct: 0.9, developerFeePct: 0, commissionPct: 0 }], 'performanceFeePct'));
  check('a 100% single-party column IS balanced',
    feeColumnBalanced([{ partyId: 'a', partyName: 'A', performanceFeePct: 1, developerFeePct: 0, commissionPct: 0 }], 'performanceFeePct'));
  check('each column totals independently',
    Math.abs(feeColumnTotal(rows, 'developerFeePct') - 1) < 1e-9 && Math.abs(feeColumnTotal(rows, 'commissionPct') - 1) < 1e-9);
}

console.log('\n=== 4b. The Fund Manager is an earner, not a party ===');
{
  check('the reserved row id is not a uuid, so it cannot collide with a party',
    !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(FUND_MANAGER_ROW_ID) && FUND_MANAGER_ROW_ID === '__fund_manager__');
  check('the predicate recognises the manager row', isFundManagerRow({ partyId: FUND_MANAGER_ROW_ID }));
  check('the predicate rejects a party row', !isFundManagerRow({ partyId: 'some-party-uuid' }));
  check('the predicate tolerates junk', !isFundManagerRow(null) && !isFundManagerRow(undefined) && !isFundManagerRow({}));
  check('the default name is set', DEFAULT_FUND_TERMS.fundManagerName === DEFAULT_FUND_MANAGER_NAME);
  check('a blank stored name falls back to the default',
    resolveFundTerms({ fundTerms: { fundManagerName: '   ' } } as any).fundManagerName === DEFAULT_FUND_MANAGER_NAME);
  check('a real stored name is kept and trimmed',
    resolveFundTerms({ fundTerms: { fundManagerName: '  Acme Managers  ' } } as any).fundManagerName === 'Acme Managers');

  // The manager's row lives in the SAME matrix as the parties, so the matrix
  // stays one uniform structure rather than a special case bolted on.
  const withManager = resolveFundTerms({ fundTerms: {
    enabled: true, fundManagerName: 'Acme',
    feeDistribution: [
      { partyId: FUND_MANAGER_ROW_ID, partyName: 'Acme', performanceFeePct: 0.2, developerFeePct: 0, commissionPct: 0 },
      { partyId: 'p1', partyName: 'Sponsor', performanceFeePct: 0.8, developerFeePct: 1, commissionPct: 1 },
    ],
  } } as any);
  check('the manager row survives sanitisation', withManager.feeDistribution.some(isFundManagerRow));
  check('the manager row counts toward the column total',
    Math.abs(feeColumnTotal(withManager.feeDistribution, 'performanceFeePct') - 1) < 1e-9);
  check('a column including the manager can balance', feeColumnBalanced(withManager.feeDistribution, 'performanceFeePct'));

  // resolveFeeEarners is the contract Step 5 consumes.
  const earners = resolveFeeEarners(withManager);
  check('the Fund Manager is ALWAYS the first earner', earners[0].kind === 'fund_manager');
  check('the Fund Manager takes 100% of the management fees', earners[0].managementFeeShare === 1);
  check('no party takes any management fee',
    earners.filter((e) => e.kind === 'party').every((e) => e.managementFeeShare === 0));
  check('the Fund Manager carries its matrix share of the performance fee', earners[0].performanceFeePct === 0.2);
  check('a party earner carries its own matrix shares',
    earners[1].entityId === 'p1' && earners[1].performanceFeePct === 0.8 && earners[1].commissionPct === 1);
  check('every earner has a stable id and a name', earners.every((e) => !!e.entityId && typeof e.name === 'string'));
  check('the management-fee shares sum to exactly 1 across all earners',
    Math.abs(earners.reduce((s, e) => s + e.managementFeeShare, 0) - 1) < 1e-12);

  // The manager exists even with an empty matrix, because it earns the
  // management fees whether or not anyone has split the performance fee.
  const noMatrix = resolveFeeEarners(resolveFundTerms({ fundTerms: { enabled: true, fundManagerName: 'Solo' } } as any));
  check('the Fund Manager is present with an EMPTY matrix', noMatrix.length === 1 && noMatrix[0].kind === 'fund_manager');
  check('and still takes the management fees', noMatrix[0].managementFeeShare === 1);
  check('and takes no performance fee it was not given', noMatrix[0].performanceFeePct === 0);

  // It must NOT be shaped like an M5 equity partner: it contributes no equity,
  // so a zero-equity PartnerInput would give it a 0% shareholding and an
  // undefined IRR, and would break Sigma partners == consolidated.
  check('the earner shape carries no equity contribution fields',
    !('cashContribution' in earners[0]) && !('inKindContribution' in earners[0]) && !('manualShareholdingPct' in earners[0]));
}

console.log('\n=== 4c. Facility limit is read from the model, never from drawn debt ===');
{
  const cap = 100_000_000;
  const stated = resolveFacilityLimit({ tranches: [{ principal: 250_000_000 }, { principal: 50_000_000 }], capexTotal: cap, manualLimit: 9, override: false });
  check('stated principal is summed across tranches', stated.amount === 300_000_000);
  check('stated principal is reported as the source', stated.source === 'stated_principal');
  check('stated principal beats the typed figure', stated.amount !== 9);

  const ltv = resolveFacilityLimit({ tranches: [{ ltvPct: 60 }], capexTotal: cap, manualLimit: 9, override: false });
  check('the LTV cap is ltvPct x capex', ltv.amount === 60_000_000);
  check('the LTV cap is reported as the source', ltv.source === 'ltv_cap');
  check('the LTV explanation says it is NOT the drawn balance', /not the drawn balance/i.test(ltv.explanation));

  const manual = resolveFacilityLimit({ tranches: [], capexTotal: cap, manualLimit: 42, override: false });
  check('with no stated limit the typed figure is used', manual.amount === 42 && manual.source === 'manual');
  const none = resolveFacilityLimit({ tranches: [], capexTotal: cap, manualLimit: 0, override: false });
  check('with nothing at all the limit is zero', none.amount === 0 && none.source === 'none');

  const pinned = resolveFacilityLimit({ tranches: [{ principal: 250_000_000 }], capexTotal: cap, manualLimit: 7, override: true });
  check('the override wins over a stated principal', pinned.amount === 7 && pinned.source === 'manual');

  // The UI path: no capex available, so the SOURCE is reported without an
  // amount rather than the tab re-deriving capex and drifting from the engine.
  const uiLtv = resolveFacilityLimit({ tranches: [{ ltvPct: 60 }], capexTotal: null, manualLimit: 0, override: false });
  check('with no capex the LTV source is still identified', uiLtv.source === 'ltv_cap');
  check('and it reports that the amount is not known here', uiLtv.amountKnown === false);
  check('every other resolution DOES know its amount',
    stated.amountKnown && ltv.amountKnown && manual.amountKnown && none.amountKnown && pinned.amountKnown);

  check('negative or junk tranche values are ignored',
    resolveFacilityLimit({ tranches: [{ principal: -5 }, { ltvPct: -10 }], capexTotal: cap, manualLimit: 0, override: false }).source === 'none');
  check('a negative typed figure clamps to zero',
    resolveFacilityLimit({ tranches: [], capexTotal: cap, manualLimit: -5, override: true }).amount === 0);

  // The whole point: no code path reads a drawn balance.
  const feesSrc = read('src/hubs/modeling/platforms/refm/lib/fundFees.ts');
  const feesCode = feesSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('the fee layer never reads outstanding or drawSchedule', !/outstanding|drawSchedule/.test(feesCode));
}

console.log('\n=== 4d. Fund size stays a typed input, on purpose ===');
{
  // Reading fund size from the model would be circular: fund size is equity
  // plus debt, debt is solved by the funding requirement, and the fees raise
  // that requirement. The tab has to SAY so rather than looking like an
  // oversight a later step should "fix".
  const spec = FUND_FEE_SPECS.find((f) => f.key === 'fundStructureFeePct')!;
  check('the structure fee still charges on fund_size', spec.base === 'fund_size');
  check('fund_size is a linear base', (LINEAR_FEE_BASES as readonly string[]).includes('fund_size'));
  check('the SOLVED variant is explicitly forbidden', (CIRCULAR_FEE_BASES as readonly string[]).includes('fund_size_solved' as never));

  const tab = read('src/hubs/modeling/platforms/refm/components/modules/Module1FundTerms.tsx');
  check('the tab explains what the model figure IS', /total equity plus total debt/i.test(tab));
  check('the tab says the figure is frozen before the solve',
    /frozen/i.test(tab) && /changing its own base/i.test(tab));
  check('the tab offers the target-fund-size override',
    /fund-terms-fund-size-override/.test(tab) && /State a target fund size myself/.test(tab));
}

console.log('\n=== 5. The two stores agree, and retired columns still resolve ===');
{
  const terms = {
    ...DEFAULT_FUND_TERMS,
    enabled: true,
    fundSize: 500_000_000, facilityLimit: 300_000_000,
    fundStructureFeePct: 0.01, fundManagementFeePct: 0.02, custodyAdminFeePct: 0.0025,
    debtArrangingFeePct: 0.0075, otherExpensesPerAnnum: 1_500_000,
    performanceFeePct: 0.2, hurdleRatePct: 0.08,
    feeDistribution: [{ partyId: 'p1', partyName: 'Sponsor Co', performanceFeePct: 1, developerFeePct: 1, commissionPct: 1 }],
    managementFeePct: 0.015, feeBase: 'total_development_cost' as const, committedCapital: 250_000_000,
    feeShares: [{ role: 'Sponsor', sharePct: 1 }],
  };
  check('terms survive the FULL row round trip', JSON.stringify(fromRow(toRow(terms) as any)) === JSON.stringify(terms));
  check('terms survive the snapshot round trip',
    JSON.stringify(resolveFundTerms({ fundTerms: toFundTermsPatch(terms) } as any)) === JSON.stringify(terms));
  check('row and snapshot resolve identically',
    JSON.stringify(fromRow(toRow(terms) as any)) === JSON.stringify(resolveFundTerms({ fundTerms: toFundTermsPatch(terms) } as any)));

  // The migration-208 subset, used when 209 is not applied. The extended fields
  // do not persist to the table but still ride in the snapshot.
  const legacy = toLegacyRow(terms);
  check('the legacy row carries only the 208 columns', Object.keys(legacy).length === 7);
  check('the legacy row still carries the performance fee as carry_pct', legacy.carry_pct === 0.2);
  check('a legacy row read back keeps its 208 values',
    fromRow(legacy).performanceFeePct === 0.2 && fromRow(legacy).hurdleRatePct === 0.08 && fromRow(legacy).managementFeePct === 0.015);
  check('a legacy row read back zeroes the un-storable fields (they live in the snapshot)',
    fromRow(legacy).fundSize === 0 && fromRow(legacy).feeDistribution.length === 0);

  // Retired but retained: an existing row keeps its values.
  check('the retired fee base still resolves', coerceFeeBase('total_development_cost') === 'total_development_cost');
  check('an unknown fee base still coerces safely', coerceFeeBase('fund_size') === 'committed_capital');
  check('the retired legacy base enum still has two values', LEGACY_FEE_BASES.length === 2);
  check('the retired role shares still resolve', sanitizeFeeShares([{ role: 'Sponsor', sharePct: 0.5 }]).length === 1);
  check('the retired role shares still reject unknown roles', sanitizeFeeShares([{ role: 'Chef', sharePct: 1 }]).length === 0);
  check('every party role is still accepted by the legacy helper',
    PARTY_ROLES.every((role) => sanitizeFeeShares([{ role, sharePct: 0.1 }]).length === 1));
  check('the legacy share total still reports', Math.abs(feeShareTotal([{ role: 'Sponsor', sharePct: 0.6 }]) - 0.6) < 1e-9);
  check('the legacy balance helper still works', feeSharesBalanced([{ role: 'Sponsor', sharePct: 1 }]));

  const serverFile = read('src/hubs/modeling/platforms/refm/lib/persistence/fundTerms-server.ts');
  const baseCols = /const COLS_BASE = '([^']+)'/.exec(serverFile)?.[1].split(',').map((c) => c.trim()) ?? [];
  const extCols = /const COLS_209 = '([^']+)'/.exec(serverFile)?.[1].split(',').map((c) => c.trim()) ?? [];
  check('the server names the 208 column set', baseCols.length === 7);
  check('the server names the 209 column set', extCols.length === 8);
  check('every 208 column exists in migration 208', baseCols.every((c) => new RegExp(`^\\s*${c}\\s`, 'm').test(sql208)));
  check('every 209 column is added by migration 209', extCols.every((c) => new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`).test(sql209)), extCols.join(','));
  // The fallback is now a three-tier walk (210 -> 209 -> 208), because the
  // Fund Manager columns can lag exactly as the 209 columns did.
  // 2026-08-18f: five tiers, 215 (fee funding) above 211.
  check('the server knows five schema tiers', /type SchemaTier = 208 \| 209 \| 210 \| 211 \| 215/.test(serverFile));
  check('it walks them highest first', /TIERS: SchemaTier\[\] = \[215, 211, 210, 209, 208\]/.test(serverFile));
  check('it recognises the 215 column as steppable', /management_fee_funding/.test(serverFile));
  check('it recognises the 211 column as steppable', /fund_size_override/.test(serverFile));
  check('it has a row shape for every tier',
    /toRow\(t\)/.test(serverFile) && /toRow209\(t\)/.test(serverFile) && /toLegacyRow\(t\)/.test(serverFile));
  check('it steps down on a missing COLUMN rather than failing', /isMissingColumn/.test(serverFile));
  check('it recognises the 210 columns as steppable',
    /fund_manager_name\|facility_limit_override/.test(serverFile));
}

console.log('\n=== 6. Step 1 contract survives the rebuild ===');
{
  check('the default is still off', DEFAULT_FUND_TERMS.enabled === false);
  check('absent fund terms still resolve off', resolveFundTerms({} as any).enabled === false);
  check('a fully populated extended block with enabled false is OFF',
    isFundLayerActive({ fundTerms: {
      enabled: false, fundSize: 5e8, fundManagementFeePct: 0.02, performanceFeePct: 0.2, hurdleRatePct: 0.08,
      feeDistribution: [{ partyId: 'p1', partyName: 'A', performanceFeePct: 1, developerFeePct: 1, commissionPct: 1 }],
    } } as any) === false);
  check('a truthy non-boolean still does not enable', isFundLayerActive({ fundTerms: { enabled: 'yes' } } as any) === false);
  check('a non-object still does not enable', isFundLayerActive({ fundTerms: true } as any) === false);
  check('a populated block with enabled true IS on', isFundLayerActive({ fundTerms: { enabled: true } } as any) === true);
  check('the defaults carry no fee at all',
    DEFAULT_FUND_TERMS.fundManagementFeePct === 0 && DEFAULT_FUND_TERMS.performanceFeePct === 0
    && DEFAULT_FUND_TERMS.hurdleRatePct === 0 && DEFAULT_FUND_TERMS.otherExpensesPerAnnum === 0);
  check('the defaults carry no distribution', DEFAULT_FUND_TERMS.feeDistribution.length === 0);
  const mutated = resolveFundTerms({} as any); mutated.enabled = true; mutated.feeDistribution.push({ partyId: 'x', partyName: 'x', performanceFeePct: 1, developerFeePct: 0, commissionPct: 0 });
  check('the resolver returns a fresh object and a fresh matrix each time',
    DEFAULT_FUND_TERMS.enabled === false && DEFAULT_FUND_TERMS.feeDistribution.length === 0
    && resolveFundTerms({} as any).feeDistribution.length === 0);
}

console.log('\n=== 7. Migration 209 is additive and safe ===');
{
  // Anchored to line starts, so the two PROSE mentions of the phrase (the
  // header rationale and the DO-block note) are not counted as statements.
  const addStatements = sql209.match(/^\s*ADD COLUMN IF NOT EXISTS \w+/gm) ?? [];
  check('exactly eight ADD COLUMN statements, one per new column', addStatements.length === 8, `found ${addStatements.length}`);
  check('every ALTER in the file is an additive ADD COLUMN or ADD CONSTRAINT',
    (sql209.match(/^\s*ALTER TABLE refm_fund_terms\s*$/gm) ?? []).length + (sql209.match(/ALTER TABLE refm_fund_terms ADD CONSTRAINT/g) ?? []).length >= 8);
  check('it drops nothing', !/\bDROP\b/i.test(sql209));
  check('it renames nothing', !/\bRENAME\b/i.test(sql209));
  check('it touches no other table', !/ALTER TABLE (?!refm_fund_terms)/.test(sql209));
  check('it is transactional', /^BEGIN;/m.test(sql209) && /^COMMIT;/m.test(sql209));
  check('rate constraints are added only if absent', /pg_constraint WHERE conname = 'refm_fund_terms_rates_0_1'/.test(sql209));
  check('amount constraints are added only if absent', /pg_constraint WHERE conname = 'refm_fund_terms_amounts_non_negative'/.test(sql209));
  check('the new rates are constrained to 0..1', /fund_management_fee_pct >= 0 AND fund_management_fee_pct <= 1/.test(sql209));
  check('the new amounts cannot be negative', /fund_size >= 0 AND facility_limit >= 0 AND other_expenses_per_annum >= 0/.test(sql209));
  check('fee_distribution defaults to an empty array', /fee_distribution jsonb NOT NULL DEFAULT '\[\]'::jsonb/.test(sql209));
  check('it documents the opening-NAV rule on the column itself', /OPENING \(beginning of period\) NAV/.test(sql209));
  check('it documents that fund size is an input, never a solved output', /never a solved output/.test(sql209));
  check('it documents the post-apply behavioural probes', /must FAIL with 23514/.test(sql209) && /no-op/.test(sql209));
  check('it explains which 208 columns are retired but kept', /RETIRES BUT KEEPS/.test(sql209));
}

console.log('\n=== 8. The tab is wired, and honest about doing nothing yet ===');
{
  const shell = read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  const tab = read('src/hubs/modeling/platforms/refm/components/modules/Module1FundTerms.tsx');

  check('the tab is registered in m1Tabs', /key: 'fund-terms'/.test(shell));
  check('the tab renders in the M1 branch', /activeTab === 'fund-terms' && <Module1FundTerms/.test(shell));

  check('the fee rows render FROM the registry, not hand-written per fee', /FUND_FEE_SPECS\.map/.test(tab));
  check('each fee row shows its timing', /FEE_TIMING_LABELS\[spec\.timing\]/.test(tab));
  check('each fee row shows its base', /FEE_BASE_LABELS\[spec\.base\]/.test(tab));
  check('the matrix rows come from the LIVE parties', /listParties\(/.test(tab) && /parties\.map/.test(tab));
  check('the matrix columns come from the registry', /FEE_DISTRIBUTION_COLUMNS\.map/.test(tab));
  check('each column shows a live total', /feeColumnTotal\(/.test(tab) && /feeColumnBalanced\(/.test(tab));
  check('a saved cell keys on partyId', /partyId: p\.id/.test(tab));
  check('a saved cell snapshots partyName', /partyName: p\.name/.test(tab));
  check('shares for deleted parties are surfaced, not silently dropped', /fund-terms-orphans/.test(tab));
  check('the tab writes the snapshot copy the engine will read', /setProject\(\{ fundTerms:/.test(tab));
  check('the tab also writes the durable row', /saveFundTerms\(/.test(tab));
  // CHANGED 2026-08-10. The tab used to say the terms did not yet flow into the
  // model, which was true at Step 2 and false from Step 3 onwards. It must now
  // say the opposite, and must NOT carry the old wording.
  check('the tab says the terms DO drive the model when the toggle is on', /these terms drive the model/i.test(tab));
  check('the stale "do not yet flow" claim is gone', !/do not yet flow into the model/.test(tab));
  check('the tab points the user at saving a version to carry the terms', /save a new version/i.test(tab));
  check('the tab keeps the fields editable with the toggle OFF', /takes effect only when you switch the toggle on/.test(tab));
  check('the tab degrades when migration 208 is absent', /fund-terms-migration-notice/.test(tab));
  check('the tab degrades when migration 209 is absent', /fund-terms-extended-notice/.test(tab));

  const route = read('app/api/refm/projects/[id]/fund-terms/route.ts');
  check('the route re-validates through the shared resolver', /resolveFundTerms\(/.test(route));
  check('the route enforces ownership', /requireOwnedProject/.test(route));
  check('writes pass the read-only grace gate', /writeBlockReason/.test(route));
  check('the route reports the 209 fallback state', /extended/.test(route));
}

console.log('\n=== 9. House style ===');
{
  const emDash = new RegExp('[\\u2014\\u2015]');
  for (const p of [
    'src/hubs/modeling/platforms/refm/lib/fundTerms.ts',
    'src/hubs/modeling/platforms/refm/lib/persistence/fundTerms-server.ts',
    'src/hubs/modeling/platforms/refm/components/modules/Module1FundTerms.tsx',
    'app/api/refm/projects/[id]/fund-terms/route.ts',
    'supabase/migrations/209_refm_fund_terms_extended.sql',
    'scripts/verify-fund-terms.ts',
  ]) check(`no em dash in ${p.split('/').pop()}`, !emDash.test(read(p)));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
