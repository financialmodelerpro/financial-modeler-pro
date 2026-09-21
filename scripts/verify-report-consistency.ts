/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * verify-report-consistency.ts
 *
 * Pass 3 of the PDF export review: a figure without its basis, and a section
 * that exists on screen but not in the file.
 *
 *   F1  one name per metric. Two cards both captioned "Equity Multiple" on the
 *       same page (2.10x FCFE and 2.22x distributions), the second with no basis.
 *   F2  headline distribution returns were GROSS while the Fund Layer page two
 *       pages later showed NET, with nothing saying which was which.
 *   F3  the same metric under two names ("Dividend IRR" / "Distributed Equity IRR").
 *   F4  four margin metrics on adjacent pages with no basis, and an appraisal
 *       profit sitting 3.6x from profit after tax with no bridge.
 *   F5  the terminal value method printed beside BOTH an exit multiple and a
 *       perpetuity growth rate, with nothing marking which was live.
 *   G1  neither PDF had a Checks section; the summary had no balance check at all.
 *   G3  min DSCR below 1.00x printed as a neutral card, and no covenant
 *       thresholds anywhere.
 *   H1  the model version was never printed, so a document was unattributable.
 *   H2  Module 5 skipped Tab 3 when there were fewer than two cases.
 *   H3  lender covenants, sensitivity, timeline, land and area, the fund inputs
 *       band and a fund-active marker were all missing.
 *   H4/H5 the executive summary omitted the fund from its cost story and stated
 *       the NEW-funding split as though it were the whole capital structure.
 *
 * Also pins the shared stream builder: the FCFF / FCFE / Distributed Equity row
 * lists lived in four hand-maintained copies and the PDF's had drifted.
 *
 * Run: npx tsx scripts/verify-report-consistency.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { pdfText } from './pdfTextExtract';
