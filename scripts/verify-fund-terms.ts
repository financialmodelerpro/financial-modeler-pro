/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * verify-fund-terms.ts (fund layer Step 2: the M1 Fund Terms tab and its storage)
 *
 * Step 2 is inputs only, so the things worth pinning are the ones that would
 * quietly corrupt money later:
 *
 *   1. THE FEE BASE ENUM HAS EXACTLY TWO LINEAR OPTIONS. Fund size is circular
 *      (the fee raises funding, funding raises fund size, fund size raises the
 *      fee) and is deferred to v1.1. It must be absent from the type, absent
 *      from the migration CHECK, and actively REJECTED if it arrives from a
 *      future build or a hand-edited row, rather than silently honoured.
 *   2. NOTHING TRUSTS ITS INPUT. These values drive money from Step 3, so a
 *      NaN fee, a 300% carry, a negative committed capital or an unknown party
 *      role must be coerced at the boundary, not stored.
 *   3. THE TWO STORES AGREE. The row shape and the snapshot shape round-trip
 *      through one another without drift, because the tab writes both and the
 *      engine will read only the snapshot.
 *   4. THE TOGGLE STILL DEFAULTS OFF with the full terms present, which is
 *      Step 1's contract surviving Step 2.
 *
 * Storage rules are asserted against the MIGRATION TEXT because the table is
 * not applied yet. Those checks prove the SQL says what it should; they do not
 * prove the database enforces it. The migration ends with the four behavioural
 * probes to run after applying (bad enum, out-of-range fee, duplicate project,
 * cascade delete), which is what actually proves the constraints have teeth.
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
  FEE_BASES, FEE_BASE_LABELS, FEE_BASE_HELP, DEFAULT_FUND_TERMS,
  resolveFundTerms, isFundLayerActive, coerceFeeBase, sanitizeFeeShares,
  feeShareTotal, feeSharesBalanced, toFundTermsPatch, fromRow, toRow,
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
const sql = read('supabase/migrations/208_refm_fund_terms.sql');

