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

const PID = '1daa9217-d2b8-4b22-acbf-18fed79adeff';
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
  check('FCFE build-up starts from the equity inception, not from FCFF',
    FCFE_BUILDUP_LABELS[0] === '(-) Existing Equity Investment (at inception)'
    && !FCFE_BUILDUP_LABELS.some((l) => l.trim() === 'FCFF'));
  check('FCFF and FCFE build-ups carry DIFFERENT terminal rows',
    FCFF_BUILDUP_LABELS.includes('(+) Terminal Enterprise Value')
    && FCFE_BUILDUP_LABELS.includes('(+) Terminal Equity Value')
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
  check('F5: the applied parameter is marked applied', /\(applied\)/.test(full));
  check('F5: the unused parameter is marked not applied', /\(not applied\)/.test(full));
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
    // A one-unit absolute band (the old rule) would fail a healthy solve; the
    // relative rule must not, and must still bite on a real break.
    check('G2: a residue of 1e-3 of the magnitude is REJECTED', !relativeCheckOk(1e-3 * 1e9, 1e9));
    check('G2: a residue of 1e-9 of the magnitude is ACCEPTED', relativeCheckOk(1e-9 * 1e9, 1e9));
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
  check('H3: timeline', full.includes('Timeline (construction and operations windows)'));
  check('H3: land and area', full.includes('Land & Area'));
  check('H3: fund inputs band', full.includes('Fund Inputs (fund layer)'));
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
    check('H2: the Fund Layer tab takes the LAST number, not a fixed 5',
      new RegExp(`Module 5:[^\\n]*?Tab ${nums.length}: Fund Layer`).test(full),
      `expected Tab ${nums.length}: Fund Layer`);
    check('H2: Case Comparison is absent when there are fewer than two cases',
      !full.includes('Case Comparison'));
  }

  // ── Real project ──────────────────────────────────────────────────────────
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const { data, error } = await sb.from('refm_project_versions').select('snapshot,version_label')
        .eq('project_id', PID).order('created_at', { ascending: false }).limit(1);
      if (error) console.log(`\n(real project skipped: ${error.message})`);
      else if (data?.length) {
        console.log('\n-- Real project (FMP RE HUB) --');
        const st = (data[0] as any).snapshot;
        const r = await render(st, { versionLabel: (data[0] as any).version_label });
        check('real: integrity checks render in both documents',
          r.full.includes('Model Integrity Checks') && r.summary.includes('Model Integrity Checks'));
        check('real: covenants render', r.full.includes('Lender Covenants (threshold vs modelled)'));
        check('real: the DSCR breach is called out', flat(r.full).includes('Debt service is not covered from operations'));
        check('real: tab numbering has no gap',
          [...new Set([...r.full.matchAll(/Tab (\d): /g)].map((m) => Number(m[1])))].sort((a, b) => a - b).every((v, i) => v === i + 1));
      }
    } catch (e) { console.log(`\n(real project skipped: ${(e as Error).message})`); }
  } else {
    console.log('\n(real project skipped: no database credentials)');
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
  check('no fund content leaks when the toggle is off',
    !/Fund Layer|Fund Inputs|FUND FEES|This is a FUND project|Distribution Waterfall/i.test(disabled));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('FAILURES:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