import { generateProjectPdf, generateSummaryPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import {
  FCFF_BUILDUP_LABELS, FCFE_BUILDUP_LABELS, DIVIDEND_BUILDUP_LABELS,
  buildFcfeBuildup, m4StreamRow,
} from '../src/hubs/modeling/platforms/refm/lib/reports/streamReports';
import { buildIntegrityChecks, relativeCheckOk } from '../src/hubs/modeling/platforms/refm/lib/reports/checksReport';
import { buildExcelSampleState } from './excelSampleState';
import { buildExistingOperationsState, EXISTING_OPS_LABEL } from './fixtures/existingOperationsState';
import { readLiveProjectVersion } from './fixtures/liveProject';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

const PUA: Record<string, string> = {
  '\uE081': '(', '\uE082': ')', '\uE083': '[', '\uE084': ']', '\uE088': '-', '\uE092': ':',
};
const decode = (b: Uint8Array): string => pdfText(b).replace(/[\uE000-\uF8FF]/g, (c) => PUA[c] ?? '?');

const MODULE_KEYS = ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'];
const FUND_TERMS = {
  enabled: true, fundSize: 0, fundSizeOverride: false, facilityLimit: 0, facilityLimitOverride: false,
  fundStructureFeePct: 0.005, fundManagementFeePct: 0.005, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.005, otherExpensesPerAnnum: 3_000_000,
  performanceFeePct: 0.2, hurdleRatePct: 0.08,
  fundManagerName: 'Fund Manager', feeDistribution: [] as any[],
};

const fundFixture = (o: { hurdle?: number } = {}): any => {
  const s = buildExcelSampleState();
  s.project.fundTerms = { ...FUND_TERMS, hurdleRatePct: o.hurdle ?? FUND_TERMS.hurdleRatePct };
  for (const ph of s.phases) ph.dividendPolicy = { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.9, mode: 'cash_above_min' };
  return s;
};
const render = async (state: any, extra: any = {}): Promise<{ full: string; summary: string }> => {
  const common = { state, projectName: 'Consistency Check', dateLabel: '12 August 2026', displayScale: 'millions', ...extra } as any;
  return {
    full: decode(await generateProjectPdf({ ...common, selectedModuleKeys: MODULE_KEYS })),
    summary: decode(await generateSummaryPdf({ ...common, selectedModuleKeys: [] })),
  };
};
/** Distinct card captions, so a duplicated metric name is visible. */
/** drawParagraph WRAPS, so a phrase can straddle a line break; collapse
 *  whitespace before matching one. */
const flat = (t: string): string => t.replace(/\s+/g, ' ');
const countLines = (txt: string, exact: string): number => txt.split('\n').filter((l) => l.trim() === exact).length;

async function main(): Promise<void> {
  console.log('=== Report consistency and completeness ===');

  // ── The shared stream builder ─────────────────────────────────────────────
  console.log('\n-- Shared stream builder (the four-copy fix) --');
  const fx = fundFixture();
  const snap: any = computeFinancialsSnapshot(fx);
  const rs: any = computeReturnsSnapshot(snap, fx.project);
  // 2026-08-18, REVERSED: FCFE now builds VISIBLY FROM FCFF, which is what the
  // reference does and what a reader following one number into the next
  // statement needs. It still opens on the equity inception (FCFF's own
  // unlevered inception is backed out on the row below).
  check('FCFE build-up opens on the equity inception, then chains from FCFF',
    FCFE_BUILDUP_LABELS[0] === '(-) Existing Equity Investment (at inception)'
    && FCFE_BUILDUP_LABELS.some((l) => l.includes('FCFF (unlevered')));
  // The terminal SWAP has to be visible: FCFF carries the enterprise value, and
  // because FCFE chains from FCFF it must back that out explicitly and put the
  // levered terminal in its place. Doing the swap implicitly is the mistake that
  // once left the PDF short by a whole terminal value.
  check('FCFF and FCFE build-ups carry DIFFERENT terminal rows',
    FCFF_BUILDUP_LABELS.includes('(+) Terminal Enterprise Value')
    && FCFE_BUILDUP_LABELS.includes('(+) Terminal Value less Closing Debt')
    && !FCFE_BUILDUP_LABELS.includes('(+) Terminal Enterprise Value'));
  check('the dividend build-up is its own row list', DIVIDEND_BUILDUP_LABELS.includes('(+) Dividends Distributed (cash-sweep waterfall)'));
  {
    const rows = buildFcfeBuildup(rs, m4StreamRow);
    const peak = Math.max(1, ...rs.fcfePerPeriod.map((v: number) => Math.abs(v)));
    const ok = rs.fcfePerPeriod.every((v: number, i: number) => {
      const built = rows.slice(0, -1).reduce((acc, r) => acc + (r.values[i] ?? 0), 0);
      return Math.abs(built - v) <= Math.max(1, peak * 1e-9);
    });
    check('the shared FCFE rows sum to FCFE in every period', ok);
  }

  // ── Rendered documents ────────────────────────────────────────────────────
  const { full, summary } = await render(fx, { versionLabel: '1.4', versionComment: 'Board pack', includeSensitivity: true });

  console.log('\n-- F1/F3: one name per metric, every basis stated --');
  check('F1: no two cards share the caption "Equity Multiple"', countLines(full, 'EQUITY MULTIPLE') === 0,
    `${countLines(full, 'EQUITY MULTIPLE')} bare captions`);
  check('F1: the FCFE multiple names its basis', full.includes('EQUITY MULTIPLE (FCFE)'));
  check('F1: the distributions multiple names its basis',
    full.includes('EQUITY MULTIPLE (DISTRIBUTIONS)') || full.includes('DISTRIBUTED EQUITY MOIC'));
  check('F3: the distribution metric has ONE name across the document',
    !full.includes('DIVIDEND IRR') && !full.includes('DIVIDEND MOIC'),
    'legacy "Dividend IRR / MOIC" caption still present');
  check('F3: the summary uses the same name as the full report',
    !summary.includes('DIVIDEND IRR') && !summary.includes('DIVIDEND MOIC'));

  console.log('\n-- F4: margins state their basis, and the two profits are bridged --');
  check('F4: development margin names its basis', full.includes('profit after fin. / GDV'));
  check('F4: profit margin names its basis', full.includes('profit after tax / revenue'));
  check('F4: the appraisal-vs-P&L bridge is stated', flat(full).includes('Appraisal basis, not the P&L'));
  check('F4: the bridge names the excluded items', /operating expenses \(/.test(full) && flat(full).includes('which an appraisal does not deduct'));

  console.log('\n-- F5: only the live terminal-value parameter is presented as live --');
  // RE-AIMED 2026-09-15: the table printed every parameter and marked the unused
  // ones "(not applied)", and tested "perpetuity or not", so a cap rate method read
  // "Exit multiple (applied)". It now prints only the input the method uses.
  check('F5: no unused parameter is printed beside the live one', !/\(not applied\)/.test(full) && !/\(applied\)/.test(full));
  check('F5: the PDF builder prints the input per method, cap rate included',
    /tm === 'cap_rate'/.test(readFileSync('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts', 'utf8')));
  check('F5: the method reads as a name, not a raw enum', full.includes('Perpetuity growth (Gordon)') || full.includes('Exit multiple'));

  console.log('\n-- G1: both documents carry the integrity checks --');
  for (const [doc, txt] of [['full report', full], ['summary', summary]] as const) {
    check(`G1: ${doc} has a Model Integrity Checks table`, txt.includes('Model Integrity Checks'));
    check(`G1: ${doc} checks the balance sheet`, txt.includes('Balance sheet balances (Assets = L + E)'));
    check(`G1: ${doc} checks closing cash against the balance sheet`, txt.includes('Cash flow closing == balance sheet cash'));
    check(`G1: ${doc} checks Direct against Indirect cash flow`, txt.includes('Direct cash flow == Indirect cash flow'));
  }

  console.log('\n-- G2: the tolerance is relative and anchored on the PEAK --');
  {
    const checks = buildIntegrityChecks(snap);
    check('G2: every check passes on a healthy model', checks.every((c) => c.ok),
      checks.filter((c) => !c.ok).map((c) => `${c.label} residue=${c.residue}`).join(' | '));
    check('G2: the magnitude is the PEAK, not the final period',
      checks.every((c) => c.magnitude >= Math.abs(c.residue)));
    // 2026-08-18: THE COMMENT THAT STOOD HERE WAS WRONG, and it is why the band
    // was ten orders of magnitude too loose. It read "a one-unit absolute band
    // (the old rule) would fail a healthy solve". It would not. These three
    // identities are exact by construction, the funding solver has converged
    // before the statements are struck, and a healthy residue is pure
    // double-precision noise: measured on both live projects, worst 1.9e-6 on a
    // 6,597.1m peak, a relative 2.9e-16. The old `< 1` absolute band was
    // perfectly safe; what was actually broken was the ANCHOR, not the scale.
    //
    // Accepting 1e-9 of the magnitude, as this check used to require, is one
    // currency unit on a billion, seven orders above the real noise floor. That
    // is what let a 360.79 residue read OK on the live project while it was a
    // real 25,000,000 imbalance on its sister (docs/TRAPS.md 7.22).
    check('G2: a residue of 1e-3 of the magnitude is REJECTED', !relativeCheckOk(1e-3 * 1e9, 1e9));
    check('G2: a residue at machine-epsilon scale is ACCEPTED', relativeCheckOk(3e-16 * 1e9, 1e9));
    check('G2: a ONE-UNIT residue on a billion is REJECTED (it is orders above floating-point noise)',
      !relativeCheckOk(1, 1e9));
  }

  console.log('\n-- G3: DSCR is presented as a covenant reading, with thresholds --');
  check('G3: the covenant table is present', full.includes('Lender Covenants (threshold vs modelled)'));
  check('G3: it states the test direction', full.includes('minimum') || full.includes('maximum'));
  check('G3: it states a verdict', full.includes('Pass') || full.includes('BREACH'));

  console.log('\n-- H1: the document is attributable --');
  // SCOPED TO THE COVER. The footer carries the version on every page, so an
  // unscoped includes() passes even when the cover line is gone.
  const coverOf = (txt: string): string => {
    const ls = txt.split('\n');
    const firstFooter = ls.findIndex((l) => l.startsWith('Page 1 of '));
    return ls.slice(0, firstFooter < 0 ? ls.length : firstFooter).join('\n');
  };
  check('H1: the COVER prints the model version', coverOf(full).includes('Model version 1.4'));
  check('H1: the summary COVER prints it too', coverOf(summary).includes('Model version 1.4'));
  check('H1: every footer carries it', full.split('\n').filter((l) => l.startsWith('Page ')).every((l) => l.includes('Model version 1.4')));
  check('H1: the version comment is printed when supplied', full.includes('Board pack'));

  console.log('\n-- H3: sections that existed on screen but in neither PDF --');
  // RE-AIMED 2026-09-21 at the names these sections carry now that Module 1
  // prints the platform's own tabs: the dated windows are columns of the one
  // Phases table (the report no longer has a "Timeline" table, which is a
  // workbook tab and not a Module 1 one), land and area are Tables 3 and 4 of
  // the assets tab, and the fund inputs are the Fund Terms tab. What is
  // asserted is unchanged: each section is in the document.
  check('H3: timeline', full.includes('Construction End') && full.includes('Operations Start'));
  check('H3: land and area', full.includes('Derived areas by plot') && full.includes('Land by asset'));
  check('H3: fund inputs band', full.includes('Fund management fees'));
  check('H3: sensitivity grid (when entitled)', full.includes('Two-Way Sensitivity'));

  console.log('\n-- H4/H5: the executive summary tells the whole story --');
  check('H4: the fund is in the cost story', flat(full).includes('This is a FUND project'));
  check('H4: a fund KPI card is present', full.includes('FUND FEES'));
  check('H5: the funding split is scoped to NEW funding', flat(full).includes('with new funding drawn'));
  check('H5: the real capital mix is stated', flat(full).includes('Across the whole capital structure'));
  check('H5: the old unqualified claim is gone', !/funded 100% debt \/ 0% equity\./.test(full));

  // ── F2: gross vs net, proven with a fee that actually arises ──────────────
  console.log('\n-- F2: gross vs net is named --');
  {
    const cleared = fundFixture({ hurdle: 0 });
    const cs: any = computeFinancialsSnapshot(cleared);
    const crs: any = computeReturnsSnapshot(cs, cleared.project);
    check('the cleared-hurdle fixture really produces a performance fee', crs.waterfall.totalPerformanceFee > 0,
      `fee=${crs.waterfall.totalPerformanceFee}`);
    const r2 = await render(cleared);
    check('F2: the headline says the distribution figures are net',
      r2.full.includes('net of performance fee') && r2.summary.includes('net of performance fee'));
    check('F2: the gross figure is named beside the net one', /net; gross /.test(flat(r2.full)));
    check('F2: a sentence states the fee and points at the waterfall',
      flat(r2.full).includes('are NET of a performance fee') && r2.full.includes('Fund Layer'));
    // And with NO fee, the note says gross equals net rather than staying silent.
    check('F2: with no fee arising the document says so',
      flat(full).includes('No performance fee arises'));
  }

  // ── H2: tab numbering is derived ──────────────────────────────────────────
  console.log('\n-- H2: Module 5 tab numbering has no gap --');
  // SCOPED TO MODULE 5. An unscoped sweep of every `Tab N:` in the document is
  // toothless: Modules 1 to 4 supply tabs 1 to 5 themselves, so a gap in
  // Module 5 is masked and a hardcoded numbering passes. The running header
  // names its module, so read the numbers from that.
  const m5TabNumbers = (txt: string): number[] => {
    const nums = [...txt.matchAll(/Module 5:[^\n]*?Tab (\d):/g)].map((m) => Number(m[1]));
    return [...new Set(nums)].sort((a, b) => a - b);
  };
  {
    const nums = m5TabNumbers(full);
    check('H2: Module 5 emits tabs at all', nums.length > 0, `saw ${nums.join(',')}`);
    check('H2: Module 5 tab numbers run 1..n with no gap',
      nums.length > 0 && nums.every((v, i) => v === i + 1), `saw ${nums.join(',')}`);
    // 2026-09-21: the fund block is a SECTION of the Returns tab, as it is on
    // the screen, so what this pins now is that the fund content lands on
    // Module 5's FIRST tab and that no tab of its own was reintroduced.
    check('H2: the fund block sits on the Returns tab, not a tab of its own',
      /Module 5:[^\n]*?Tab 1: Returns/.test(full)
      && !/Tab \d: Fund Layer/.test(full)
      && full.includes('Distribution Waterfall'),
      `saw ${nums.join(',')}`);
    check('H2: Case Comparison is absent when there are fewer than two cases',
      !full.includes('Case Comparison'));
  }

  // ── A real project, and the committed existing-operations fixture ─────────
  // The same battery runs on both, so a shape the live project does not carry
  // (an operational first phase) is still exercised.
  const realLegs: Array<{ label: string; state: any; versionLabel: string }> = [
    { label: EXISTING_OPS_LABEL, state: buildExistingOperationsState(), versionLabel: 'committed' },
  ];
  // THE LIVE LEG NAMES A PROJECT THAT IS STILL OPEN, AND FAILS WHEN IT IS NOT
  // (2026-09-21). This read FMP RE HUB by id; that project was soft-deleted on
  // 2026-09-12, and the read skipped in SILENCE when it returned nothing (the
  // `if (error)` branch fires on an error, and zero rows printed nothing at
  // all), so from the purge onwards the leg would have vanished with no output
  // while the verifier still reported a pass. One shared rule now, in
  // fixtures/liveProject.ts, and the shape that project carried is covered by
  // the committed fixture leg above.
  const live = await readLiveProjectVersion();
  if (live.ok) realLegs.push({ label: live.label, state: live.snapshot, versionLabel: live.versionLabel });
  else if (live.noCredentials) console.log('\n(live project leg skipped: no database credentials; the runner refuses to run without them unless --allow-offline)');
  else check('the live project is readable and still has a saved version', false, live.reason);

  {
    {
      for (const leg of realLegs) {
        console.log(`\n-- Real project (${leg.label}) --`);
        const st = leg.state;
        const r = await render(st, { versionLabel: leg.versionLabel });
        check('real: integrity checks render in both documents',
          r.full.includes('Model Integrity Checks') && r.summary.includes('Model Integrity Checks'));
        check('real: covenants render', r.full.includes('Lender Covenants (threshold vs modelled)'));
        check('real: the DSCR breach is called out', flat(r.full).includes('Debt service is not covered from operations'));
        check('real: tab numbering has no gap',
          [...new Set([...r.full.matchAll(/Tab (\d): /g)].map((m) => Number(m[1])))].sort((a, b) => a - b).every((v, i) => v === i + 1));
      }
    }
  }

  // ── Toggle off stays byte-identical ───────────────────────────────────────
  console.log('\n=== Fund toggle OFF is byte-identical ===');
  const mk = async (mut: (s: any) => void): Promise<string> => {
    const s = buildExcelSampleState(); mut(s);
    const r = await render(s);
    return r.full + '\n#####\n' + r.summary;
  };
  const absent = await mk(() => { /* no fund terms */ });
  const disabled = await mk((s) => { s.project.fundTerms = { ...FUND_TERMS, enabled: false }; });
  check('absent vs populated-but-disabled are identical', absent === disabled,
    `${absent.length} vs ${disabled.length} chars`);
  // THE TAB IS NOT THE CONTENT (2026-09-21). Module 1 tab 3 exists on every
  // project and shows the toggle with the layer off, which is what the screen
  // and the workbook both do, so the report says the same. What must not leak
  // is fund CONTENT: a fee, a base, a matrix, a waterfall, the narrative. The
  // blanket string test could not tell the two apart, so it is stated as the
  // named blocks instead, and the toggle itself is asserted present.
  check('no fund content leaks when the toggle is off',
    !/Tab 5: Fund Layer|FUND FEES|This is a FUND project|Distribution Waterfall|Fund management fees|Fee distribution|Capital Bases/i.test(disabled));
  check('the Fund Terms tab still shows its toggle when the layer is off',
    /Fund terms/.test(disabled) && /Fund layer enabled/.test(disabled));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('FAILURES:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