console.log('=== 1. Fee base: two linear options, fund size deliberately absent ===');
{
  check('exactly two fee bases', FEE_BASES.length === 2);
  check('committed capital is one', (FEE_BASES as readonly string[]).includes('committed_capital'));
  check('total development cost is the other', (FEE_BASES as readonly string[]).includes('total_development_cost'));
  check('fund size is NOT an option', !(FEE_BASES as readonly string[]).includes('fund_size'));
  check('every base has a label', FEE_BASES.every((b) => !!FEE_BASE_LABELS[b]));
  check('every base has help text', FEE_BASES.every((b) => !!FEE_BASE_HELP[b]));

  // Rejected, not honoured: a v1.1 build or a hand-edited row must not be able
  // to switch a project onto the circular base by writing the string.
  check('fund_size coerces to the safe default', coerceFeeBase('fund_size') === 'committed_capital');
  check('an unknown base coerces to the safe default', coerceFeeBase('whatever') === 'committed_capital');
  check('undefined coerces to the safe default', coerceFeeBase(undefined) === 'committed_capital');
  check('a valid base passes through', coerceFeeBase('total_development_cost') === 'total_development_cost');
  check('a project storing fund_size resolves to committed capital',
    resolveFundTerms({ fundTerms: { feeBase: 'fund_size' } } as any).feeBase === 'committed_capital');

  // The migration's CHECK must agree with the type, or the two drift.
  check('SQL CHECK allows committed_capital', /fee_base IN \([^)]*'committed_capital'/.test(sql));
  check('SQL CHECK allows total_development_cost', /fee_base IN \([^)]*'total_development_cost'/.test(sql));
  // Scoped to the CHECK clause, not the whole file: the migration DOES mention
  // fund_size, in the post-apply probe that proves an insert using it FAILS.
  // Asserting "the string never appears" would have banned documenting the
  // very rejection we want.
  const checkClause = /fee_base IN \(([^)]*)\)/.exec(sql)?.[1] ?? '';
  check('the CHECK clause exists', checkClause.length > 0);
  check('the CHECK clause does NOT allow fund_size', !/fund_size/.test(checkClause));
  check('the CHECK clause allows exactly two values', (checkClause.match(/'/g) ?? []).length === 4);
  check('the rejected base is documented as a post-apply probe', /fee_base = 'fund_size' must FAIL/.test(sql));
}

console.log('\n=== 2. Nothing trusts its input ===');
{
  const r = (ft: any) => resolveFundTerms({ fundTerms: ft } as any);
  check('a NaN fee resolves to 0', r({ managementFeePct: NaN }).managementFeePct === 0);
  check('a string fee is read as a number', r({ managementFeePct: '0.02' }).managementFeePct === 0.02);
  check('a garbage fee resolves to 0', r({ managementFeePct: 'abc' }).managementFeePct === 0);
  check('a fee above 100% clamps to 1', r({ managementFeePct: 3 }).managementFeePct === 1);
  check('a negative fee clamps to 0', r({ managementFeePct: -0.5 }).managementFeePct === 0);
  check('a 300% carry clamps to 1', r({ carryPct: 3 }).carryPct === 1);
  check('a negative hurdle clamps to 0', r({ hurdleRatePct: -1 }).hurdleRatePct === 0);
  check('negative committed capital clamps to 0', r({ committedCapital: -5 }).committedCapital === 0);
  check('committed capital is NOT capped at 1 (it is money, not a rate)', r({ committedCapital: 250_000_000 }).committedCapital === 250_000_000);
  check('Infinity committed capital resolves to 0', r({ committedCapital: Infinity }).committedCapital === 0);

  // Fee shares: same in-app role validation as parties.sanitizeRoles.
  check('an unknown role is dropped', sanitizeFeeShares([{ role: 'Chef', sharePct: 1 }]).length === 0);
  check('a known role is kept', sanitizeFeeShares([{ role: 'Sponsor', sharePct: 0.5 }]).length === 1);
  check('shares clamp to 0..1', sanitizeFeeShares([{ role: 'Sponsor', sharePct: 9 }])[0].sharePct === 1);
  check('a NaN share resolves to 0', sanitizeFeeShares([{ role: 'Sponsor', sharePct: NaN }])[0].sharePct === 0);
  check('duplicate roles collapse to one', sanitizeFeeShares([{ role: 'Sponsor', sharePct: 0.2 }, { role: 'Sponsor', sharePct: 0.7 }]).length === 1);
  check('the last duplicate wins', sanitizeFeeShares([{ role: 'Sponsor', sharePct: 0.2 }, { role: 'Sponsor', sharePct: 0.7 }])[0].sharePct === 0.7);
  check('non-array input is dropped', sanitizeFeeShares('Sponsor').length === 0);
  check('junk entries are skipped', sanitizeFeeShares([null, 3, { role: 'Developer', sharePct: 0.5 }]).length === 1);
  check('output is in canonical PARTY_ROLES order', (() => {
    const out = sanitizeFeeShares([{ role: 'Lender', sharePct: 0.5 }, { role: 'Sponsor', sharePct: 0.5 }]);
    return out[0].role === 'Sponsor' && out[1].role === 'Lender';
  })());
  check('every role the tab offers is accepted', PARTY_ROLES.every((role) => sanitizeFeeShares([{ role, sharePct: 0.1 }]).length === 1));

  // The total is reported, not enforced: a half-entered split is a normal
  // intermediate state, so the tab warns rather than refusing to save.
  check('an empty split counts as balanced', feeSharesBalanced([]));
  check('60/40 is balanced', feeSharesBalanced([{ role: 'Sponsor', sharePct: 0.6 }, { role: 'Developer', sharePct: 0.4 }]));
  check('60/30 is NOT balanced', !feeSharesBalanced([{ role: 'Sponsor', sharePct: 0.6 }, { role: 'Developer', sharePct: 0.3 }]));
  check('the total is reported for the warning', Math.abs(feeShareTotal([{ role: 'Sponsor', sharePct: 0.6 }, { role: 'Developer', sharePct: 0.3 }]) - 0.9) < 1e-9);
}

console.log('\n=== 3. The row store and the snapshot store agree ===');
{
  const terms = {
    enabled: true, managementFeePct: 0.02, feeBase: 'total_development_cost' as const,
    hurdleRatePct: 0.08, carryPct: 0.2, committedCapital: 250_000_000,
    feeShares: [{ role: 'Sponsor', sharePct: 0.6 }, { role: 'Developer', sharePct: 0.4 }],
  };
  const roundTripRow = fromRow(toRow(terms) as any);
  check('terms survive the row round trip', JSON.stringify(roundTripRow) === JSON.stringify(terms));

  const roundTripSnap = resolveFundTerms({ fundTerms: toFundTermsPatch(terms) } as any);
  check('terms survive the snapshot round trip', JSON.stringify(roundTripSnap) === JSON.stringify(terms));

  // The two stores must not diverge: whatever the tab writes to the table it
  // also writes to the snapshot, and the engine reads the snapshot.
  check('row and snapshot resolve identically', JSON.stringify(roundTripRow) === JSON.stringify(roundTripSnap));

  check('an empty row resolves to standalone defaults', fromRow(null).enabled === false && fromRow(null).feeShares.length === 0);
  check('a row with fund_enabled false is off', fromRow({ fund_enabled: false } as any).enabled === false);
  check('only a literal true enables from a row', fromRow({ fund_enabled: 'true' } as any).enabled === false);
  check('a row carrying fund_size is coerced', fromRow({ fee_base: 'fund_size' } as any).feeBase === 'committed_capital');

  // Every column the server helper selects exists in the migration, or a read
  // would 42703 the moment the table is applied.
  const serverFile = read('src/hubs/modeling/platforms/refm/lib/persistence/fundTerms-server.ts');
  const cols = /const COLS = '([^']+)'/.exec(serverFile)?.[1].split(',').map((c) => c.trim()) ?? [];
  check('the server selects at least the seven term columns', cols.length === 7);
  check('every selected column is created by the migration', cols.every((c) => new RegExp(`^\\s*${c}\\s`, 'm').test(sql)), cols.join(','));
}

