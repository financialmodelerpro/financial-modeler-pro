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
} from '../src/hubs/modeling/platforms/refm/lib/fundTerms';
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
  check('fund management fee is ANNUAL on OPENING NAV',
    spec('fundManagementFeePct')?.timing === 'annual' && spec('fundManagementFeePct')?.base === 'opening_nav');
  check('custody and admin fee is ANNUAL on OPENING NAV',
    spec('custodyAdminFeePct')?.timing === 'annual' && spec('custodyAdminFeePct')?.base === 'opening_nav');
  check('debt arranging fee is ONE TIME on the facility limit',
    spec('debtArrangingFeePct')?.timing === 'one_time' && spec('debtArrangingFeePct')?.base === 'facility_limit');
  check('other expenses is ANNUAL and a flat amount',
    spec('otherExpensesPerAnnum')?.timing === 'annual' && spec('otherExpensesPerAnnum')?.base === 'flat_amount'
    && spec('otherExpensesPerAnnum')?.kind === 'amount');
  check('every other fee is a rate, not an amount',
    FUND_FEE_SPECS.filter((f) => f.key !== 'otherExpensesPerAnnum').every((f) => f.kind === 'rate'));

  // Opening versus closing is one word in a spec and a circular dependency in
  // an engine, so it gets its own check.
  check('NAV fees say OPENING, never closing or average',
    FUND_FEE_SPECS.filter((f) => f.base.includes('nav')).every((f) => f.base === 'opening_nav'));
  check('the opening-NAV help says START of the year', /start of that year/i.test(FUND_FEE_SPECS.find((f) => f.base === 'opening_nav')?.help ?? ''));
  check('the fund size base is described as an input, not a result', /target or committed/i.test(FEE_BASE_HELP.fund_size));
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
  check('the server falls back rather than failing when 209 is absent', /extendedApplied = false/.test(serverFile) && /toLegacyRow/.test(serverFile));
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
  check('the tab says the terms do not flow into the model yet', /do not yet flow into the model/.test(tab));
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
