/**
 * verify-tax-basis.ts (2026-10-05, export review group 4, founder's decision)
 *
 * THE BASIS DECIDES WHETHER A LOSS CARRIES FORWARD, AND THE P&L SAYS WHICH.
 *   zakat (the default): each year on its own, no loss carried forward.
 *   cit: losses carried forward without limit of time, relief capped at 25%
 *        of each year's taxable profit (the KSA rule).
 * Absent reads zakat, so an existing project charges exactly what it did.
 *
 * Usage: npx tsx --env-file=.env.local scripts/verify-tax-basis.ts
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { chargeTax, CIT_LOSS_RELIEF_CAP } from '../src/core/calculations/taxCharge';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { taxBasisNote } from '../src/hubs/modeling/platforms/refm/lib/reports/m4Reports';
import { buildExcelSampleState } from './excelSampleState';
import { readLiveProjectVersion } from './fixtures/liveProject';

let pass = 0, fail = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); } else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const S = (a: readonly number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);

(async () => {
  console.log('=== Tax basis: zakat vs corporate income tax ===');

  // The rule on a constructed series: 100 of losses, then profits of 40, 200, 400.
  const base = [-60, -40, 40, 200, 400];
  const z = chargeTax(base, 0.1, 'zakat');
  check('zakat: a loss year relieves nothing later', S(z.lossReliefPerPeriod) === 0 && near(S(z.tax), (40 + 200 + 400) * 0.1));
  check('zakat: the same as the old charge, rate x max(0, profit) each year', z.tax.every((v, i) => near(v, Math.max(0, base[i]) * 0.1)));
  const c = chargeTax(base, 0.1, 'cit');
  // Year 3: relief = min(100, 25% x 40 = 10); year 4: min(90, 50) = 50; year 5: min(40, 100) = 40.
  check('cit: relief is capped at 25% of the year\'s taxable profit', near(c.lossReliefPerPeriod[2], 10) && near(c.lossReliefPerPeriod[3], 50), c.lossReliefPerPeriod.join(','));
  check('cit: the loss carries forward without limit until used', near(c.lossReliefPerPeriod[4], 40) && near(c.lossCarriedForwardPerPeriod[4], 0), c.lossCarriedForwardPerPeriod.join(','));
  check('cit: tax = rate x (profit - relief)', c.tax.every((v, i) => near(v, Math.max(0, base[i] - c.lossReliefPerPeriod[i]) * (base[i] > 0 ? 0.1 : 0))));
  check('cit: all relief together equals the losses used', near(S(c.lossReliefPerPeriod), 100));
  check('the cap is the KSA 25%', CIT_LOSS_RELIEF_CAP === 0.25);
  // Absent basis = zakat.
  check('an absent basis charges as zakat', chargeTax(base, 0.1, undefined).tax.every((v, i) => v === z.tax[i]));

  // The engine on a project with losses, both bases.
  const state = buildExcelSampleState() as any;
  const s0 = computeFinancialsSnapshot(state);
  const lossy = s0.pl.pbtPerPeriod.some((v) => v < 0);
  const cit = JSON.parse(JSON.stringify(state)); cit.project.tax = { ...(cit.project.tax ?? {}), rate: cit.project.tax?.rate || 0.2, basis: 'cit' };
  const zk = JSON.parse(JSON.stringify(cit)); zk.project.tax.basis = 'zakat';
  const sc = computeFinancialsSnapshot(cit), sz = computeFinancialsSnapshot(zk);
  check('the fixture makes a loss somewhere (so carry-forward can bite)', lossy || sz.pl.taxLossesArisingPerPeriod.some((v) => v > 0));
  check('cit charges no more tax than zakat on the same profits', S(sc.pl.taxPerPeriod) <= S(sz.pl.taxPerPeriod) + 1e-6);
  check('the balance sheet still balances on the cit basis', Math.max(...sc.bs.bsDifferencePerPeriod.map(Math.abs)) < 1, `${Math.max(...sc.bs.bsDifferencePerPeriod.map(Math.abs))}`);
  check('the P&L carries the basis', sc.pl.taxBasis === 'cit' && sz.pl.taxBasis === 'zakat' && s0.pl.taxBasis === 'zakat');

  // The sentence, both ways.
  const money = (v: number): string => `${(v / 1e6).toFixed(1)}m`;
  const zn = taxBasisNote(sz.pl, sz.yearLabels, money);
  const cn = taxBasisNote(sc.pl, sc.yearLabels, money);
  check('zakat with losses says they are not carried forward, and that this is the rule', !!zn && /not carried forward/.test(zn) && /rule, not an omission/.test(zn), zn ?? 'none');
  check('cit says losses carry forward with the 25% cap', !!cn && /carry forward without limit/.test(cn) && /25%/.test(cn), cn ?? 'none');
  check('zakat with no loss year says nothing', taxBasisNote({ taxBasis: 'zakat', taxLossesArisingPerPeriod: [0, 0], taxLossReliefPerPeriod: [0, 0], taxLossCarriedForwardPerPeriod: [0, 0] }, [2027, 2028], money) === null);
  const R = 'src/hubs/modeling/platforms/refm/';
  const surfaces = ['components/modules/Module4PL.tsx', 'lib/pdf/generateProjectPdf.ts', 'lib/excel/buildModelWorkbook.ts'].filter((f) => !readFileSync(R + f, 'utf8').includes('taxBasisNote('));
  check('the P&L screen, the PDF and the workbook print the one sentence', surfaces.length === 0, surfaces.join(', '));
  check('the live formula layer refuses a basis it does not mirror', /basis === 'cit'\) refuse\.push/.test(readFileSync(R + 'lib/excel/liveLayers/stage5Statements.ts', 'utf8')));

  // Marina Gate: zakat, unchanged, and the sentence names its losses.
  const live = await readLiveProjectVersion();
  if (live.ok) {
    const ls = computeFinancialsSnapshot(live.snapshot as any);
    const old = S(ls.pl.pbtPerPeriod.map((v, t) => (t === ls.disposal?.exitIdx && !(live.snapshot as any).project.tax?.applyToDisposalGain ? Math.max(0, v - (ls.pl.gainOnDisposalPerPeriod[t] ?? 0)) : Math.max(0, v)) * ls.pl.taxRate));
    check(`${live.label}: on zakat the charge is unchanged (rate x each year's profit)`, near(S(ls.pl.taxPerPeriod), old, 1e-9), `${S(ls.pl.taxPerPeriod)} vs ${old}`);
    const note = taxBasisNote(ls.pl, ls.yearLabels, money);
    check(`${live.label}: the P&L says its 2027 to 2029 losses get no relief`, !!note && /2027 to 2029/.test(note), note ?? 'none');
  } else if (live.noCredentials) {
    console.log('  (live leg skipped: no credentials)');
  } else check('the live project is readable', false, live.reason);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