console.log('\n=== 4. Step 1 contract survives Step 2 ===');
{
  check('the default is still off', DEFAULT_FUND_TERMS.enabled === false);
  check('absent fund terms still resolve off', resolveFundTerms({} as any).enabled === false);
  check('a fully populated block with enabled false is OFF',
    isFundLayerActive({ fundTerms: { enabled: false, managementFeePct: 0.02, carryPct: 0.2, hurdleRatePct: 0.08 } } as any) === false);
  check('a truthy non-boolean still does not enable',
    isFundLayerActive({ fundTerms: { enabled: 'yes', managementFeePct: 0.02 } } as any) === false);
  check('a populated block with enabled true IS on',
    isFundLayerActive({ fundTerms: { enabled: true, managementFeePct: 0.02 } } as any) === true);
  check('the default terms carry no fee, hurdle or carry',
    DEFAULT_FUND_TERMS.managementFeePct === 0 && DEFAULT_FUND_TERMS.hurdleRatePct === 0 && DEFAULT_FUND_TERMS.carryPct === 0);
}

console.log('\n=== 5. Migration 208 is additive and safe ===');
{
  check('creates the table if not exists', /CREATE TABLE IF NOT EXISTS refm_fund_terms/.test(sql));
  check('one row per project (project_id is the primary key)', /project_id\s+uuid PRIMARY KEY/.test(sql));
  check('cascades from the project', /REFERENCES refm_projects\(id\) ON DELETE CASCADE/.test(sql));
  check('the toggle defaults to false', /fund_enabled\s+boolean NOT NULL DEFAULT false/.test(sql));
  check('rates are constrained to 0..1', (sql.match(/>= 0 AND \w+ <= 1/g) ?? []).length >= 3);
  check('committed capital cannot be negative', /committed_capital\s+numeric NOT NULL DEFAULT 0 CHECK \(committed_capital >= 0\)/.test(sql));
  check('fee shares default to an empty array', /fee_shares\s+jsonb NOT NULL DEFAULT '\[\]'::jsonb/.test(sql));
  check('RLS is enabled', /ALTER TABLE refm_fund_terms ENABLE ROW LEVEL SECURITY/.test(sql));
  check('RLS is owner scoped', /p\.user_id = auth\.uid\(\)/.test(sql));
  check('it drops nothing', !/\bDROP TABLE\b/i.test(sql) && !/\bDROP COLUMN\b/i.test(sql));
  check('it alters no existing table', !/ALTER TABLE (?!refm_fund_terms)/.test(sql));
  check('it is transactional', /^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql));
  check('it documents the post-apply behavioural probes', /must FAIL with 23514/.test(sql) && /23505/.test(sql));
}

console.log('\n=== 6. The tab is wired, and honest about doing nothing yet ===');
{
  const shell = read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx');
  const tab = read('src/hubs/modeling/platforms/refm/components/modules/Module1FundTerms.tsx');

  check('the tab is registered in m1Tabs', /key: 'fund-terms'/.test(shell));
  check('the tab renders in the M1 branch', /activeTab === 'fund-terms' && <Module1FundTerms/.test(shell));
  check('the tab is imported', /import Module1FundTerms from/.test(shell));
  check('the M1 tab labels are renumbered 1 to 6', /'6\. Financing'/.test(shell));

  check('the tab writes the snapshot copy the engine will read', /setProject\(\{ fundTerms:/.test(tab));
  check('the tab also writes the durable row', /saveFundTerms\(/.test(tab));
  check('the tab offers only the two linear bases', /FEE_BASES\.map/.test(tab) && !/fund_size/.test(tab));
  check('the tab says the terms do not flow into the model yet', /do not yet flow into the model/.test(tab));
  check('the tab explains the off state rather than hiding the fields', /take effect only when you switch the toggle on/.test(tab));
  check('the tab degrades when migration 208 is absent', /fund-terms-migration-notice/.test(tab));

  const route = read('app/api/refm/projects/[id]/fund-terms/route.ts');
  check('the route re-validates through the shared resolver', /resolveFundTerms\(/.test(route));
  check('the route enforces ownership', /requireOwnedProject/.test(route));
  check('writes pass the read-only grace gate', /writeBlockReason/.test(route));
}

console.log('\n=== 7. House style ===');
{
  const emDash = new RegExp('[\\u2014\\u2015]');
  for (const p of [
    'src/hubs/modeling/platforms/refm/lib/fundTerms.ts',
    'src/hubs/modeling/platforms/refm/lib/persistence/fundTerms-server.ts',
    'src/hubs/modeling/platforms/refm/components/modules/Module1FundTerms.tsx',
    'app/api/refm/projects/[id]/fund-terms/route.ts',
    'supabase/migrations/208_refm_fund_terms.sql',
    'scripts/verify-fund-terms.ts',
  ]) check(`no em dash in ${p.split('/').pop()}`, !emDash.test(read(p)));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail > 0 ? 1 : 0);
